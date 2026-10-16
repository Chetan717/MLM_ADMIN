import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createPresignedPutUrl, publicObjectUrl, keyFromPublicUrl } = require("../functions/r2.js");
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const config = {
  accountId: "abc123",
  accessKeyId: "ACCESSKEY",
  secretAccessKey: "secret-key",
  bucket: "mlmlive-media",
  publicBaseUrl: "https://cdn.mlmlive.in",
};

test("R2 helper creates time-limited S3 PUT URL and stable public URL", () => {
  const key = "templates/template123/showcase/test.webp";
  const signed = createPresignedPutUrl(config, key, 600, "image/webp");
  assert.match(signed, /^https:\/\/abc123\.r2\.cloudflarestorage\.com\/mlmlive-media\/templates\/template123\/showcase\/test\.webp\?/);
  assert.match(signed, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(signed, /X-Amz-SignedHeaders=content-type%3Bhost/);
  assert.match(signed, /X-Amz-Signature=/);
  assert.equal(publicObjectUrl(config, key), `https://cdn.mlmlive.in/${key}`);
  assert.equal(keyFromPublicUrl(config, `https://cdn.mlmlive.in/${key}`), key);
});

test("all Admin image/video uploads use R2 only, without Firebase Storage fallback", async () => {
  const [add, edit, imageUploader, videoUploader, functions] = await Promise.all([
    read("src/Pages/Templates/Forms/AddTemplate.jsx"),
    read("src/Pages/Templates/Forms/EditTemplate.jsx"),
    read("src/Utils/Imageuploadinput.jsx"),
    read("src/Utils/VideoUploadInput.jsx"),
    read("functions/index.js"),
  ]);
  assert.match(add, /provider="r2"/);
  assert.match(edit, /provider="r2"/);
  assert.match(add, /templates\/\$\{templateId\}/);
  assert.match(edit, /templates\/\$\{id\}/);
  assert.match(imageUploader, /provider = "r2"/);
  assert.match(imageUploader, /uploadTemplateAssetToR2/);
  assert.match(videoUploader, /provider = "r2"/);
  assert.match(videoUploader, /uploadTemplateAssetToR2/);
  assert.match(functions, /exports\.panelCreateR2AdminMediaUpload/);
  assert.match(functions, /exports\.panelCreateR2TemplateUpload/);
  assert.match(functions, /exports\.panelRebuildTemplateCatalog/);
  assert.match(functions, /exports\.publishTemplateCatalogOnWrite/);
  assert.match(functions, /publishTemplateCatalogIncrementally/);
  assert.match(functions, /withTemplateCatalogLock/);
  assert.match(functions, /latestSnapshot/);
});


test("CDN full sync avoids per-template bootstrap explosion and uses a long client timeout", async () => {
  const [home, functions] = await Promise.all([
    read("src/Pages/Templates/TemplateHome.jsx"),
    read("functions/index.js"),
  ]);
  assert.match(home, /panelRebuildTemplateCatalog", \{ timeout: 15 \* 60 \* 1000 \}/);
  assert.match(functions, /TEMPLATE_BOOTSTRAP_DETAIL_TYPES = new Set\(\["Festival"\]\)/);
  assert.match(functions, /const bootstrapDetailItems = visible\.filter/);
  assert.match(functions, /detailObjects: bootstrapDetailItems\.length/);
});


test("Home General CDN catalog publishes every visible General type and version is uncached", async () => {
  const functions = await read("functions/index.js");
  assert.match(functions, /Home General now mirrors every visible General type/);
  assert.match(functions, /for \(const \[type, rawItems\] of generalGroups\)/);
  assert.match(functions, /if \(descriptor\.kind === "general"\)/);
  assert.match(functions, /async function updateHomeGeneralFromType\(type, items\)/);
  assert.match(functions, /"no-store"/);
});

test("all-General legacy JSON is published to R2 and kept live on template writes", async () => {
  const functions = await read("functions/index.js");
  assert.match(functions, /generalMaster: \(\) => "catalog\/v1\/genaral_template_firestore_data\.json"/);
  assert.match(functions, /function generalMasterPayloadFromItems\(items\)/);
  assert.match(functions, /async function updateGeneralMasterCatalog\(templateId, beforeData, currentData\)/);
  assert.match(functions, /await updateGeneralMasterCatalog\(templateId, beforeData, currentData\)/);
  assert.match(functions, /generalMasterPayloadFromItems\(allGeneralItems\)/);
});
