/* global fetch, Buffer */
const crypto = require("crypto");

const REGION = "auto";
const SERVICE = "s3";

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}
function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}
function signingKey(secretKey, dateStamp) {
  const kDate = hmac(Buffer.from(`AWS4${secretKey}`, "utf8"), dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}
function awsEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function encodeKeyPath(key) {
  return String(key)
    .split("/")
    .filter((part) => part.length > 0)
    .map(awsEncode)
    .join("/");
}
function amzClock(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}
function scope(dateStamp) {
  return `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
}
function hostFor(accountId) {
  return `${accountId}.r2.cloudflarestorage.com`;
}
function canonicalUri(bucket, key) {
  return `/${awsEncode(bucket)}/${encodeKeyPath(key)}`;
}
function configGuard(config) {
  const required = ["accountId", "accessKeyId", "secretAccessKey", "bucket", "publicBaseUrl"];
  for (const key of required) {
    if (!String(config?.[key] || "").trim()) throw new Error(`Missing R2 config: ${key}`);
  }
}

function createPresignedPutUrl(config, key, expiresSeconds = 600, contentType = "") {
  configGuard(config);
  const { amzDate, dateStamp } = amzClock();
  const host = hostFor(config.accountId);
  const credentialScope = scope(dateStamp);
  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  const signedHeaders = normalizedContentType ? "content-type;host" : "host";
  const canonicalHeaders = normalizedContentType
    ? `content-type:${normalizedContentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const canonicalQueryEntries = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.max(60, Math.min(900, Number(expiresSeconds) || 600)))],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  canonicalQueryEntries.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = canonicalQueryEntries
    .map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`)
    .join("&");
  const request = [
    "PUT",
    canonicalUri(config.bucket, key),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(request),
  ].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp), stringToSign, "hex");
  return `https://${host}${canonicalUri(config.bucket, key)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function signedRequest(config, { method, key, body = Buffer.alloc(0), contentType, cacheControl }) {
  configGuard(config);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const payloadHash = sha256(payload);
  const { amzDate, dateStamp } = amzClock();
  const host = hostFor(config.accountId);
  const credentialScope = scope(dateStamp);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    method,
    canonicalUri(config.bucket, key),
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = hmac(signingKey(config.secretAccessKey, dateStamp), stringToSign, "hex");
  const headers = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers["content-type"] = contentType;
  if (cacheControl) headers["cache-control"] = cacheControl;

  const response = await fetch(`https://${host}${canonicalUri(config.bucket, key)}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : payload,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 ${method} ${key} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return response;
}

async function getObject(config, key) {
  return signedRequest(config, { method: "GET", key });
}
async function putObject(config, key, body, { contentType = "application/octet-stream", cacheControl = "public,max-age=31536000,immutable" } = {}) {
  return signedRequest(config, { method: "PUT", key, body, contentType, cacheControl });
}
async function deleteObject(config, key) {
  return signedRequest(config, { method: "DELETE", key, body: Buffer.alloc(0) });
}
function publicObjectUrl(config, key) {
  configGuard(config);
  return `${String(config.publicBaseUrl).replace(/\/+$/, "")}/${encodeKeyPath(key)}`;
}
function keyFromPublicUrl(config, url) {
  try {
    const parsed = new URL(String(url || ""));
    const bases = [config.publicBaseUrl, ...(config.legacyPublicBaseUrls || [])];
    for (const configuredBase of bases) {
      const base = new URL(String(configuredBase).replace(/\/+$/, "") + "/");
      if (parsed.origin !== base.origin) continue;
      const basePath = base.pathname.replace(/\/+$/, "");
      if (basePath && !parsed.pathname.startsWith(`${basePath}/`)) continue;
      const relative = parsed.pathname.slice(basePath.length).replace(/^\/+/, "");
      if (!relative || relative.split("/").some((part) => !part)) return "";
      const key = relative.split("/").map((part) => decodeURIComponent(part)).join("/");
      // Reject traversal or encoded path separators before an object can be deleted.
      if (key.split("/").some((part) => !part || part === "." || part === "..")) return "";
      return key;
    }
    return "";
  } catch {
    return "";
  }
}

module.exports = {
  createPresignedPutUrl,
  getObject,
  putObject,
  deleteObject,
  publicObjectUrl,
  keyFromPublicUrl,
};
