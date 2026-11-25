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
async function quote(couponCode = '') { return service.quote(req({ planId: plan.planId, couponCode })); }
async function create(q, requestId = crypto.randomUUID()) { return service.create(req({ planId: plan.planId, couponCode: q.couponCode, quoteId: q.quoteId, requestId })); }
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
    db.doc('appPlans/main').set({ Plans: [plan], version: 1 }),
    db.doc('mlmcomp/company_a').set({ name: 'Company A', active: true, launched: true, Plans: [plan] }),
    db.doc('mlmcomp/company_b').set({ name: 'Company B', active: true, launched: true, Plans: [{ ...plan, PlanAmount: 500 }] }),
    db.doc('couponcode/coupon_a').set({ code: 'SAVE10', active: true, user_discount: 10, marketing_member_percentage: 20, assigned_user: { id: 'seller' } }),
    db.doc('mteam/seller').set({ active: true, parentMteamId: 'parent', commissionPercentage: 20, uplineBonusPercentage: 10 }),
    db.doc('mteam/parent').set({ active: true, parentMteamId: '', commissionPercentage: 30 }),
  ]);
});
after(async () => { await env?.cleanup(); if (adminApp) await deleteApp(adminApp); });

test('all accounts use the central app catalog without a company or MLM profile', async () => {
  let result = await service.catalog(req({})); assert.equal(result.scope, 'app'); assert.equal(result.plans[0].PlanAmount, 1000);
  await db.doc('mlmprofiles/profile_a').delete();
  await db.doc('mlmcomp/company_a').update({ launched: false, active: false, Plans: [{ ...plan, PlanAmount: 1 }] });
  result = await service.catalog(req({})); assert.equal(result.plans[0].PlanAmount, 1000);
  await assert.rejects(service.catalog(req({ companyId: 'company_b' })), { code: 'invalid-argument' });
  await assert.rejects(service.catalog({ data: {} }), { code: 'unauthenticated' });
});
test('create rederives exact price and rejects extra amount/user fields, stale quotes and inactive coupons', async () => {
  const q = await quote('SAVE10'); assert.equal(q.price.totalPaise, 106200);
  await assert.rejects(service.create(req({ planId: plan.planId, quoteId: q.quoteId, requestId: 'a', amount: 1 })), { code: 'invalid-argument' });
  await db.doc('appPlans/main').update({ Plans: [{ ...plan, PlanAmount: 1200 }] });
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
  const resumed = await create(await quote()); assert.equal(resumed.purchaseId, result.purchaseId); assert.equal(resumed.status, 'creation_unknown'); assert.equal(posts, 1);
  const originalOrder = [...orders.values()][0]; const checkout = { ...result, orderId: originalOrder.id }; const payment = capture(checkout);
  await service.webhook({ event: 'payment.captured', payload: { payment: { entity: payment } } }, 'evt_recovered');
  assert.equal((await db.doc(`paymentPurchases/${result.purchaseId}`).get()).data().status, 'paid');
});
test('authorized payment cannot activate; captured payment does, using frozen server order terms', async () => {
  const order = await create(await quote('SAVE10')); const authorized = capture(order, 'authorized');
  assert.equal((await verify(order, authorized)).status, 'pending'); assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 0);
  await db.doc('appPlans/main').update({ Plans: [{ ...plan, PlanAmount: 2500 }] });
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
  assert.equal((await service.history(req({}))).entitlement.status, 'expired');
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
test('renewal is blocked while active and starts after expiry without duplicate retry grants', async () => {
  const first = await create(await quote()), payment1 = capture(first); await verify(first, payment1);
  await assert.rejects(quote(), /already have an active plan/);
  time += 30 * D.DAY_MS + 1000; const second = await create(await quote()), payment2 = capture(second); await verify(second, payment2); await verify(second, payment2);
  const ent = (await service.history(req({}))).entitlement;
  assert.equal(ent.grants.length, 2); assert(ent.grants[0].expiresAtMs <= ent.grants[1].startsAtMs); assert.equal(ent.grants[1].startsAtMs,time); assert.equal(ent.expiresAtMs - ent.startsAtMs, 30 * D.DAY_MS);
});
test('kill switch, mode mismatch, expired identity, and rate limits fail closed', async () => {
  const q = await quote(); config.enabled = false; await assert.rejects(create(q), { code: 'failed-precondition' }); config.enabled = true;
  config.mode = 'live'; await assert.rejects(create(q), { code: 'failed-precondition' }); config.mode = 'test';
  const expired = req({}); expired.auth.token.auth_time -= 8 * 86400; await assert.rejects(service.catalog(expired), { code: 'unauthenticated' });
  for (let i = 0; i < 25; i++) await service.quote(req({ planId: 'unknown' })).catch(() => {});
  await assert.rejects(quote(), { code: 'resource-exhausted' });
});
test('test-mode money and access never appear in live history, entitlement or totals', async () => {
  const order = await create(await quote()), payment = capture(order); await verify(order, payment);
  assert.equal((await service.history(req({}))).items.length, 1);
  config.mode = 'live'; config.keyId = 'rzp_live_example'; gateway.keyId = config.keyId;
  const live = await service.history(req({}));
  assert.equal(live.items.length, 0); assert.equal(live.entitlement.status, 'expired');
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
  await db.doc('appPlans/main').update({ Plans: [{ ...plan, PlanAmount: '1.03' }] });
  const checkout = await create(await quote()), payment = capture(checkout); await verify(checkout, payment);
  assert.equal(payment.amount, 122);
  payment.amount_refunded = 61; payments.set(payment.id, payment);
  await service.webhook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: payment.id } } } }, 'refund_odd_paise');
  const stats = (await db.doc('paymentStats/test_global').get()).data();
  assert.equal(stats.gstRefundedPaise + stats.taxableRefundedPaise, 61);
});
test('signed-in App callables work without attestation while identity checks and app scope remain enforced', async () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  const handlers = functionsRequire('./index');
  const command = req({});
  assert.equal(command.app, undefined);
  const catalog = await handlers.paymentCatalog.run(command);
  assert.equal(catalog.scope, 'app');
  assert.equal(catalog.plans[0].PlanAmount, 1000);
  const priced = await handlers.paymentQuote.run(req({ planId: plan.planId }));
  assert.equal(priced.price.totalPaise, 118000);
  await assert.rejects(handlers.paymentCatalog.run({ data: command.data }), { code: 'unauthenticated' });
  await assert.rejects(handlers.paymentCatalog.run(req({ companyId: 'company_b' })), { code: 'invalid-argument' });
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
  const protectedCollections = ['subscription', 'paymentlog', 'appPlans', 'paymentPurchases', 'paymentEntitlements', 'paymentCommissions', 'paymentStats', 'paymentDaily', 'paymentAudit', '_razorpayOrders', '_razorpayPayments', '_razorpayWebhookEvents', '_paymentLimits', '_paymentCheckoutLocks', 'couponcode', 'mteam', '_marketingCouponCodes'];
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

test('video purchase stores service validity and never grants live poster subscription', async () => {
  config.mode = 'live'; config.keyId = 'rzp_live_example'; gateway.keyId = config.keyId;
  await db.doc('appPlans/main').update({ Plans: [{ ...plan, serviceType: 'video' }] });
  const order = await create(await quote());
  const result = await verify(order, capture(order));
  assert.equal(result.status, 'paid');
  assert.equal(result.serviceGrants.length, 1);
  assert.equal(result.serviceGrants[0].serviceType, 'video');
  assert.equal((await db.collection('subscription').get()).size, 0);
  assert.equal((await db.collection('paymentVideoSubscriptions').get()).size, 1);
  const ent = await service.entitlement(req({}));
  assert.equal(ent.entitlement.services.video.status, 'active');
  assert.equal(ent.entitlement.services.poster.status, 'expired');
  await assertFails(setDoc(doc(owner(), 'paymentVideoSubscriptions/injected'), { Active: true }));
});

test('captured combo grants both services once; partial refund removes both grants', async () => {
  await db.doc('appPlans/main').update({ Plans: [{ ...plan, serviceType: 'combo' }] });
  const order = await create(await quote());
  const payment = capture(order);
  await Promise.all([verify(order, payment), verify(order, payment)]);
  let ent = (await service.entitlement(req({}))).entitlement;
  assert.equal(ent.grants.length, 2);
  assert.equal(ent.services.poster.status, 'active'); assert.equal(ent.services.video.status, 'active');
  payment.amount_refunded = 100;
  payments.set(payment.id, payment);
  const result = await verify(order, payment);
  assert.equal(result.status, 'partially_refunded');
  ent = (await service.entitlement(req({}))).entitlement;
  assert.equal(ent.services.poster.status, 'expired'); assert.equal(ent.services.video.status, 'expired');
});

test('authorized bank payment stays pending after checkout timeout and preserves the same order', async () => {
  const order = await create(await quote()); capture(order, 'authorized');
  time += 31 * 60000;
  const pending = await service.status(req({ purchaseId: order.purchaseId }));
  assert.equal(pending.status, 'pending'); assert(pending.expiresAtMs > time);
  const resumed = await create(await quote());
  assert.equal(resumed.orderId, order.orderId); assert.equal(posts, 1);
  assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 0);
});

test('an abandoned checkout is marked expired only after the provider confirms no bank payment is pending', async () => {
  const order = await create(await quote()); time += 31 * 60000;
  const result = await service.status(req({ purchaseId: order.purchaseId }));
  assert.equal(result.status, 'expired');
  assert.equal((await db.doc(`paymentPurchases/${order.purchaseId}`).get()).data().status, 'expired');
  assert.equal((await db.collection('paymentTestSubscriptions').get()).size, 0);
});

test('different company profiles receive the same app catalog and server quote', async () => {
  const secondUid='mobile_8888888888';
  await db.doc('users/user_b').set({uid:secondUid,mobileNo:'8888888888',name:'Other user'});
  await db.doc('mlmprofiles/profile_b').set({uid:secondUid,mobile:'8888888888',companyId:'company_b'});
  const second=data=>({...req(data),auth:{uid:secondUid,token:{mobileNo:'8888888888',auth_time:time/1000}}});
  assert.deepEqual((await service.catalog(req({}))).plans,(await service.catalog(second({}))).plans);
  assert.deepEqual((await quote()).price,(await service.quote(second({planId:plan.planId}))).price);
  await db.doc('appPlans/main').update({Plans:[{...plan,Launch:false}]});
  assert.equal((await service.catalog(req({}))).plans.length,0);
  assert.equal((await service.catalog(second({}))).plans.length,0);
});

test('a purchased plan is app-wide and does not depend on selecting or changing a company',async()=>{
  await db.doc('mlmprofiles/profile_a').delete();
  const order=await create(await quote());
  assert.equal(order.scope,'app');assert.equal(order.companyId,'');
  await verify(order,capture(order));
  const first=(await service.entitlement(req({}))).entitlement;
  await db.doc('mlmprofiles/profile_a').set({mobile:mobileNo,uid:UID,companyId:'company_b'});
  const after=(await service.entitlement(req({}))).entitlement;
  assert.equal(after.scope,'app');assert.equal(after.expiresAtMs,first.expiresAtMs);assert.equal(after.grants.length,1);
  assert.equal((await service.history(req({}))).items.length,1);
});

test('only authorized Admin can CRUD the single app catalog with optimistic version checks',async()=>{
  process.env.GCLOUD_PROJECT=PROJECT;
  const handlers=functionsRequire('./index');
  await db.doc('_panelSessions/plan_admin').set({panel:'admin',revoked:false,expiresAt:Timestamp.fromMillis(Date.now()+3600000)});
  const command=data=>({data,auth:{uid:'plan_admin',token:{panel:'admin',role:'Admin',actorType:'staff',tabs:['companies']}}});
  const initial=await handlers.panelAppPlans.run(command({}));assert.equal(initial.version,1);
  const updated=await handlers.panelSaveAppPlans.run(command({plans:[{...plan,PlanAmount:1500}],expectedVersion:1}));
  assert.equal(updated.version,2);assert.equal(updated.plans[0].PlanAmount,1500);
  assert.equal((await db.doc('mlmcomp/company_a').get()).data().Plans[0].PlanAmount,'1000');
  await assert.rejects(handlers.panelSaveAppPlans.run(command({plans:[],expectedVersion:1})),{code:'failed-precondition'});
  await assert.rejects(handlers.panelSaveAppPlans.run(command({plans:[{...plan,Day_value:-1}],expectedVersion:2})),{code:'failed-precondition'});
  const denied=command({});denied.auth.token.tabs=['userdashboard'];
  await assert.rejects(handlers.panelAppPlans.run(denied),{code:'permission-denied'});
  await assert.rejects(handlers.panelAppPlans.run({data:{}}),{code:'unauthenticated'});
  assert.equal((await handlers.panelSaveAppPlans.run(command({plans:[],expectedVersion:2}))).plans.length,0);
});

test('company metadata saves preserve old plan records but cannot set app plan prices',async()=>{
  process.env.GCLOUD_PROJECT=PROJECT;
  const handlers=functionsRequire('./index');
  await db.doc('_panelSessions/company_admin').set({panel:'admin',revoked:false,expiresAt:Timestamp.fromMillis(Date.now()+3600000)});
  const company={name:'Company A renamed',active:true,launched:true};
  const command={data:{companyId:'company_a',expectedPlansVersion:0,company},auth:{uid:'company_admin',token:{panel:'admin',role:'Admin',actorType:'staff',tabs:['companies']}}};
  await handlers.panelSavePaymentCompany.run(command);
  assert.equal((await db.doc('mlmcomp/company_a').get()).data().Plans[0].PlanAmount,'1000');
  assert.equal((await db.doc('appPlans/main').get()).data().Plans[0].PlanAmount,'1000');
  await assert.rejects(handlers.panelSavePaymentCompany.run({...command,data:{...command.data,company:{...company,Plans:[{...plan,PlanAmount:1}]}}}),{code:'invalid-argument'});
});

test('legacy paid allowances migrate once with their balances, validity and test/live isolation intact',async()=>{
  const legacyId='p_'+'b'.repeat(36);const expires=time+10*D.DAY_MS;
  const price=D.calculatePrice(plan);
  await db.doc('paymentPurchases/'+legacyId).set({id:legacyId,uid:UID,mobileNo,companyId:'company_a',companyName:'Company A',plan,price,commissions:[],mode:'test',keyId:config.keyId,status:'paid',paymentId:'pay_legacy',orderId:'order_legacy',subscriptionId:'rzp_p_legacy',createdAtMs:time-1000,startsAtMs:time-1000,subscriptionExpiresAtMs:expires,refundedPaise:0});
  const legacyRef=db.doc('paymentEntitlements/'+D.hash(`test:${UID}:company_a`));
  await legacyRef.set({uid:UID,mobileNo,companyId:'company_a',grants:[{purchaseId:legacyId,serviceType:'poster',startsAtMs:time-1000,expiresAtMs:expires,remainingDownloads:17,unlimitedDownloads:false,revoked:false}]});
  await db.doc('paymentTestSubscriptions/rzp_p_legacy').set({uid:UID,mobileNo,Active:true,Expire:false});
  await db.doc('paymentEntitlements/'+D.hash(`live:${UID}:company_a`)).set({uid:UID,grants:[{purchaseId:'p_live_only',startsAtMs:time,expiresAtMs:expires,remainingDownloads:99999,revoked:false}]});
  let ent=(await service.entitlement(req({}))).entitlement;
  assert.equal(ent.grants.length,1);assert.equal(ent.remainingDownloads,17);assert.equal(ent.expiresAtMs,expires);
  ent=(await service.entitlement(req({}))).entitlement;assert.equal(ent.grants.length,1);
  await assert.rejects(quote(),/already have an active plan/);
  time=expires;const order=await create(await quote());await verify(order,capture(order));
  ent=(await service.entitlement(req({}))).entitlement;
  assert.equal(ent.grants.length,2);assert.equal(ent.grants[1].startsAtMs,expires);
  orders.set('order_legacy',{id:'order_legacy',amount:price.totalPaise,currency:'INR',receipt:legacyId,status:'paid',amount_paid:price.totalPaise,amount_due:0,notes:{purchaseId:legacyId,ownerHash:D.hash(UID)}});
  const oldPayment={id:'pay_legacy',order_id:'order_legacy',amount:price.totalPaise,currency:'INR',status:'captured',captured:true,amount_refunded:100};payments.set(oldPayment.id,oldPayment);
  await service.webhook({event:'refund.processed',payload:{refund:{entity:{payment_id:oldPayment.id}}}},'refund_legacy');
  ent=(await service.entitlement(req({}))).entitlement;
  assert.equal(ent.grants.find(g=>g.purchaseId===legacyId).revoked,true);
  assert.equal((await legacyRef.get()).data().grants[0].revoked,true);
});

test('an unfinished order from the old company-based release blocks a second new app order',async()=>{
  const order=await create(await quote());
  await db.doc('paymentPurchases/'+order.purchaseId).update({scope:FieldValue.delete(),companyId:'company_a',companyName:'Company A',quoteId:'a'.repeat(64)});
  await db.doc('_paymentCheckoutLocks/'+D.hash(`test:${UID}:app:mlmlive`)).delete();
  await assert.rejects(create(await quote(),'new_global_attempt'),{code:'failed-precondition'});
  assert.equal(posts,1);
});

test('a known test purchase ID cannot produce a success response from live payment status',async()=>{
  const order=await create(await quote());await verify(order,capture(order));
  config.mode='live';config.keyId='rzp_live_example';gateway.keyId=config.keyId;
  await assert.rejects(service.status(req({purchaseId:order.purchaseId})),{code:'not-found'});
});

const createSelected=q=>service.create(req({planId:q.plan.planId,couponCode:q.couponCode,quoteId:q.quoteId,requestId:crypto.randomUUID()}));
const centralPlans=()=>[
 {...plan,planId:'poster_a',serviceType:'poster'}, {...plan,planId:'poster_b',serviceType:'poster'},
 {...plan,planId:'video_a',serviceType:'video',videoCredits:3}, {...plan,planId:'video_b',serviceType:'video',videoCredits:5},
 {...plan,planId:'combo_a',serviceType:'combo',videoCredits:3},
];
const quoteSelected=id=>service.quote(req({planId:id,couponCode:''}));
test('active Poster hides every Poster and Combo, permits Video, and rejects stale direct order requests',async()=>{
 await db.doc('appPlans/main').update({Plans:centralPlans()});
 const stale=await quoteSelected('poster_b');
 const first=await createSelected(await quoteSelected('poster_a'));await verify(first,capture(first));
 assert.deepEqual((await service.catalog(req({}))).plans.map(p=>p.planId),['video_a','video_b']);
 await assert.rejects(quoteSelected('poster_b'),/already have an active plan/);
 await assert.rejects(quoteSelected('combo_a'),/already have an active plan/);
 await assert.rejects(createSelected(stale),/already have an active plan/);assert.equal(posts,1);
 const second=await createSelected(await quoteSelected('video_a'));await verify(second,capture(second));
 assert.equal((await service.catalog(req({}))).plans.length,0);
});
test('active Video permits Poster only; exhausted credits release Video while Combo stays blocked by Poster',async()=>{
 await db.doc('appPlans/main').update({Plans:centralPlans()});
 const video=await createSelected(await quoteSelected('video_a'));await verify(video,capture(video));
 assert.deepEqual((await service.catalog(req({}))).plans.map(p=>p.planId),['poster_a','poster_b']);
 const poster=await createSelected(await quoteSelected('poster_a'));await verify(poster,capture(poster));
 const ref=db.doc('paymentEntitlements/'+D.hash(`test:${UID}:app:mlmlive`)),ledger=(await ref.get()).data();
 await ref.update({grants:ledger.grants.map(g=>g.serviceType==='video'?{...g,remainingCredits:0}:g)});
 assert.deepEqual((await service.catalog(req({}))).plans.map(p=>p.planId),['video_a','video_b']);
 const used=(await ref.get()).data();await ref.update({grants:used.grants.map(g=>({...g,remainingDownloads:0,remainingCredits:0}))});
 assert.equal((await service.catalog(req({}))).plans.length,5);
 await quoteSelected('combo_a');
});
test('Combo hides the buy list until services expire; unlimited and time-only video are not mistaken for zero credits',async()=>{
 await db.doc('appPlans/main').update({Plans:centralPlans().map(p=>({...p,unlimitedDownloads:true,videoCredits:null}))});
 const combo=await createSelected(await quoteSelected('combo_a'));await verify(combo,capture(combo));
 assert.equal((await service.catalog(req({}))).plans.length,0);
 time+=30*D.DAY_MS;
 assert.equal((await service.catalog(req({}))).plans.length,5);
});
test('concurrent different-plan requests reserve only one provider order',async()=>{
 await db.doc('appPlans/main').update({Plans:centralPlans()});
 const [a,b]=await Promise.all([quoteSelected('poster_a'),quoteSelected('combo_a')]);
 const results=await Promise.allSettled([createSelected(a),createSelected(b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(posts,1);
});
test('payment invoice requires a captured owned purchase and excludes secrets, commissions and other accounts',async()=>{
 const order=await create(await quote());
 await assert.rejects(service.receipt(req({purchaseId:order.purchaseId})),/after payment has been verified/);
 const payment=capture(order);payment.method='netbanking';await verify(order,payment);
 const result=(await service.receipt(req({purchaseId:order.purchaseId}))).invoice;
 assert.equal(result.merchant,'MLM LIVE');assert.equal(result.price.totalPaise,order.price.totalPaise);assert.equal(result.paymentMethod,'netbanking');assert.equal(result.paymentId,payment.id);
 for(const key of ['keySecret','keyId','commissions','couponId','razorpay_signature'])assert.equal(key in result,false);
 const other={...req({purchaseId:order.purchaseId}),auth:{uid:'mobile_8888888888',token:{mobileNo:'8888888888',auth_time:time/1000}}};
 await assert.rejects(service.receipt(other),{code:'not-found'});
 config.mode='live';config.keyId='rzp_live_example';await assert.rejects(service.receipt(req({purchaseId:order.purchaseId})),{code:'not-found'});
});

test('a full historical grant ledger is refused before a payable provider order is created',async()=>{
 const ledger={uid:UID,mobileNo,scope:'app',appId:'mlmlive',mode:'test',grants:Array.from({length:128},(_,i)=>({purchaseId:'used_'+i,serviceType:'poster',startsAtMs:time-1000,expiresAtMs:time+1000,remainingDownloads:0,revoked:false}))};
 await db.doc('paymentEntitlements/'+D.hash(`test:${UID}:app:mlmlive`)).set(ledger);
 await assert.rejects(create(await quote()),{code:'resource-exhausted',details:{checkoutNotCreated:true}});assert.equal(posts,0);
});


test('a published zero-credit limited Poster plan cannot create a chargeable order',async()=>{
 await db.doc('appPlans/main').update({Plans:[{...plan,downloads:0,unlimitedDownloads:false}]});
 assert.equal((await service.catalog(req({}))).plans.length,0);
 await assert.rejects(quote(),/credits are not configured/);assert.equal(posts,0);
});
