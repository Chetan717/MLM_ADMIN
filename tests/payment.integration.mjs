import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const appRequire = createRequire(new URL('../package.json', import.meta.url));
const toolsRequire = process.env.PAYMENT_TEST_TOOLS ? createRequire(`${process.env.PAYMENT_TEST_TOOLS}/package.json`) : appRequire;
const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = toolsRequire('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, collection, query, where, getDocs, limit } = toolsRequire('firebase/firestore');
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = functionsRequire('firebase-admin/firestore');
const { createPaymentService } = functionsRequire('./paymentService');
const D = functionsRequire('./paymentDomain');
const PROJECT = 'demo-mlmlive-payment';
const UID = 'mobile_9999999999';
const mobileNo = '9999999999';
let env, adminApp, db, service, gateway, config, time, posts, orders, payments;
const req = data => ({ data, auth: { uid: UID, token: { mobileNo, auth_time: time / 1000 } }, rawRequest: { ip: '127.0.0.1' } });
const hmac = (body, secret = 'test_key_secret') => crypto.createHmac('sha256', secret).update(body).digest('hex');
const plan = { planId: 'plan_pro', PlanName: 'Company Pro', PlanAmount: '1000', Day_value: 30, Duration: '1 Month', Type: 'Pro', downloads: 50, Launch: true };
const owner = data => env.authenticatedContext(UID, { mobileNo }).firestore();
async function quote(couponCode = '') { return service.quote(req({ companyId: 'company_a', planId: plan.planId, couponCode })); }
async function create(q, requestId = crypto.randomUUID()) { return service.create(req({ companyId: 'company_a', planId: plan.planId, couponCode: q.couponCode, quoteId: q.quoteId, requestId })); }
function capture(checkout, paymentStatus = 'captured') {
  const order = orders.get(checkout.orderId);
  order.status = paymentStatus === 'captured' ? 'paid' : 'attempted';
  order.amount_paid = paymentStatus === 'captured' ? order.amount : 0;
  order.amount_due = paymentStatus === 'captured' ? 0 : order.amount;
  const payment = { id: `pay_${checkout.purchaseId.slice(2)}`, order_id: order.id, amount: order.amount, currency: 'INR', status: paymentStatus, captured: paymentStatus === 'captured', amount_refunded: 0 };
  payments.set(payment.id, payment); return payment;
}
const verify = (checkout, payment) => service.verify(req({ purchaseId: checkout.purchaseId, razorpay_order_id: checkout.orderId, razorpay_payment_id: payment.id, razorpay_signature: hmac(`${checkout.orderId}|${payment.id}`) }));

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Run only through the local Firebase Firestore Emulator. Live projects are never used.');
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]), rules: fs.readFileSync(new URL('../firestore.payment.rules', import.meta.url), 'utf8') } });
  adminApp = initializeApp({ projectId: PROJECT }, 'payments-tests'); db = getFirestore(adminApp);
});
beforeEach(async () => {
  await env.clearFirestore(); time = 1800000000000; posts = 0; orders = new Map(); payments = new Map();
  config = { keyId: 'rzp_test_example', keySecret: 'test_key_secret', mode: 'test', enabled: true };
  gateway = {
    keyId: config.keyId,
    createOrder: async purchase => {
      posts++;
      const order = { id: `order_${posts}`, amount: purchase.price.totalPaise, currency: 'INR', receipt: purchase.id,
        status: 'created', amount_due: purchase.price.totalPaise, amount_paid: 0,
        notes: { purchaseId: purchase.id, ownerHash: D.hash(purchase.uid) } };
      orders.set(order.id, order); return structuredClone(order);
    },
    fetchOrder: async orderId => structuredClone(orders.get(orderId)),
    findOrdersByReceipt: async receipt => ({ items: [...orders.values()].filter(order => order.receipt === receipt).map(order => structuredClone(order)) }),
    fetchPayment: async paymentId => structuredClone(payments.get(paymentId)),
    fetchOrderPayments: async orderId => ({ items: [...payments.values()].filter(p => p.order_id === orderId).map(p => structuredClone(p)) }),
  };
  service = createPaymentService({ db, FieldValue, Timestamp, getConfig: () => config, now: () => time, gatewayFactory: () => gateway });
  await Promise.all([
    db.doc('users/user_a').set({ mobileNo, uid: UID, name: 'Test Customer', mteamCouponCode: 'SAVE10', referCredit: 0 }),
    db.doc('mlmprofiles/profile_a').set({ mobile: mobileNo, uid: UID, companyId: 'company_a', companyName: 'Company A' }),
    db.doc('mlmcomp/company_a').set({ name: 'Company A', active: true, launched: true, Plans: [plan] }),
    db.doc('mlmcomp/company_b').set({ name: 'Company B', active: true, launched: true, Plans: [{ ...plan, PlanAmount: 500 }] }),
    db.doc('couponcode/coupon_a').set({ code: 'SAVE10', active: true, user_discount: 10, marketing_member_percentage: 20, assigned_user: { id: 'seller' } }),
    db.doc('mteam/seller').set({ active: true, parentMteamId: 'parent', commissionPercentage: 20, uplineBonusPercentage: 10 }),
    db.doc('mteam/parent').set({ active: true, parentMteamId: '', commissionPercentage: 30 }),
  ]);
});
after(async () => { await env?.cleanup(); if (adminApp) await deleteApp(adminApp); });

test('catalog binds selected company to verified profile; refuses impersonation and unpublished companies', async () => {
  const result = await service.catalog(req({ companyId: 'company_a' })); assert.equal(result.plans.length, 1); assert.equal(result.plans[0].PlanAmount, 1000);
  await assert.rejects(service.catalog(req({ companyId: 'company_b' })), { code: 'permission-denied' });
  await assert.rejects(service.catalog({ data: { companyId: 'company_a' } }), { code: 'unauthenticated' });
  await db.doc('mlmcomp/company_a').update({ launched: false });
  await assert.rejects(service.catalog(req({ companyId: 'company_a' })), { code: 'failed-precondition' });
});
test('create rederives exact price and rejects extra amount/user fields, stale quotes and inactive coupons', async () => {
  const q = await quote('SAVE10'); assert.equal(q.price.totalPaise, 106200);
  await assert.rejects(service.create(req({ companyId: 'company_a', planId: plan.planId, quoteId: q.quoteId, requestId: 'a', amount: 1 })), { code: 'invalid-argument' });
  await db.doc('mlmcomp/company_a').update({ Plans: [{ ...plan, PlanAmount: 1200 }] });
  await assert.rejects(create(q), { code: 'failed-precondition' }); assert.equal(posts, 0);
  await db.doc('couponcode/coupon_a').update({ active: false });
  await assert.rejects(quote('SAVE10'), { code: 'failed-precondition' });
});
test('concurrent checkout requests reserve one provider order; POST never runs in transaction retries', async () => {
  const q = await quote();
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => create(q, `parallel_${i}`)));
  assert.equal(posts, 1);
  assert.equal((await db.collection('paymentPurchases').get()).size, 1);
  assert(results.some(result => result.status === 'fulfilled' && result.value.orderId));
});
test('timeout after provider accepts order does not retry POST; signed webhook recovers missing mapping', async () => {
  const original = gateway.createOrder;
  gateway.createOrder = async purchase => { await original(purchase); throw new D.PaymentError('unavailable', 'timeout'); };
  const result = await create(await quote()); assert.equal(result.status, 'creation_unknown'); assert.equal(result.orderId, '');
  await assert.rejects(create(await quote()), { code: 'unavailable' }); assert.equal(posts, 1);
  const originalOrder = [...orders.values()][0]; const checkout = { ...result, orderId: originalOrder.id }; const payment = capture(checkout);
  await service.webhook({ event: 'payment.captured', payload: { payment: { entity: payment } } }, 'evt_recovered');
  assert.equal((await db.doc(`paymentPurchases/${result.purchaseId}`).get()).data().status, 'paid');
});
test('authorized payment cannot activate; captured payment does, using frozen server order terms', async () => {
  const order = await create(await quote('SAVE10')); const authorized = capture(order, 'authorized');
  assert.equal((await verify(order, authorized)).status, 'pending'); assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 0);
  await db.doc('mlmcomp/company_a').update({ Plans: [{ ...plan, PlanAmount: 2500 }] });
  const payment = capture(order); const result = await verify(order, payment); assert.equal(result.status, 'paid');
  const sub = (await db.doc(`paymentTestSubscriptions/${result.subscriptionId}`).get()).data();
  assert.equal(sub.PaymentAmount, 1062); assert.equal(sub.gstAmount, 162); assert.equal(sub.discountAmount, 100); assert.equal(sub.download, 50);
  assert.deepEqual(sub.commissions.map(r => r.amountPaise), [18000, 1800]);
});
test('forged signature, wrong owner, currency, amount and order are refused', async () => {
  const order = await create(await quote()), payment = capture(order);
  const wrong = req({ purchaseId: order.purchaseId, razorpay_order_id: order.orderId, razorpay_payment_id: payment.id, razorpay_signature: '0'.repeat(64) });
  await assert.rejects(service.verify(wrong), { code: 'permission-denied' });
  await assert.rejects(service.status({ ...req({ purchaseId: order.purchaseId }), auth: { uid: 'mobile_8888888888', token: { mobileNo: '8888888888' } } }), { code: 'not-found' });
  for (const patch of [{ amount: 1 }, { currency: 'USD' }, { order_id: 'order_foreign' }]) {
    payments.set(payment.id, { ...payment, ...patch }); await assert.rejects(verify(order, payment), { code: 'permission-denied' });
  }
  assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 0);
});
test('verification and duplicate webhooks racing activate once, account money once and allocate commission once', async () => {
  const order = await create(await quote('SAVE10')), payment = capture(order);
  const payload = { event: 'payment.captured', payload: { payment: { entity: payment } } };
  await Promise.all([verify(order, payment), verify(order, payment), service.webhook(payload, 'evt_1'), service.webhook(payload, 'evt_2')]);
  await service.webhook(payload, 'evt_1');
  assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 1);
  assert.equal((await db.collection('paymentCommissions').get()).size, 2);
  const stats = (await db.doc('paymentStats/test_global').get()).data(); assert.equal(stats.paidOrders, 1); assert.equal(stats.netReceivedPaise, 106200);
});
test('partial/full refunds reverse money monotonically, revoke benefits and cannot be undone by captured replays', async () => {
  const order = await create(await quote('SAVE10')), payment = capture(order); await verify(order, payment);
  payment.amount_refunded = 53100; payments.set(payment.id, payment);
  const payload = { event: 'refund.processed', payload: { refund: { entity: { payment_id: payment.id } } } };
  await service.webhook(payload, 'evt_partial'); await service.webhook(payload, 'evt_partial');
  assert.equal((await db.doc('paymentStats/test_global').get()).data().netReceivedPaise, 53100);
  assert.equal((await service.history(req({ companyId: 'company_a' }))).entitlement.status, 'expired');
  payment.amount_refunded = 106200; payment.status = 'refunded'; payments.set(payment.id, payment); await service.webhook(payload, 'evt_full');
  await service.webhook({ event: 'payment.captured', payload: { payment: { entity: payment } } }, 'evt_old_capture');
  const stats = (await db.doc('paymentStats/test_global').get()).data(); assert.equal(stats.refundedPaise, 106200); assert.equal(stats.netReceivedPaise, 0); assert.equal(stats.paidOrders, 1);
  const ledger = (await db.doc(`paymentCommissions/${order.purchaseId}_seller`).get()).data(); assert.equal(ledger.reversedPaise, 18000);
});
test('refund before first confirmation records received/refunded totals but never gives active benefits', async () => {
  const order = await create(await quote()), payment = capture(order); payment.amount_refunded = payment.amount; payment.status = 'refunded'; payments.set(payment.id, payment);
  await service.webhook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: payment.id } } } }, 'evt_early_refund');
  assert.equal((await db.doc('paymentStats/test_global').get()).data().netReceivedPaise, 0);
  const subscriptions = await db.collection('paymentTestSubscriptions').get(); assert.equal(subscriptions.docs[0].data().Active, false);
});
test('renewal queues for the same company and does not extend twice after retries', async () => {
  const first = await create(await quote()), payment1 = capture(first); await verify(first, payment1);
  time += 1000; const second = await create(await quote()), payment2 = capture(second); await verify(second, payment2); await verify(second, payment2);
  const ent = (await service.history(req({ companyId: 'company_a' }))).entitlement;
  assert.equal(ent.grants.length, 2); assert.equal(ent.grants[0].expiresAtMs, ent.grants[1].startsAtMs); assert.equal(ent.expiresAtMs - ent.startsAtMs, 60 * D.DAY_MS);
});
test('kill switch, mode mismatch, expired identity, and rate limits fail closed', async () => {
  const q = await quote(); config.enabled = false; await assert.rejects(create(q), { code: 'failed-precondition' }); config.enabled = true;
  config.mode = 'live'; await assert.rejects(create(q), { code: 'failed-precondition' }); config.mode = 'test';
  const expired = req({ companyId: 'company_a' }); expired.auth.token.auth_time -= 8 * 86400; await assert.rejects(service.catalog(expired), { code: 'unauthenticated' });
  for (let i = 0; i < 25; i++) await service.quote(req({ companyId: 'company_a', planId: 'unknown' })).catch(() => {});
  await assert.rejects(quote(), { code: 'resource-exhausted' });
});
test('test-mode money and access never appear in live history, entitlement or totals', async () => {
  const order = await create(await quote()), payment = capture(order); await verify(order, payment);
  assert.equal((await service.history(req({ companyId: 'company_a' }))).items.length, 1);
  config.mode = 'live'; config.keyId = 'rzp_live_example'; gateway.keyId = config.keyId;
  const live = await service.history(req({ companyId: 'company_a' }));
  assert.equal(live.items.length, 0); assert.equal(live.entitlement, null);
  assert.deepEqual(await service.adminSummary(), {});
  assert.equal((await db.collection('subscription').get()).size, 0);
});
test('unknown creation is found by receipt without another provider POST', async () => {
  const original = gateway.createOrder;
  gateway.createOrder = async purchase => { await original(purchase); throw new D.PaymentError('unavailable', 'timeout'); };
  const order = await create(await quote());
  const providerOrder = [...orders.values()][0]; capture({ ...order, orderId: providerOrder.id });
  assert.equal((await service.status(req({ purchaseId: order.purchaseId }))).status, 'paid');
  assert.equal(posts, 1);
});
test('closing an uncreated checkout is delayed, audited and refuses any actual provider order', async () => {
  gateway.createOrder = async () => { posts++; throw new D.PaymentError('unavailable', 'timeout'); };
  const checkout = await create(await quote());
  const command = { purchaseId: checkout.purchaseId, reason: 'Provider dashboard reviewed and no order found' };
  await assert.rejects(service.closeUncreated(command, 'master'), { code: 'failed-precondition' });
  time += 2 * 3600000;
  assert.equal((await service.closeUncreated(command, 'master')).status, 'failed');
  assert.equal((await db.collection('paymentAudit').where('action', '==', 'uncreated_checkout_closed').get()).size, 1);
  assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 0);
});
test('duplicate failure notifications count the same failed payment only once', async () => {
  const checkout = await create(await quote()), payment = capture(checkout, 'failed');
  const payload = { event: 'payment.failed', payload: { payment: { entity: payment } } };
  await service.webhook(payload, 'failed_event_1'); await service.webhook(payload, 'failed_event_2');
  assert.equal((await db.doc(`paymentPurchases/${checkout.purchaseId}`).get()).data().failureCount, 1);
});
test('refund tax allocation always sums exactly to refunded paise', async () => {
  await db.doc('mlmcomp/company_a').update({ Plans: [{ ...plan, PlanAmount: '1.03' }] });
  const checkout = await create(await quote()), payment = capture(checkout); await verify(checkout, payment);
  assert.equal(payment.amount, 122);
  payment.amount_refunded = 61; payments.set(payment.id, payment);
  await service.webhook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: payment.id } } } }, 'refund_odd_paise');
  const stats = (await db.doc('paymentStats/test_global').get()).data();
  assert.equal(stats.gstRefundedPaise + stats.taxableRefundedPaise, 61);
});
test('signed-in App callables work without attestation while company and identity checks remain enforced', async () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  const handlers = functionsRequire('./index');
  const command = req({ companyId: 'company_a' });
  assert.equal(command.app, undefined);
  const catalog = await handlers.paymentCatalog.run(command);
  assert.equal(catalog.companyId, 'company_a');
  assert.equal(catalog.plans[0].PlanAmount, 1000);
  const priced = await handlers.paymentQuote.run(req({ companyId: 'company_a', planId: plan.planId }));
  assert.equal(priced.price.totalPaise, 118000);
  await assert.rejects(handlers.paymentCatalog.run({ data: command.data }), { code: 'unauthenticated' });
  await assert.rejects(handlers.paymentCatalog.run(req({ companyId: 'company_b' })), { code: 'permission-denied' });
});
test('existing Admin lead assignment needs an active authorized session without attestation', async () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  const handlers = functionsRequire('./index');
  await db.doc('_panelSessions/lead_operator').set({ panel: 'admin', revoked: false, expiresAt: Timestamp.fromMillis(Date.now() + 3600000) });
  await db.doc('mteam/seller').update({ referCode: 'REF111', assign_coupon_id: 'coupon_a' });
  const command = { data: { memberId: 'seller', userIds: ['user_a'] }, auth: { uid: 'lead_operator', token: { panel: 'admin', tabs: ['leads'], role: 'Admin', actorType: 'subuser' } } };
  assert.equal(command.app, undefined);
  assert.equal((await handlers.panelAssignPaymentMarketingUsers.run(command)).count, 1);
  const user = (await db.doc('users/user_a').get()).data(); assert.equal(user.referredByMteam, 'seller'); assert.equal(user.mteamCouponCode, 'SAVE10');
  await assert.rejects(handlers.panelAssignPaymentMarketingUsers.run({ ...command, data: { ...command.data, mteamCouponCode: 'FAKE11' } }), { code: 'invalid-argument' });
  await assert.rejects(handlers.panelAssignPaymentMarketingUsers.run({ ...command, auth: { ...command.auth, token: { panel: 'admin', tabs: [] } } }), { code: 'permission-denied' });
  await assert.rejects(handlers.panelAssignPaymentMarketingUsers.run({ data: command.data }), { code: 'unauthenticated' });
  await db.doc('_panelSessions/lead_operator').update({ revoked: true });
  await assert.rejects(handlers.panelAssignPaymentMarketingUsers.run(command), { code: 'unauthenticated' });
  await db.doc('_panelSessions/lead_operator').update({ revoked: false, expiresAt: Timestamp.fromMillis(Date.now() - 1) });
  await assert.rejects(handlers.panelAssignPaymentMarketingUsers.run(command), { code: 'unauthenticated' });
});
test('Firestore rules deny forged payment/subscription/plan and identity writes, including by signed-in Master Admin', async () => {
  const userDb = owner();
  const protectedCollections = ['subscription', 'paymentlog', 'paymentPurchases', 'paymentEntitlements', 'paymentCommissions', 'paymentStats', 'paymentDaily', 'paymentAudit', '_razorpayOrders', '_razorpayPayments', '_razorpayWebhookEvents', '_paymentLimits', '_paymentCheckoutLocks', 'couponcode', 'mteam', '_marketingCouponCodes'];
  for (const name of protectedCollections) await assertFails(setDoc(doc(userDb, `${name}/fake`), { uid: UID, mobileNo, payment: 'Success', Active: true, totalPaise: 1 }));
  await assertFails(updateDoc(doc(userDb, 'mlmcomp/company_a'), { Plans: [{ ...plan, PlanAmount: 1 }] }));
  await assertFails(updateDoc(doc(userDb, 'users/user_a'), { mteamCouponCode: 'FAKE11', referCredit: 999 }));
  await assertFails(updateDoc(doc(userDb, 'mlmprofiles/profile_a'), { companyId: 'company_b' }));
  await assertSucceeds(updateDoc(doc(userDb, 'users/user_a'), { name: 'Updated name' }));
  await assertSucceeds(getDoc(doc(userDb, 'mlmcomp/company_a')));
  await db.doc('_panelSessions/master').set({ panel: 'admin', revoked: false, expiresAt: Timestamp.fromMillis(Date.now() + 60000) });
  const admin = env.authenticatedContext('master', { panel: 'admin', role: 'Master Admin', actorType: 'owner' }).firestore();
  await assertFails(updateDoc(doc(admin, 'mlmcomp/company_a'), { Plans: [{ ...plan, PlanAmount: 1 }] }));
  await assertFails(setDoc(doc(admin, 'subscription/forged'), { payment: 'Success' }));
  await assertSucceeds(getDoc(doc(admin, 'users/user_a')));
});
test('rules expose only the authenticated user subscription and query', async () => {
  await db.doc('subscription/own').set({ mobileNo, payment: 'Success' });
  await db.doc('subscription/other').set({ mobileNo: '8888888888', payment: 'Success' });
  const userDb = owner();
  await assertSucceeds(getDocs(query(collection(userDb, 'subscription'), where('mobileNo', '==', mobileNo), limit(20))));
  await assertFails(getDoc(doc(userDb, 'subscription/other')));
  await assertFails(getDocs(collection(userDb, 'subscription')));
  await assertFails(getDocs(query(collection(userDb, 'subscription'), limit(20))));
});
