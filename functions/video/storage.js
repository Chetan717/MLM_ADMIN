"use strict";
const S = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { check, PART } = require("./domain");
function storage({ account, bucket, access, secret }, client) {
  check(
    /^[0-9a-f]{32}$/i.test(account) && bucket && access && secret,
    "Private video storage is not configured.",
  );
  const s3 =
    client ||
    new S.S3Client({
      region: "auto",
      endpoint: "https://" + account + ".r2.cloudflarestorage.com",
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: access, secretAccessKey: secret },
    });
  const params = (f) => ({ Bucket: bucket, Key: f.key });
  const missing = (e) => e.$metadata?.httpStatusCode === 404;
  async function parts(f) {
    const result = await s3.send(
      new S.ListPartsCommand({
        ...params(f),
        UploadId: f.uploadId,
        MaxParts: 100,
      }),
    );
    check(!result.IsTruncated, "Invalid multipart session.");
    return result.Parts || [];
  }
  async function verify(f) {
    const res = await s3.send(new S.HeadObjectCommand(params(f)));
    check(
      res.ContentLength === f.size && res.ContentType === f.type,
      "Uploaded video does not match its declared size or type.",
    );
    const head = await s3.send(
      new S.GetObjectCommand({ ...params(f), Range: "bytes=0-31" }),
    );
    const data = Buffer.from(await head.Body.transformToByteArray());
    check(
      f.type === "video/webm"
        ? data.subarray(0, 4).toString("hex") === "1a45dfa3"
        : data.subarray(4, 8).toString() === "ftyp",
      "Unsupported video container.",
    );
  }
  return {
    start: async (f) =>
      (
        await s3.send(
          new S.CreateMultipartUploadCommand({
            ...params(f),
            ContentType: f.type,
          }),
        )
      ).UploadId,
    async resume(f) {
      try {
        return (await parts(f)).map((p) => p.PartNumber);
      } catch (e) {
        if (!missing(e)) throw e;
        await verify(f);
        return Array.from(
          { length: Math.ceil(f.size / PART) },
          (_, i) => i + 1,
        );
      }
    },
    sign: (f, n) =>
      getSignedUrl(
        s3,
        new S.UploadPartCommand({
          ...params(f),
          UploadId: f.uploadId,
          PartNumber: n,
          ContentLength: Math.min(PART, f.size - (n - 1) * PART),
        }),
        { expiresIn: 600, signableHeaders: new Set(["content-length"]) },
      ),
    async finish(f) {
      let uploaded;
      try {
        uploaded = await parts(f);
      } catch (e) {
        if (!missing(e)) throw e;
        return verify(f);
      }
      check(
        uploaded.length === Math.ceil(f.size / PART) &&
          uploaded.every(
            (p, i) =>
              p.PartNumber === i + 1 &&
              p.Size === Math.min(PART, f.size - i * PART),
          ),
        "Upload all video parts before submitting.",
      );
      try {
        await s3.send(
          new S.CompleteMultipartUploadCommand({
            ...params(f),
            UploadId: f.uploadId,
            MultipartUpload: {
              Parts: uploaded.map(({ ETag, PartNumber }) => ({
                ETag,
                PartNumber,
              })),
            },
          }),
        );
      } catch (e) {
        if (!missing(e)) throw e;
      }
      await verify(f);
    },
    download: (f, attachment = false) =>
      getSignedUrl(
        s3,
        new S.GetObjectCommand({
          ...params(f),
          ...(attachment ? { ResponseContentDisposition: "attachment" } : {}),
        }),
        { expiresIn: 300 },
      ),
    remove: (f) => s3.send(new S.DeleteObjectCommand(params(f))),
    async abort(f) {
      if (!f.uploadId) return;
      try {
        await s3.send(
          new S.AbortMultipartUploadCommand({
            ...params(f),
            UploadId: f.uploadId,
          }),
        );
      } catch (e) {
        if (!missing(e)) throw e;
      }
    },
  };
}
module.exports = { storage };
