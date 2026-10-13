/* global module */

const TEMPLATE_STORAGE_PREFIX = "templates/";

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeBucketName(value) {
  const raw = String(value || "").trim().replace(/^gs:\/\//i, "");
  return raw.split("/")[0];
}

function normalizeTemplatePath(value) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  const segments = path.split("/");

  if (
    !path.startsWith(TEMPLATE_STORAGE_PREFIX)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return "";
  }

  return path;
}

/**
 * Resolve a Firebase/Google Cloud Storage URL to one owned templates/... path.
 * External URLs, other buckets and non-template paths are deliberately ignored.
 */
function getTemplateStoragePath(value, expectedBucket) {
  if (typeof value !== "string" || !value.trim()) return "";

  const wantedBucket = normalizeBucketName(expectedBucket);
  if (!wantedBucket) return "";

  const raw = value.trim();
  let bucketName = "";
  let objectPath = "";

  if (/^gs:\/\//i.test(raw)) {
    const withoutScheme = raw.slice(5);
    const slashIndex = withoutScheme.indexOf("/");
    if (slashIndex < 1) return "";
    bucketName = decode(withoutScheme.slice(0, slashIndex));
    objectPath = decode(withoutScheme.slice(slashIndex + 1));
  } else {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return "";
    }

    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === "firebasestorage.googleapis.com") {
      const match = pathname.match(/^\/v\d+\/b\/([^/]+)\/o\/(.+)$/);
      if (!match) return "";
      bucketName = decode(match[1]);
      objectPath = decode(match[2]);
    } else if (hostname === "storage.googleapis.com") {
      const apiMatch = pathname.match(
        /^\/(?:download\/)?storage\/v\d+\/b\/([^/]+)\/o\/(.+)$/,
      );
      if (apiMatch) {
        bucketName = decode(apiMatch[1]);
        objectPath = decode(apiMatch[2]);
      } else {
        const directMatch = pathname.match(/^\/([^/]+)\/(.+)$/);
        if (!directMatch) return "";
        bucketName = decode(directMatch[1]);
        objectPath = decode(directMatch[2]);
      }
    } else if (hostname.endsWith(".storage.googleapis.com")) {
      bucketName = hostname.slice(0, -".storage.googleapis.com".length);
      objectPath = decode(pathname.replace(/^\/+/, ""));
    } else {
      return "";
    }
  }

  if (normalizeBucketName(bucketName) !== wantedBucket) return "";
  return normalizeTemplatePath(objectPath);
}

/**
 * Recursively find every owned Firebase Storage object referenced anywhere in
 * a template document. This also automatically covers future template fields.
 */
function collectTemplateStoragePaths(value, expectedBucket) {
  const paths = new Set();
  const visited = new Set();

  function visit(current) {
    if (typeof current === "string") {
      const path = getTemplateStoragePath(current, expectedBucket);
      if (path) paths.add(path);
      return;
    }

    if (!current || typeof current !== "object" || visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    Object.values(current).forEach(visit);
  }

  visit(value);
  return paths;
}

/** Preserve Firebase assets during an exact same-key Firebase -> R2 migration.
 * A CDN replacement must NEVER make the old Firebase object eligible for auto-delete.
 */
function mirroredR2TemplatePath(value, publicBase = "https://cdn.mlmposter.com") {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const base = new URL(publicBase);
    if (url.origin !== base.origin) return "";
    return normalizeTemplatePath(decode(url.pathname));
  } catch { return ""; }
}

function collectMirroredR2Paths(value, paths = new Set()) {
  if (typeof value === "string") {
    const key = mirroredR2TemplatePath(value);
    if (key) paths.add(key);
  } else if (Array.isArray(value)) value.forEach(child => collectMirroredR2Paths(child, paths));
  else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach(child => collectMirroredR2Paths(child, paths));
  }
  return paths;
}

function rewriteOldTemplateLinks(value, expectedBucket, stats) {
  if (typeof value === "string") {
    // Only the Firebase download URL form is supported by the client migration.
    if (!value.startsWith("https://firebasestorage.googleapis.com/")) return value;
    const key = getTemplateStoragePath(value, expectedBucket);
    if (!key) return value;
    stats.count++;
    return `https://cdn.mlmposter.com/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  if (Array.isArray(value)) return value.map(v => rewriteOldTemplateLinks(v, expectedBucket, stats));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, rewriteOldTemplateLinks(v, expectedBucket, stats)]));
  }
  return value;
}

function isOnlyTemplateUrlMigration(beforeData, afterData, expectedBucket) {
  if (!beforeData || !afterData) return false;
  const { isDeepStrictEqual } = require("node:util");
  const stats = { count: 0 };
  const rewritten = rewriteOldTemplateLinks(beforeData, expectedBucket, stats);
  return stats.count > 0 && isDeepStrictEqual(rewritten, afterData);
}

function getRemovedTemplateStoragePaths(beforeData, afterData, expectedBucket) {
  const beforePaths = collectTemplateStoragePaths(beforeData, expectedBucket);
  const afterPaths = collectTemplateStoragePaths(afterData, expectedBucket);

  // Exact mirrored CDN references are retained: moving URLs does not delete bytes.
  const mirrors = collectMirroredR2Paths(afterData);
  return [...beforePaths].filter((path) => !afterPaths.has(path) && !mirrors.has(path));
}

function getUnreferencedTemplateStoragePaths(
  candidatePaths,
  currentTemplates,
  expectedBucket,
) {
  const referencedPaths = new Set();

  for (const template of currentTemplates || []) {
    collectTemplateStoragePaths(template, expectedBucket).forEach((path) => {
      referencedPaths.add(path);
    });
  }

  return [...new Set(candidatePaths || [])].filter(
    (path) => !referencedPaths.has(path),
  );
}

module.exports = {
  TEMPLATE_STORAGE_PREFIX,
  collectTemplateStoragePaths,
  getRemovedTemplateStoragePaths,
  getTemplateStoragePath,
  getUnreferencedTemplateStoragePaths,
  isOnlyTemplateUrlMigration,
};
