import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const installer = fileURLToPath(new URL('../tools/install-payment-rules.mjs', import.meta.url));
function install(body) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-rules-'));
  try {
    const input = path.join(temp, 'current.rules'), output = path.join(temp, 'merged.rules');
    fs.writeFileSync(input, `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { ${body} } }`);
    execFileSync(process.execPath, [installer, input, output], { stdio: 'pipe' }); return fs.readFileSync(output, 'utf8');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
test('rules installer replaces old financial permissions and keeps unrelated named collection rules', () => {
  const merged = install('match /subscription/{id} { allow write: if true; } match /other/{id} { allow read: if true; }');
  assert.equal((merged.match(/match \/subscription\//g) || []).length, 1);
  assert.match(merged, /match \/other\/\{id\} \{ allow read: if true; \}/);
  assert.match(merged, /match \/paymentPurchases/);
});
test('rules installer refuses overlapping broad allows; default-deny catchalls are safe', () => {
  assert.throws(() => install('match /{document=**} { allow read, write: if request.auth != null; }'));
  assert.match(install('match /{document=**} { allow read, write: if false; }'), /paymentPanel/);
});
