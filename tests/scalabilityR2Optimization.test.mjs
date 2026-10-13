import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { keyFromPublicUrl, publicObjectUrl } = require('../functions/r2.js');
const source = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('new R2 template URLs use custom domain while old URLs can still be resolved for cleanup', () => {
  const config = {
    accountId: 'test-account', accessKeyId: 'test-key', secretAccessKey: 'test-secret',
    bucket: 'mlmlive-media', publicBaseUrl: 'https://cdn.mlmposter.com',
    legacyPublicBaseUrls: ['https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev'],
  };
  const key = 'templates/id01/graphics/example.webp';
  assert.equal(publicObjectUrl(config, key), `https://cdn.mlmposter.com/${key}`);
  assert.equal(keyFromPublicUrl(config, `https://cdn.mlmposter.com/${key}`), key);
  assert.equal(keyFromPublicUrl(config, `https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev/${key}`), key);
  assert.equal(keyFromPublicUrl(config, `https://attacker.example/${key}`), '');
  assert.equal(keyFromPublicUrl(config, `https://cdn.mlmposter.com.evil.example/${key}`), '');
});

test('profile custom/legacy URLs map only to the expected bucket key', () => {
  const config = {
    publicBaseUrl: 'https://profile.mlmposter.com',
    legacyPublicBaseUrls: ['https://pub-a9fc3713abb3442ba09ff324db4e136f.r2.dev'],
  };
  const key = 'mlmprofiles/user01/profile/a.webp';
  assert.equal(keyFromPublicUrl(config, `https://profile.mlmposter.com/${key}`), key);
  assert.equal(keyFromPublicUrl(config, `https://pub-a9fc3713abb3442ba09ff324db4e136f.r2.dev/${key}`), key);
  assert.equal(keyFromPublicUrl(config, `https://cdn.mlmposter.com/${key}`), '');
});

test('Admin heavy tabs do not automatically issue full Firestore collection reads', () => {
  const templates = source('src/Pages/Templates/TemplateHome.jsx');
  const reports = source('src/Pages/Templates/TemplateData.jsx');
  const companies = source('src/Pages/companies/CompaniesHome.jsx');
  const leads = source('src/Pages/Leads/Leads.jsx');
  assert.doesNotMatch(templates, /useEffect\(\(\) => \{ fetchTemplates\(\); \}/);
  assert.doesNotMatch(reports, /useEffect\(\(\) => \{ fetchAll\(\); \}/);
  assert.doesNotMatch(companies, /useEffect\(\(\) => \{\s*fetchCompanies\(\)/);
  assert.doesNotMatch(leads, /useEffect\(\(\) => \{ fetchAll\(\); \}/);
  assert.match(leads, />Fetch User Leads</);
  assert.match(companies, /Fetch Companies/);
  assert.match(templates, /Click <span className="font-semibold text-violet-500">Refresh/);
  assert.match(reports, /Fetch Template Data/);
});

test('Catalog version is published no-store and functions use custom CDN domain', () => {
  const backend = source('functions/index.js');
  const env = source('functions/.env.mlmbooster-a4887');
  assert.match(env, /R2_PUBLIC_BASE_URL=https:\/\/cdn\.mlmposter\.com/);
  assert.match(backend, /catalogKey\.version\(\),[\s\S]*?"no-store"/);
  assert.match(backend, /legacyPublicBaseUrls: \["https:\/\/pub-/);
});

test('serialized legacy R2 template media can use CDN without rewriting Firestore records', () => {
  const { normalizeR2TemplateUrl } = require('../functions/templateCdnUrls.js');
  const legacy = 'https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev/templates/id01/graphics/test.webp';
  assert.equal(normalizeR2TemplateUrl(legacy), 'https://cdn.mlmposter.com/templates/id01/graphics/test.webp');
  assert.equal(normalizeR2TemplateUrl(legacy, 'https://my-cdn.example'), 'https://my-cdn.example/templates/id01/graphics/test.webp');
  const firebase = 'https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/media.png?alt=media';
  assert.equal(normalizeR2TemplateUrl(firebase), firebase);
  const profile = 'https://pub-a9fc3713abb3442ba09ff324db4e136f.r2.dev/mlmprofiles/id/a.webp';
  assert.equal(normalizeR2TemplateUrl(profile), profile);
  assert.equal(normalizeR2TemplateUrl('https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev.evil.example/templates/x'), 'https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev.evil.example/templates/x');
});
