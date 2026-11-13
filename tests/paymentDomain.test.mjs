import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const D = require('../functions/paymentDomain.js');
const plan = { PlanName: 'Pro', PlanAmount: '999.99', Day_value: 30, Type: 'Pro', downloads: 50, Launch: true };

test('money is integer paise with a maximum of two decimal places', () => {
  assert.equal(D.money('999.99'), 99999);
  assert.equal(D.money(399), 39900);
  for (const value of [-1, '0.001', Infinity, NaN, '1e3', {}, true, '', ' 500']) assert.throws(() => D.money(value));
});
test('discount then GST rounds half up to paise, not whole rupees', () => {
  assert.deepEqual(D.calculatePrice(plan, { user_discount: '12.50' }), { currency: 'INR', basePaise: 99999, discountBps: 1250, discountPaise: 12500, taxablePaise: 87499, gstBps: 1800, gstPaise: 15750, totalPaise: 103249 });
  assert.throws(() => D.calculatePrice(plan, { user_discount: 100 }));
  assert.throws(() => D.calculatePrice({ PlanAmount: '100000' }));
});
test('legacy plans get deterministic IDs; stable IDs survive price edits and reorder', () => {
  const a = D.normalizePlan(plan, 'c1'), b = D.normalizePlan(plan, 'c1');
  assert.equal(a.planId, b.planId);
  assert.notEqual(a.planId, D.normalizePlan(plan, 'c2').planId);
  assert.equal(D.normalizePlan({ ...plan, planId: a.planId, PlanAmount: '600' }, 'c1').planId, a.planId);
  assert.throws(() => D.companyPlans({ Plans: [{ ...plan, planId: 'same' }, { ...plan, planId: 'same' }] }, 'c1'));
});
test('commission uses discounted value before GST and parent bonus is a percentage of child commission', () => {
  const members = [{ id: 'direct', active: true, uplineBonusPercentage: 10 }, { id: 'parent', active: true }];
  assert.deepEqual(D.calculateCommissions(90000, { marketing_member_percentage: 20 }, members).map(r => r.amountPaise), [18000, 1800]);
  assert.throws(() => D.calculateCommissions(90000, { marketing_member_percentage: 100 }, members));
  assert.throws(() => D.calculateCommissions(90000, { marketing_member_percentage: 20 }, [members[0], members[0]]));
});
test('checkout and raw-body webhook HMACs reject tampering and malformed signatures', () => {
  const body = Buffer.from('{ "event": "payment.captured" }');
  const signature = crypto.createHmac('sha256', 'test_secret').update(body).digest('hex');
  assert.equal(D.signatureValid('test_secret', body, signature), true);
  assert.equal(D.signatureValid('wrong_secret', body, signature), false);
  assert.equal(D.signatureValid('test_secret', Buffer.from('{"event":"payment.captured"}'), signature), false);
  for (const value of ['', '0', 'zz'.repeat(32), null]) assert.equal(D.signatureValid('test_secret', body, value), false);
});
test('renewal queues after expiry and unlimited access cannot leak into a later limited plan', () => {
  const time = 1800000000000;
  const first = { id: 'p_first', uid: 'mobile_9999999999', mobileNo: '9999999999', companyId: 'c1', orderId: 'order_first', plan: { ...plan, unlimitedDownloads: true } };
  const second = { ...first, id: 'p_second', plan: { ...plan, unlimitedDownloads: false } };
  const ent1 = D.nextEntitlement(null, first, time);
  const ent2 = D.nextEntitlement(ent1, second, time + 1000);
  assert.equal(ent2.grants[1].startsAtMs, time + 30 * D.DAY_MS);
  assert.equal(ent2.expiresAtMs, time + 60 * D.DAY_MS);
  assert.equal(D.entitlementSummary(ent2, time + 31 * D.DAY_MS).unlimitedDownloads, false);
  assert.equal(D.entitlementSummary(ent2, time + 61 * D.DAY_MS).status, 'expired');
});
test('strict input rejects financial injection and path traversal', () => {
  assert.throws(() => D.input({ companyId: 'c1', amount: 1 }, ['companyId']));
  assert.throws(() => D.id('../c1'));
  assert.throws(() => D.couponCode('ABC 12'));
});
