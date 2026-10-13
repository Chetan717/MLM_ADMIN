import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const env = fs.readFileSync(new URL("../functions/.env.mlmbooster-a4887", import.meta.url), "utf8");

test("profile R2 bucket has authenticated signed upload and delete callables", () => {
  assert.match(source, /exports\.createR2ProfileUpload = onCall/);
  assert.match(source, /exports\.deleteR2ProfileObject = onCall/);
  assert.match(source, /if \(!request\.auth\?\.uid\)/);
  assert.match(source, /mlmprofiles\/\$\{safeUid\}/);
  assert.match(source, /R2_PROFILE_BUCKET/);
  assert.match(source, /R2_PROFILE_PUBLIC_BASE_URL/);
});

test("profile bucket production env points at the migrated public R2 bucket", () => {
  assert.match(env, /R2_PROFILE_BUCKET=mlmlive-storage-private/);
  assert.match(env, /R2_PROFILE_PUBLIC_BASE_URL=https:\/\/profile\.mlmposter\.com/);
});
