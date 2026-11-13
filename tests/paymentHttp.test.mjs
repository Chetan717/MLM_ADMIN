import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const express = require('express');
const createFunctions = require('./paymentFunctions');
const { HttpsError } = require('firebase-functions/v2/https');
let server, url;
const rows = new Map();
process.env.RAZORPAY_WEBHOOK_SECRET = 'local_test_webhook_secret';
const sign = body => crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
before(async () => {
  const db = { collection(name) { assert.equal(name, '_razorpayWebhookInbox'); return { doc(key) { return { async create(value) { if (rows.has(key)) throw { code: 6 }; rows.set(key, value); } }; } }; } };
  const requireAdmin = async () => { throw new HttpsError('unauthenticated', 'Sign in required.'); };
  const handlers = createFunctions({ db, FieldValue: {}, Timestamp: { fromMillis: value => value }, requireAssignedAdminTab: requireAdmin, requireMasterAdmin: requireAdmin });
  const app = express();
  app.post('/call/:name', express.json(), (req, res) => handlers[req.params.name](req, res));
  app.use(express.raw({ type: 'application/json', limit: '300kb' }));
  app.use((req, res) => { req.rawBody = req.body; return handlers.razorpayWebhook(req, res); });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
const post = (body, signature, eventId = 'untrusted_header') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId }, body });

test('App and Admin callable HTTP requests need no App Check token and still reject missing Firebase login', async () => {
  for (const name of ['paymentCatalog', 'paymentVerify', 'panelPaymentOverview', 'panelReconcilePayment']) {
    const response = await fetch(`${url}/call/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) });
    assert.equal(response.status, 401, name);
    assert.equal((await response.json()).error.status, 'UNAUTHENTICATED', name);
  }
  assert.equal(rows.size, 0);
});

test('webhook rejects methods, bad HMAC, changed raw bytes and oversized bodies before durable intake', async () => {
  assert.equal((await fetch(url)).status, 405);
  const raw = '{ "event": "payment.captured", "payload": {"payment":{"entity":{"id":"pay_http"}}}}';
  assert.equal((await post(raw, '0'.repeat(64))).status, 401);
  assert.equal((await post(JSON.stringify(JSON.parse(raw)), sign(raw))).status, 401);
  const large = JSON.stringify({ event: 'payment.captured', extra: 'x'.repeat(263000) });
  assert.equal((await post(large, sign(large))).status, 413);
  assert.equal(rows.size, 0);
});
test('signed webhook is durably queued before acknowledgement, with no card/body data; header changes cannot evade deduplication', async () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_http', card: { number: 'must_not_be_saved' }, email: 'not-saved@example.test' } } } });
  assert.equal((await post(body, sign(body), 'evt_one')).status, 200);
  assert.equal((await post(body, sign(body), 'evt_two')).status, 200);
  assert.equal(rows.size, 1);
  const row = [...rows.values()][0]; assert.equal(row.paymentId, 'pay_http'); assert.equal(row.status, 'pending');
  assert.equal(JSON.stringify(row).includes('must_not_be_saved'), false);
  assert.equal(JSON.stringify(row).includes('not-saved'), false);
});
test('unsupported signed webhook is ignored without database/provider work', async () => {
  const size = rows.size, body = JSON.stringify({ event: 'unrelated.event', payload: {} });
  assert.equal((await post(body, sign(body))).status, 200); assert.equal(rows.size, size);
});
