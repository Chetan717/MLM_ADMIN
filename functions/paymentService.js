"use strict";
const D = require("./paymentDomain");
const { createRazorpayGateway } = require("./razorpayGateway");
const PURCHASES = "paymentPurchases";
const ENTITLEMENTS = "paymentEntitlements";
const ORDER_LIFE_MS = 30 * 60000;
const LIMITS = {
  catalog: [30, 200],
  quote: [20, 100],
  create: [8, 20],
  verify: [60, 200],
  status: [40, 200],
  history: [30, 100],
  entitlement: [120, 300],
  receipt: [30, 100],
};

function createPaymentService({
  db,
  FieldValue,
  Timestamp,
  getConfig,
  now = Date.now,
  gatewayFactory = createRazorpayGateway,
  audit = () => {},
}) {
  const ref = (collection, key) => db.collection(collection).doc(key);
  const entitlementRef = (uid, mode = getConfig().mode) =>
    ref(ENTITLEMENTS, D.hash(`${mode}:${uid}:app:mlmlive`));
  const legacyEntitlementRef = (uid, companyId, mode) =>
    ref(ENTITLEMENTS, D.hash(`${mode}:${uid}:${companyId}`));
  const subscriptions = (purchase) =>
    purchase.mode === "test" ? "paymentTestSubscriptions"
      : purchase.plan.serviceType === "video" ? "paymentVideoSubscriptions" : "subscription";
  const snapshotData = (snapshot) =>
    snapshot?.exists ? snapshot.data() : null;
  function actor(request) {
    if (
      !request.auth?.uid ||
      ![undefined, "", "app", "user"].includes(request.auth.token?.panel)
    )
      D.fail("unauthenticated", "Sign in to your MLMLIVE account.");
    const token = request.auth.token || {};
    const candidates = [
      token.phone_number,
      token.mobileNo,
      token.mobile,
      /^mobile_(\d{10})$/.exec(request.auth.uid)?.[1],
    ];
    const mobiles = candidates
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map((v) => String(v).replace(/\D/g, ""))
      .map((v) => (v.length === 12 && v.startsWith("91") ? v.slice(2) : v));
    if (
      !mobiles.length ||
      mobiles.some((m) => !/^\d{10}$/.test(m) || m !== mobiles[0])
    )
      D.fail(
        "unauthenticated",
        "Verified mobile identity is required. Sign in again.",
      );
    if (token.auth_time && now() / 1000 - token.auth_time > 7 * 86400)
      D.fail("unauthenticated", "Please sign in again.");
    return { uid: D.id(request.auth.uid, "user ID"), mobileNo: mobiles[0] };
  }
  function gateway() {
    const config = getConfig();
    const result = gatewayFactory(config);
    if (!config.keyId.startsWith(`rzp_${config.mode}_`))
      D.fail(
        "failed-precondition",
        "Payment mode and gateway key do not match.",
      );
    return result;
  }
  function guardConfig() {
    if (getConfig().enabled !== true)
      D.fail("failed-precondition", "Payments are temporarily unavailable.");
  }
  async function rate(request, action) {
    const owner = actor(request),
      time = now();
    const bucketRef = ref(
      "_paymentLimits",
      D.hash(`${getConfig().mode}:${owner.uid}:${action}`),
    );
    const ip = String(request.rawRequest?.ip || "unknown");
    const ipRef = ref(
      "_paymentLimits",
      D.hash(`${getConfig().mode}:ip:${ip}:${action}`),
    );
    await db.runTransaction(async (tx) => {
      const refs = action === "create" ? [bucketRef, ipRef] : [bucketRef];
      const snapshots = await Promise.all(refs.map((r) => tx.get(r)));
      const rows = snapshots.map((snapshot, index) => {
        const old = snapshotData(snapshot) || {};
        const hourKey = Math.floor(time / 3600000),
          dayKey = Math.floor(time / D.DAY_MS);
        const hour = old.hourKey === hourKey ? old.hour || 0 : 0;
        const day = old.dayKey === dayKey ? old.day || 0 : 0;
        const limits = index ? [40, 100] : LIMITS[action];
        if (hour >= limits[0] || day >= limits[1] || old.blockedUntilMs > time)
          D.fail(
            "resource-exhausted",
            "Too many payment attempts. Please try later.",
          );
        return {
          hourKey,
          dayKey,
          hour: hour + 1,
          day: day + 1,
          expiresAt: Timestamp.fromMillis(time + 3 * D.DAY_MS),
        };
      });
      rows.forEach((row, index) => tx.set(refs[index], row, { merge: true }));
    });
    return owner;
  }
  async function context(owner, reader) {
    const [users, catalogSnapshot] = await Promise.all([
      reader.get(db.collection("users").where("mobileNo", "in", [owner.mobileNo, Number(owner.mobileNo)]).limit(2)),
      reader.get(ref("appPlans", "main")),
    ]);
    if (users.size !== 1) D.fail("failed-precondition", "Account needs verification. Contact support.");
    const user = users.docs[0].data();
    if (user.active === false || user.Active === false || user.blocked === true || user.deleted === true)
      D.fail("permission-denied", "Account is not available for payment.");
    if (user.uid && user.uid !== owner.uid) D.fail("permission-denied", "Account identity mismatch.");
    return { ...owner, userRef: users.docs[0].ref, user, catalog: snapshotData(catalogSnapshot), scope: "app", appId: "mlmlive" };
  }
  // First use imports only already-paid grants of this UID and this payment
  // mode. Existing balances/dates/revocations are copied from their ledger;
  // company plan prices are never used as an app catalog or as new benefits.
  async function loadAppEntitlement(tx, owner, snapshot, mode) {
    if (snapshot?.exists && snapshot.data().scope === "app") return snapshot.data();
    const paid = await tx.get(db.collection(PURCHASES).where("mode", "==", mode)
      .where("uid", "==", owner.uid).where("status", "==", "paid").limit(101));
    if (paid.size > 100) D.fail("resource-exhausted", "Existing paid history needs support-assisted entitlement migration.");
    const legacy = paid.docs.map((d) => d.data()).filter((p) => p.scope !== "app" && p.companyId && p.paymentId);
    const allowed = new Set(legacy.map((p) => p.id));
    const companyIds = [...new Set(legacy.map((p) => p.companyId))];
    const oldLedgers = await Promise.all(companyIds.map((id) => tx.get(legacyEntitlementRef(owner.uid, id, mode))));
    const seen = new Set();
    const grants = oldLedgers.flatMap((doc) => doc.exists ? doc.data().grants || [] : []).filter((g) => {
      const key = `${g.purchaseId}:${g.serviceType || "poster"}`;
      if (!allowed.has(g.purchaseId) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    return D.entitlementSummary({ uid: owner.uid, mobileNo: owner.mobileNo, scope: "app", appId: "mlmlive", mode,
      legacyMigratedAtMs: now(), grants }, now());
  }
  async function readAppEntitlement(owner) {
    return db.runTransaction(async (tx) => {
      const target = entitlementRef(owner.uid);
      const snapshot = await tx.get(target);
      const result = await loadAppEntitlement(tx, owner, snapshot, getConfig().mode);
      if (!snapshot.exists || snapshot.data().scope !== "app") tx.set(target, result);
      return D.entitlementSummary(result, now());
    });
  }
  // Query.get and Transaction.get expose different APIs; normalize read access.
  const directReader = { get: (object) => object.get() };
  async function priceContext(owner, data, reader = directReader) {
    const ctx = await context(owner, reader);
    const plan = D.appPlans(ctx.catalog).find(
      (p) => p.planId === data.planId,
    );
    if (!plan || !plan.Launch)
      D.fail("failed-precondition", "Plan is unavailable. Refresh plans.");
    if (!D.planHasBenefits(plan))
      D.fail("failed-precondition", "Poster credits are not configured for this plan. Contact support.");
    const code = D.couponCode(data.couponCode || "");
    let coupon = null,
      members = [];
    if (code) {
      const snap = await reader.get(
        db.collection("couponcode").where("code", "==", code).limit(2),
      );
      if (snap.size !== 1 || snap.docs[0].data().active !== true)
        D.fail("failed-precondition", "Coupon is invalid or inactive.");
      coupon = { ...snap.docs[0].data(), id: snap.docs[0].id };
      if (Array.isArray(coupon.planIds) && !coupon.planIds.includes(plan.planId))
        D.fail("failed-precondition", "Coupon is not available for this app plan.");
      let memberId = coupon.assigned_user?.id;
      while (memberId) {
        D.id(memberId, "marketing member");
        if (members.length >= 16 || members.some((m) => m.id === memberId))
          D.fail("failed-precondition", "Invalid marketing hierarchy.");
        const member = await reader.get(ref("mteam", memberId));
        if (!member.exists || member.data().active !== true)
          D.fail("failed-precondition", "Coupon is unavailable.");
        members.push({ ...member.data(), id: member.id });
        memberId = member.data().parentMteamId || "";
      }
      if (
        members[0]?.assign_coupon_id &&
        members[0].assign_coupon_id !== coupon.id
      )
        D.fail(
          "failed-precondition",
          "Coupon assignment changed. Refresh checkout.",
        );
      if (
        members.length > 1 &&
        D.bps(coupon.marketing_member_percentage) >
          D.bps(members[1].commissionPercentage ?? 0)
      )
        D.fail(
          "failed-precondition",
          "Coupon percentage exceeds its parent limit.",
        );
    }
    const price = D.calculatePrice(plan, coupon);
    const commissions = D.calculateCommissions(
      price.taxablePaise,
      coupon,
      members,
    );
    const quoteId = D.hash(
      JSON.stringify({
        mode: getConfig().mode,
        uid: owner.uid,
        scope: "app",
        appId: "mlmlive",
        plan,
        price,
        code,
        commissions,
      }),
    );
    return {
      ...ctx,
      plan,
      price,
      commissions,
      couponCode: code,
      couponId: coupon?.id || "",
      quoteId,
    };
  }
  function publicQuote(ctx) {
    return {
      mode: getConfig().mode,
      quoteId: ctx.quoteId,
      scope: "app",
      appId: "mlmlive",
      appName: "MLM LIVE",
      plan: ctx.plan,
      price: ctx.price,
      couponCode: ctx.couponCode,
      currency: "INR",
    };
  }
  async function catalog(request) {
    D.input(request.data || {}, []);
    const owner = await rate(request, "catalog");
    const [ctx, entitlement] = await Promise.all([context(owner, directReader), readAppEntitlement(owner)]);
    const eligibility = D.purchaseEligibility(entitlement, now());
    return { mode: getConfig().mode, scope: "app", appId: "mlmlive", appName: "MLM LIVE",
      version: Number(ctx.catalog?.version || 0),
      plans: D.appPlans(ctx.catalog).filter((p) => p.Launch && D.planHasBenefits(p) && eligibility[p.serviceType || "poster"]),
      entitlement, eligibility, serverTimeMs: now(),
      suggestedCoupon: /^[A-Z0-9]{6}$/.test(ctx.user.mteamCouponCode || "") ? ctx.user.mteamCouponCode : "" };
  }
  async function quote(request) {
    D.input(request.data, ["planId", "couponCode"]);
    const owner = await rate(request, "quote");
    D.id(request.data.planId, "plan ID");
    const [ctx, entitlement] = await Promise.all([priceContext(owner, request.data), readAppEntitlement(owner)]);
    D.assertPlanAvailable(entitlement, ctx.plan, now());
    return publicQuote(ctx);
  }
  function checkout(purchase) {
    return {
      purchaseId: purchase.id,
      orderId: purchase.orderId || "",
      keyId: purchase.keyId,
      status: purchase.status,
      scope: purchase.scope || "company",
      appId: purchase.appId || "",
      appName: "MLM LIVE",
      companyId: purchase.companyId || "",
      companyName: purchase.scope === "app" ? "MLM LIVE" : purchase.companyName,
      plan: purchase.plan,
      price: purchase.price,
      mode: purchase.mode,
      expiresAtMs: purchase.expiresAtMs,
      receipt: purchase.id,
      subscriptionId: purchase.subscriptionId || "",
      serviceGrants: purchase.serviceGrants || [],
      startsAtMs: purchase.startsAtMs || 0,
      subscriptionExpiresAtMs: purchase.subscriptionExpiresAtMs || 0,
      paymentId: purchase.paymentId || "",
      paidAtMs: purchase.paidAtMs || 0,
      paymentMethod: purchase.paymentMethod || "",
    };
  }
  async function create(request) {
    guardConfig();
    D.input(request.data, [
      "planId",
      "couponCode",
      "quoteId",
      "requestId",
    ]);
    D.id(request.data.planId, "plan ID");
    D.id(request.data.requestId, "request ID");
    if (!/^[a-f0-9]{64}$/.test(request.data.quoteId || ""))
      D.fail("invalid-argument", "Confirm the current quote first.");
    const owner = await rate(request, "create");
    const client = gateway(),
      time = now();
    const purchaseId = `p_${D.hash(`${getConfig().mode}:${owner.uid}:${request.data.requestId}`).slice(0, 36)}`;
    const purchaseRef = ref(PURCHASES, purchaseId);
    const lockRef = ref(
      "_paymentCheckoutLocks",
      D.hash(`${getConfig().mode}:${owner.uid}:app:mlmlive`),
    );
    let selected;
    try {
      selected = await db.runTransaction(async (tx) => {
        const [existing, lock] = await Promise.all([
          tx.get(purchaseRef),
          tx.get(lockRef),
        ]);
        const same = snapshotData(existing);
        if (same) {
          if (
            same.uid !== owner.uid ||
            same.quoteId !== request.data.quoteId
          )
            D.fail(
              "permission-denied",
              "Request ID was already used for a different purchase.",
            );
          return { purchase: same, isNew: false };
        }
        let previousId = lock.data()?.purchaseId;
        if (!lock.exists) {
          const older = await tx.get(db.collection(PURCHASES).where("mode", "==", getConfig().mode)
            .where("uid", "==", owner.uid).where("status", "in", ["created", "pending", "creating", "creation_unknown"]).limit(101));
          if (older.size > 100) D.fail("resource-exhausted", "Check your pending payment history before starting a new checkout.");
          previousId = older.docs.map((d) => d.data()).find((p) => p.expiresAtMs > time || ["creating", "creation_unknown"].includes(p.status))?.id;
        }
        const previous = previousId
          ? snapshotData(await tx.get(ref(PURCHASES, previousId)))
          : null;
        if (
          previous &&
          ![
            "paid",
            "refunded",
            "partially_refunded",
            "disputed",
            "failed",
          ].includes(previous.status) &&
          (previous.expiresAtMs > time ||
            ["creating", "creation_unknown"].includes(previous.status))
        ) {
          if (previous.quoteId === request.data.quoteId)
            return { purchase: previous, isNew: false };
          D.fail(
            "failed-precondition",
            "A checkout is already pending. Check that payment before starting another.",
          );
        }
        const ctx = await priceContext(owner, request.data, tx); // Fresh reads and version checks inside the reservation transaction.
        const entRef = entitlementRef(owner.uid);
        const entSnapshot = await tx.get(entRef);
        const entitlement = await loadAppEntitlement(tx, owner, entSnapshot, getConfig().mode);
        D.assertPlanAvailable(entitlement, ctx.plan, time);
        // Fail before a payable provider order if the ledger/date cannot accept
        // the promised grant. Final capture still rechecks inside settlement.
        D.nextEntitlement(entitlement, { ...owner, id: purchaseId, scope: "app",
          mode: getConfig().mode, plan: ctx.plan, price: ctx.price }, time);
        if (ctx.quoteId !== request.data.quoteId)
          D.fail(
            "failed-precondition",
            "Plan or discount changed. Review the updated total before paying.",
          );
        const purchase = {
          id: purchaseId,
          uid: owner.uid,
          mobileNo: owner.mobileNo,
          userName: String(ctx.user.name || "").slice(0, 100),
          scope: "app",
          appId: "mlmlive",
          companyId: "",
          companyName: "MLM LIVE",
          plan: ctx.plan,
          price: ctx.price,
          commissions: ctx.commissions,
          couponCode: ctx.couponCode,
          couponId: ctx.couponId,
          quoteId: ctx.quoteId,
          keyId: client.keyId,
          mode: getConfig().mode,
          status: "creating",
          orderId: "",
          paymentId: "",
          createdAtMs: time,
          updatedAtMs: time,
          expiresAtMs: time + ORDER_LIFE_MS,
          nextReconcileAtMs: time + 15 * 60000,
          refundedPaise: 0,
          failureCount: 0,
          reconcileCount: 0,
        };
        tx.create(purchaseRef, purchase);
        // Reading/writing this same ledger serializes order reservation with a
        // simultaneous payment activation or trusted credit update.
        if (!entSnapshot.exists || entSnapshot.data().scope !== "app") tx.set(entRef, entitlement);
        tx.set(lockRef, { purchaseId, uid: owner.uid, createdAtMs: time });
        return { purchase, isNew: true };
      });
    } catch (error) {
      // Validation failed before reservation or provider POST.
      if (error instanceof D.PaymentError && ["failed-precondition", "invalid-argument", "permission-denied", "resource-exhausted"].includes(error.code))
        error.details = { checkoutNotCreated: true };
      throw error;
    }
    if (!selected.isNew) {
      // A response may be lost after reserving or creating the provider order.
      // Return its identity so the client can reconcile the same purchase.
      if (!selected.purchase.orderId && selected.purchase.keyId === client.keyId)
        return checkout(selected.purchase);
      if (
        selected.purchase.keyId !== client.keyId ||
        (selected.purchase.expiresAtMs <= time &&
          selected.purchase.status !== "paid")
      )
        D.fail(
          "failed-precondition",
          "Checkout is no longer available. Check payment history.",
        );
      return checkout(selected.purchase);
    }
    const purchase = selected.purchase;
    try {
      const order = await client.createOrder(purchase); // External POST is NEVER inside a retried Firestore transaction.
      D.id(order.id, "provider order");
      if (
        !order.id.startsWith("order_") ||
        order.amount !== purchase.price.totalPaise ||
        order.currency !== "INR" ||
        order.receipt !== purchase.id
      )
        D.fail("permission-denied", "Unexpected payment provider response.");
      await attachOrder(purchase.id, order);
      return checkout({ ...purchase, orderId: order.id, status: "created" });
    } catch (error) {
      // A timeout may mean Razorpay accepted the order. Never issue another POST.
      await db.runTransaction(async (tx) => {
        const current = snapshotData(await tx.get(purchaseRef));
        if (current && current.status === "creating")
          tx.update(purchaseRef, {
            status: error.definiteFailure ? "failed" : "creation_unknown",
            updatedAtMs: now(),
            lastError: error.definiteFailure
              ? "provider_rejected_order"
              : "provider_confirmation_pending",
            ...(error.definiteFailure
              ? { nextReconcileAtMs: FieldValue.delete() }
              : {}),
          });
      });
      if (error.code === "unavailable")
        return checkout({ ...purchase, status: "creation_unknown" });
      throw error;
    }
  }
  async function attachOrder(purchaseId, order) {
    return db.runTransaction(async (tx) => {
      const purchaseRef = ref(PURCHASES, purchaseId),
        mapRef = ref("_razorpayOrders", order.id);
      const [purchaseSnap, map] = await Promise.all([
        tx.get(purchaseRef),
        tx.get(mapRef),
      ]);
      const purchase = snapshotData(purchaseSnap);
      if (
        !purchase ||
        purchase.price.totalPaise !== order.amount ||
        order.currency !== "INR" ||
        order.receipt !== purchase.id ||
        order.notes?.purchaseId !== purchase.id ||
        order.notes?.ownerHash !== D.hash(purchase.uid) ||
        (purchase.orderId && purchase.orderId !== order.id) ||
        (map.exists && map.data().purchaseId !== purchase.id)
      )
        D.fail("permission-denied", "Provider order binding failed.");
      tx.set(mapRef, { purchaseId, uid: purchase.uid });
      if (!purchase.orderId)
        tx.update(purchaseRef, {
          orderId: order.id,
          status: "created",
          updatedAtMs: now(),
        });
      return { ...purchase, orderId: order.id };
    });
  }
  async function owned(owner, purchaseId) {
    const purchase = snapshotData(
      await ref(PURCHASES, D.id(purchaseId, "purchase ID")).get(),
    );
    if (!purchase || purchase.uid !== owner.uid || purchase.mode !== getConfig().mode)
      D.fail("not-found", "Purchase was not found.");
    return purchase;
  }
  function statRefs(purchase) {
    const date = new Date(purchase.createdAtMs + 330 * 60000)
      .toISOString()
      .slice(0, 10);
    if (purchase.scope === "app") return [
      ref("paymentStats", `${purchase.mode}_global`),
      ref("paymentStats", `${purchase.mode}_app_mlmlive`),
      ref("paymentDaily", `${purchase.mode}_${date}_app_mlmlive`),
    ];
    return [
      ref("paymentStats", `${purchase.mode}_global`),
      ref(
        "paymentStats",
        `${purchase.mode}_company_${D.hash(purchase.companyId).slice(0, 32)}`,
      ),
      ref(
        "paymentDaily",
        `${purchase.mode}_${date}_${D.hash(purchase.companyId).slice(0, 20)}`,
      ),
    ];
  }
  function auditRow(tx, purchase, action, extra = {}) {
    tx.create(db.collection("paymentAudit").doc(), {
      purchaseId: purchase.id,
      uid: purchase.uid,
      action,
      atMs: now(),
      ...extra,
    });
  }
  async function settle(purchaseId, payment, order) {
    const purchaseRef = ref(PURCHASES, purchaseId),
      time = now();
    return db.runTransaction(async (tx) => {
      const purchase = snapshotData(await tx.get(purchaseRef));
      if (!purchase) D.fail("not-found", "Purchase was not found.");
      if (purchase.keyId !== getConfig().keyId)
        D.fail(
          "failed-precondition",
          "Payment key changed. Ask Admin to reconcile with the original key.",
        );
      if (
        !D.validateProviderPayment(
          { ...purchase, candidatePaymentId: payment.id },
          payment,
          order,
        )
      )
        return { ...checkout(purchase), status: "pending" };
      if (purchase.paymentId) {
        if (purchase.paymentId !== payment.id)
          D.fail("permission-denied", "Purchase already has another payment.");
        return checkout(purchase);
      }
      const paymentRef = ref("_razorpayPayments", payment.id),
        entRef = entitlementRef(purchase.uid, purchase.mode);
      const [paymentOwner, ent] = await Promise.all([
        tx.get(paymentRef),
        tx.get(entRef),
      ]);
      if (paymentOwner.exists && paymentOwner.data().purchaseId !== purchase.id)
        D.fail("permission-denied", "Payment was already used.");
      // Never grant benefits for payments already refunded before a delayed webhook.
      const refundedPaise = D.integer(
        payment.amount_refunded || 0,
        0,
        purchase.price.totalPaise,
        "refunded amount",
      );
      const previousEntitlement = await loadAppEntitlement(tx, purchase, ent, purchase.mode);
      const entitlement = D.nextEntitlement(previousEntitlement, { ...purchase, scope: "app" }, time);
      const grant = entitlement.grants.find(
        (g) => g.purchaseId === purchase.id,
      );
      const serviceGrants = entitlement.grants.filter((g) => g.purchaseId === purchase.id);
      if (refundedPaise > 0) serviceGrants.forEach((g) => { g.revoked = true; });
      const summary = D.entitlementSummary(entitlement, time);
      const status =
        refundedPaise === purchase.price.totalPaise
          ? "refunded"
          : refundedPaise
            ? "partially_refunded"
            : "paid";
      const subscriptionId = `rzp_${purchase.id}`;
      tx.create(ref(subscriptions(purchase), subscriptionId), {
        uid: purchase.uid,
        mobileNo: purchase.mobileNo,
        UserName: purchase.userName,
        companyId: purchase.companyId || "",
        company: purchase.scope === "app" ? "MLM LIVE" : purchase.companyName,
        scope: "app",
        appId: "mlmlive",
        plan: purchase.plan.PlanName,
        planId: purchase.plan.planId,
        planType: purchase.plan.Type,
        duration: purchase.plan.Day_value,
        download: purchase.plan.downloads,
        unlimitedDownloads: purchase.plan.unlimitedDownloads,
        serviceType: purchase.plan.serviceType || "poster",
        serviceGrants,
        startdate: new Date(grant.startsAtMs).toISOString(),
        expirydate: new Date(grant.expiresAtMs).toISOString(),
        Active: !refundedPaise,
        Expire: Boolean(refundedPaise),
        payment: refundedPaise ? "Refunded" : "Success",
        PaymentAmount: purchase.price.totalPaise / 100,
        baseAmount: purchase.price.basePaise / 100,
        discountAmount: purchase.price.discountPaise / 100,
        discountPercent: purchase.price.discountBps / 100,
        gstAmount: purchase.price.gstPaise / 100,
        gstPercent: 18,
        taxableAmount: purchase.price.taxablePaise / 100,
        amountPaise: purchase.price.totalPaise,
        refundedPaise,
        price: purchase.price,
        couponApplied: purchase.couponCode,
        couponId: purchase.couponId,
        commissions: purchase.commissions,
        OrderId: purchase.orderId,
        UTRID: payment.id,
        purchaseId: purchase.id,
        mode: purchase.mode,
        source: "razorpay_server_v1",
        PurchaseAt: Timestamp.fromMillis(time),
      });
      tx.set(entRef, summary);
      tx.create(paymentRef, {
        purchaseId,
        uid: purchase.uid,
        orderId: purchase.orderId,
      });
      tx.update(purchaseRef, {
        status,
        paymentId: payment.id,
        subscriptionId,
        paidAtMs: time,
        paymentMethod: typeof payment.method === "string" ? payment.method.slice(0, 40) : "",
        updatedAtMs: time,
        refundedPaise,
        startsAtMs: grant.startsAtMs,
        subscriptionExpiresAtMs: grant.expiresAtMs,
        serviceGrants,
        nextReconcileAtMs: time + D.DAY_MS,
      });
      const marketingPaise = purchase.commissions.reduce(
        (sum, row) => sum + row.amountPaise,
        0,
      );
      const reverseAmount = (amount) =>
        Math.floor(
          (amount * refundedPaise + Math.floor(purchase.price.totalPaise / 2)) /
            purchase.price.totalPaise,
        );
      const marketingReversedPaise = purchase.commissions.reduce(
        (sum, row) => sum + reverseAmount(row.amountPaise),
        0,
      );
      for (const r of statRefs(purchase))
        tx.set(
          r,
          {
            mode: purchase.mode,
            companyId:
              r.id === `${purchase.mode}_global` ? "all" : purchase.companyId,
            capturedPaise: FieldValue.increment(purchase.price.totalPaise),
            refundedPaise: FieldValue.increment(refundedPaise),
            netReceivedPaise: FieldValue.increment(
              purchase.price.totalPaise - refundedPaise,
            ),
            basePaise: FieldValue.increment(purchase.price.basePaise),
            discountPaise: FieldValue.increment(purchase.price.discountPaise),
            gstPaise: FieldValue.increment(purchase.price.gstPaise),
            gstRefundedPaise: FieldValue.increment(
              reverseAmount(purchase.price.gstPaise),
            ),
            taxableRefundedPaise: FieldValue.increment(
              refundedPaise - reverseAmount(purchase.price.gstPaise),
            ),
            marketingPaise: FieldValue.increment(marketingPaise),
            marketingReversedPaise: FieldValue.increment(
              marketingReversedPaise,
            ),
            marketingPayablePaise: FieldValue.increment(
              marketingPaise - marketingReversedPaise,
            ),
            paidOrders: FieldValue.increment(1),
            updatedAtMs: time,
          },
          { merge: true },
        );
      purchase.commissions.forEach((row) =>
        tx.create(ref("paymentCommissions", `${purchase.id}_${row.memberId}`), {
          ...row,
          purchaseId,
          companyId: purchase.companyId,
          reversedPaise: refundedPaise
            ? Math.floor(
                (row.amountPaise * refundedPaise +
                  Math.floor(purchase.price.totalPaise / 2)) /
                  purchase.price.totalPaise,
              )
            : 0,
          status: refundedPaise ? "reversed_or_partial" : "earned",
          atMs: time,
        }),
      );
      auditRow(tx, purchase, "payment_captured", {
        paymentId: payment.id,
        startsAtMs: grant.startsAtMs,
        subscriptionExpiresAtMs: grant.expiresAtMs,
        serviceGrants,
        totalPaise: purchase.price.totalPaise,
        refundedPaise,
      });
      return checkout({
        ...purchase,
        status,
        paidAtMs: time,
        paymentMethod: typeof payment.method === "string" ? payment.method.slice(0, 40) : "",
        subscriptionId,
        paymentId: payment.id,
        startsAtMs: grant.startsAtMs,
        subscriptionExpiresAtMs: grant.expiresAtMs,
        serviceGrants,
      });
    });
  }
  async function verify(request) {
    D.input(request.data, [
      "purchaseId",
      "razorpay_order_id",
      "razorpay_payment_id",
      "razorpay_signature",
    ]);
    const owner = await rate(request, "verify"),
      purchase = await owned(owner, request.data.purchaseId);
    D.id(request.data.razorpay_payment_id, "payment ID");
    if (
      purchase.orderId !== request.data.razorpay_order_id ||
      !D.signatureValid(
        getConfig().keySecret,
        `${purchase.orderId}|${request.data.razorpay_payment_id}`,
        request.data.razorpay_signature,
      )
    )
      D.fail("permission-denied", "Payment signature verification failed.");
    const client = gateway();
    const [payment, order] = await Promise.all([
      client.fetchPayment(request.data.razorpay_payment_id),
      client.fetchOrder(purchase.orderId),
    ]);
    if (payment?.id !== request.data.razorpay_payment_id)
      D.fail("permission-denied", "Provider payment ID mismatch.");
    const checked =
      payment.status === "refunded"
        ? { ...payment, status: "captured", captured: true }
        : payment;
    const result = await settle(purchase.id, checked, order);
    if (payment.amount_refunded) {
      await applyReversal(purchase.id, payment, false);
      return checkout((await ref(PURCHASES, purchase.id).get()).data());
    }
    return result;
  }
  async function reconcile(purchase) {
    const client = gateway();
    if (purchase.keyId !== client.keyId)
      D.fail(
        "failed-precondition",
        "Original payment key is required for reconciliation.",
      );
    if (!purchase.orderId) {
      const matches =
        (await client.findOrdersByReceipt(purchase.id)).items?.filter(
          (order) => order.receipt === purchase.id,
        ) || [];
      if (matches.length > 1)
        D.fail(
          "failed-precondition",
          "Multiple provider orders need support review.",
        );
      if (matches.length === 1)
        purchase = await attachOrder(purchase.id, matches[0]);
      else
        return {
          ...checkout(purchase),
          status: purchase.status === "failed" ? "failed" : "creation_unknown",
        };
    }
    const order = await client.fetchOrder(purchase.orderId);
    const list = await client.fetchOrderPayments(purchase.orderId);
    const captured = (list.items || []).find(
      (payment) =>
        payment.status === "captured" || payment.status === "refunded",
    );
    if (captured) {
      const payment = await client.fetchPayment(captured.id);
      // Refunded status can occur before our first fulfilment. Validate the paid
      // order/amount, then create an already revoked grant and financial record.
      const checked =
        payment.status === "refunded"
          ? { ...payment, status: "captured", captured: true }
          : payment;
      const result = await settle(purchase.id, checked, order);
      if (payment.amount_refunded) {
        await applyReversal(purchase.id, payment, false);
        return checkout((await ref(PURCHASES, purchase.id).get()).data());
      }
      return result;
    }
    const waiting = order.status === "paid" || order.amount_paid > 0 ||
      (list.items || []).some((p) => ["authorized", "created"].includes(p.status));
    const expired = purchase.expiresAtMs < now() && !waiting;
    if (expired || (waiting && purchase.expiresAtMs < now())) {
      return db.runTransaction(async (tx) => {
        const purchaseRef = ref(PURCHASES, purchase.id);
        const current = snapshotData(await tx.get(purchaseRef));
        // A captured-payment webhook may have settled while provider reads ran.
        if (current.paymentId) return checkout(current);
        const update = {
          status: expired ? "expired" : "pending",
          updatedAtMs: now(),
          ...(!expired ? { expiresAtMs: now() + ORDER_LIFE_MS } : {}),
        };
        tx.update(purchaseRef, update);
        return checkout({ ...current, ...update });
      });
    }
    return { ...checkout(purchase), status: "pending" };
  }
  async function status(request) {
    D.input(request.data, ["purchaseId"]);
    const owner = await rate(request, "status"),
      purchase = await owned(owner, request.data.purchaseId);
    if (
      ["paid", "refunded", "partially_refunded", "disputed"].includes(
        purchase.status,
      )
    )
      return checkout(purchase);
    return reconcile(purchase);
  }
  async function history(request) {
    D.input(request.data || {}, ["cursor"]);
    const owner = await rate(request, "history");
    let q = db
      .collection(PURCHASES)
      .where("mode", "==", getConfig().mode)
      .where("uid", "==", owner.uid)
      .orderBy("createdAtMs", "desc")
      .orderBy("id", "desc")
      .limit(21);
    if (request.data.cursor) {
      D.input(request.data.cursor, ["createdAtMs", "id"]);
      q = q.startAfter(
        D.integer(
          request.data.cursor.createdAtMs,
          0,
          Number.MAX_SAFE_INTEGER,
          "cursor",
        ),
        D.id(request.data.cursor.id),
      );
    }
    const [rows, entitlement] = await Promise.all([
      q.get(),
      readAppEntitlement(owner),
    ]);
    const items = rows.docs.slice(0, 20).map((s) => s.data());
    return {
      mode: getConfig().mode,
      items: items.map((p) => ({
        ...checkout(p),
        createdAtMs: p.createdAtMs,
        startsAtMs: p.startsAtMs || 0,
        subscriptionExpiresAtMs: p.subscriptionExpiresAtMs || 0,
        refundedPaise: p.refundedPaise || 0,
        couponCode: p.couponCode || "",
      })),
      entitlement,
      cursor:
        rows.size > 20
          ? { createdAtMs: items.at(-1).createdAtMs, id: items.at(-1).id }
          : null,
    };
  }
  async function legacyHistory(request) {
    D.input(request.data || {}, ["cursor"]);
    const owner = await rate(request, "history");
    let q = db
      .collection("subscription")
      .where("mobileNo", "in", [owner.mobileNo, Number(owner.mobileNo)])
      .orderBy("PurchaseAt", "desc");
    if (request.data.cursor) {
      const cursor = await ref("subscription", D.id(request.data.cursor)).get();
      if (!cursor.exists || String(cursor.data().mobileNo) !== owner.mobileNo)
        D.fail("invalid-argument", "Invalid history cursor.");
      q = q.startAfter(cursor);
    }
    const rows = await q.limit(21).get(),
      page = rows.docs.slice(0, 20);
    return {
      items: page
        .filter(
          (s) =>
            s.data().source !== "razorpay_server_v1",
        )
        .map((s) => {
          const value = s.data();
          return {
            id: s.id,
            plan: String(value.plan || "Earlier plan"),
            companyId: value.companyId || "",
            company: value.company || "",
            startdate:
              value.startdate?.toDate?.().toISOString() ||
              value.startdate ||
              "",
            expirydate:
              value.expirydate?.toDate?.().toISOString() ||
              value.expirydate ||
              "",
            PaymentAmount: Number(value.PaymentAmount || 0),
            payment: value.payment || "",
            Active: value.Active === true,
            download: Number(value.download || 0),
          };
        }),
      cursor: rows.size > 20 ? page.at(-1).id : null,
    };
  }
  async function entitlement(request) {
    D.input(request.data || {}, []);
    const owner = await rate(request, "entitlement");
    return { entitlement: await readAppEntitlement(owner) };
  }
  async function receipt(request) {
    D.input(request.data, ["purchaseId"]);
    const owner = await rate(request, "receipt");
    const purchase = await owned(owner, request.data.purchaseId);
    if (!purchase.paymentId || !["paid", "refunded", "partially_refunded", "disputed"].includes(purchase.status))
      D.fail("failed-precondition", "An invoice is available after payment has been verified.");
    return { invoice: { merchant: "MLM LIVE", invoiceId: purchase.id,
      customerName: purchase.userName || "Customer", mobileNo: owner.mobileNo,
      planName: purchase.plan.PlanName, serviceType: purchase.plan.serviceType || "poster",
      durationDays: purchase.plan.Day_value, currency: "INR", price: purchase.price,
      orderId: purchase.orderId, paymentId: purchase.paymentId,
      paymentMethod: purchase.paymentMethod || "Razorpay", mode: purchase.mode,
      status: purchase.status, paidAtMs: purchase.paidAtMs || purchase.createdAtMs,
      startsAtMs: purchase.startsAtMs || 0, expiresAtMs: purchase.subscriptionExpiresAtMs || 0,
      refundedPaise: purchase.refundedPaise || 0 } };
  }
  async function applyReversal(purchaseId, payment, disputed) {
    await db.runTransaction(async (tx) => {
      const purchaseRef = ref(PURCHASES, purchaseId),
        purchase = snapshotData(await tx.get(purchaseRef));
      if (!purchase || !purchase.paymentId) return; // reconcile/settle runs first
      if (
        payment.id !== purchase.paymentId ||
        payment.order_id !== purchase.orderId ||
        payment.amount !== purchase.price.totalPaise ||
        payment.currency !== "INR"
      )
        D.fail("permission-denied", "Reversal payment mismatch.");
      const refundedPaise = D.integer(
        payment.amount_refunded || 0,
        0,
        purchase.price.totalPaise,
        "refund",
      );
      const cumulative = Math.max(refundedPaise, purchase.refundedPaise || 0),
        delta = cumulative - (purchase.refundedPaise || 0);
      if (!delta && (!disputed || purchase.disputed)) return;
      const entRef = entitlementRef(purchase.uid, purchase.mode);
      const entSnapshot = await tx.get(entRef);
      const entitlement = await loadAppEntitlement(tx, purchase, entSnapshot, purchase.mode);
      const legacyRef = purchase.scope !== "app" && purchase.companyId
        ? legacyEntitlementRef(purchase.uid, purchase.companyId, purchase.mode) : null;
      const legacyEnt = legacyRef ? snapshotData(await tx.get(legacyRef)) : null;
      const commissions = await Promise.all(
        purchase.commissions.map((row) =>
          tx.get(ref("paymentCommissions", `${purchase.id}_${row.memberId}`)),
        ),
      );
      const status =
        disputed || purchase.disputed
          ? "disputed"
          : cumulative === purchase.price.totalPaise
            ? "refunded"
            : "partially_refunded";
      const reverseAt = (amount, refunded) =>
        Math.floor(
          (amount * refunded + Math.floor(purchase.price.totalPaise / 2)) /
            purchase.price.totalPaise,
        );
      const marketingReverseDelta = commissions.reduce((sum, s) => {
        if (!s.exists) return sum;
        const row = s.data(),
          reversed = disputed
            ? row.amountPaise
            : reverseAt(row.amountPaise, cumulative);
        return sum + Math.max(0, reversed - (row.reversedPaise || 0));
      }, 0);
      tx.update(purchaseRef, {
        status,
        refundedPaise: cumulative,
        disputed: disputed || purchase.disputed || false,
        updatedAtMs: now(),
      });
      tx.update(ref(subscriptions(purchase), purchase.subscriptionId), {
        Active: false,
        Expire: true,
        payment: disputed ? "Disputed" : "Refunded",
        refundedPaise: cumulative,
      });
      if (legacyEnt) tx.set(legacyRef, D.entitlementSummary({ ...legacyEnt,
        grants: legacyEnt.grants.map((g) => g.purchaseId === purchaseId ? { ...g, revoked: true } : g) }, now()));
      if (entitlement)
        tx.set(
          entRef,
          D.entitlementSummary(
            {
              ...entitlement,
              grants: entitlement.grants.map((g) =>
                g.purchaseId === purchaseId ? { ...g, revoked: true } : g,
              ),
            },
            now(),
          ),
        );
      for (const r of statRefs(purchase))
        tx.set(
          r,
          {
            refundedPaise: FieldValue.increment(delta),
            netReceivedPaise: FieldValue.increment(-delta),
            gstRefundedPaise: FieldValue.increment(
              reverseAt(purchase.price.gstPaise, cumulative) -
                reverseAt(purchase.price.gstPaise, purchase.refundedPaise || 0),
            ),
            taxableRefundedPaise: FieldValue.increment(
              delta -
                (reverseAt(purchase.price.gstPaise, cumulative) -
                  reverseAt(
                    purchase.price.gstPaise,
                    purchase.refundedPaise || 0,
                  )),
            ),
            marketingReversedPaise: FieldValue.increment(marketingReverseDelta),
            marketingPayablePaise: FieldValue.increment(-marketingReverseDelta),
            disputedOrders: FieldValue.increment(
              disputed && !purchase.disputed ? 1 : 0,
            ),
            updatedAtMs: now(),
          },
          { merge: true },
        );
      commissions.forEach((s) => {
        if (s.exists) {
          const row = s.data();
          const reverse = disputed
            ? row.amountPaise
            : Math.floor(
                (row.amountPaise * cumulative +
                  Math.floor(purchase.price.totalPaise / 2)) /
                  purchase.price.totalPaise,
              );
          tx.update(s.ref, {
            reversedPaise: Math.max(row.reversedPaise || 0, reverse),
            status: disputed ? "held_dispute" : "reversed_or_partial",
          });
        }
      });
      auditRow(
        tx,
        purchase,
        disputed ? "payment_disputed" : "payment_refunded",
        { refundedPaise: cumulative },
      );
    });
  }
  async function webhook(payload, eventId) {
    const eventRef = ref("_razorpayWebhookEvents", D.hash(eventId));
    if ((await eventRef.get()).exists) return { duplicate: true };
    const supported = [
      "payment.captured",
      "order.paid",
      "payment.failed",
      "refund.processed",
      "payment.dispute.created",
      "payment.dispute.lost",
      "payment.dispute.won",
      "payment.dispute.closed",
    ];
    if (!supported.includes(payload.event)) return { ignored: true };
    const entity = payload.payload?.payment?.entity;
    const paymentId =
      entity?.id ||
      payload.payload?.refund?.entity?.payment_id ||
      payload.payload?.dispute?.entity?.payment_id;
    if (!paymentId) D.fail("invalid-argument", "Missing payment entity.");
    const client = gateway(),
      payment = await client.fetchPayment(D.id(paymentId));
    if (!payment.order_id) return { ignored: true };
    const order = await client.fetchOrder(payment.order_id);
    // Unrelated Razorpay orders may share the merchant account. Ignore them.
    const purchaseId = order.notes?.purchaseId;
    if (!purchaseId || !/^p_[a-f0-9]{36}$/.test(purchaseId))
      return { ignored: true };
    if (!(await ref(PURCHASES, purchaseId).get()).exists)
      return { ignored: true };
    const purchase = await attachOrder(purchaseId, order); // Recovers a crash after provider order creation.
    if (payload.event === "payment.failed") {
      const failedRef = ref("_razorpayFailedPayments", payment.id);
      await db.runTransaction(async (tx) => {
        const [seen, current, failed] = await Promise.all([
          tx.get(eventRef),
          tx.get(ref(PURCHASES, purchaseId)),
          tx.get(failedRef),
        ]);
        if (seen.exists) return;
        const value = current.data();
        tx.create(eventRef, {
          event: payload.event,
          atMs: now(),
          expiresAt: Timestamp.fromMillis(now() + 90 * D.DAY_MS),
        });
        if (!failed.exists) tx.create(failedRef, { purchaseId, atMs: now() });
        if (!value.paymentId && !failed.exists) {
          tx.update(current.ref, {
            failureCount: FieldValue.increment(1),
            updatedAtMs: now(),
          });
          if ((value.failureCount || 0) >= 4)
            tx.set(
              ref(
                "_paymentLimits",
                D.hash(`${purchase.mode}:${purchase.uid}:create`),
              ),
              { blockedUntilMs: now() + 6 * 3600000 },
              { merge: true },
            );
        }
      });
      return { received: true };
    }
    const checked =
      payment.status === "refunded"
        ? { ...payment, status: "captured", captured: true }
        : payment;
    const settled = await settle(purchase.id, checked, order);
    // Authorized/failed payments never grant access, even in a signed webhook.
    if (settled.status === "pending")
      D.fail("unavailable", "Payment capture is not yet confirmed.");
    const disputed = payload.event.startsWith("payment.dispute.");
    if (payment.amount_refunded || disputed)
      await applyReversal(purchase.id, payment, disputed);
    await eventRef.set({
      event: payload.event,
      purchaseId,
      atMs: now(),
      expiresAt: Timestamp.fromMillis(now() + 90 * D.DAY_MS),
    });
    return { received: true };
  }
  async function adminSummary(companyId = "") {
    const key = companyId
      ? `${getConfig().mode}_company_${D.hash(D.id(companyId)).slice(0, 32)}`
      : `${getConfig().mode}_global`;
    return (await ref("paymentStats", key).get()).data() || {};
  }
  async function adminList(data) {
    D.input(data, ["status", "cursor"]);
    let q = db
      .collection(PURCHASES)
      .where("mode", "==", getConfig().mode)
      .orderBy("createdAtMs", "desc")
      .orderBy("id", "desc");
    if (data.status) {
      if (
        ![
          "creating",
          "created",
          "creation_unknown",
          "failed",
          "paid",
          "refunded",
          "partially_refunded",
          "disputed",
        ].includes(data.status)
      )
        D.fail("invalid-argument", "Invalid status filter.");
      q = q.where("status", "==", data.status);
    }
    if (data.cursor)
      q = q.startAfter(
        D.integer(
          data.cursor.createdAtMs,
          0,
          Number.MAX_SAFE_INTEGER,
          "cursor",
        ),
        D.id(data.cursor.id),
      );
    const rows = await q.limit(26).get(),
      items = rows.docs.slice(0, 25).map((s) => s.data());
    return {
      items,
      cursor:
        rows.size > 25
          ? { createdAtMs: items.at(-1).createdAtMs, id: items.at(-1).id }
          : null,
    };
  }
  async function adminReconcile(data) {
    D.input(data, ["purchaseId", "orderId"]);
    let purchase = snapshotData(
      await ref(PURCHASES, D.id(data.purchaseId)).get(),
    );
    if (!purchase) D.fail("not-found", "Purchase was not found.");
    if (!purchase.orderId && data.orderId)
      purchase = await attachOrder(
        purchase.id,
        await gateway().fetchOrder(D.id(data.orderId)),
      );
    return reconcile(purchase);
  }
  async function closeUncreated(data, actorUid) {
    D.input(data, ["purchaseId", "reason"]);
    const reason = D.text(data.reason, 500);
    if (reason.length < 12)
      D.fail(
        "invalid-argument",
        "Enter the reason for closing this uncreated checkout.",
      );
    const purchaseRef = ref(PURCHASES, D.id(data.purchaseId)),
      purchase = snapshotData(await purchaseRef.get());
    if (
      !purchase ||
      purchase.orderId ||
      purchase.paymentId ||
      purchase.createdAtMs > now() - 3600000
    )
      D.fail(
        "failed-precondition",
        "Only an uncreated checkout older than one hour can be closed.",
      );
    const client = gateway();
    if (purchase.keyId !== client.keyId)
      D.fail("failed-precondition", "Original provider key is required.");
    const matches =
      (await client.findOrdersByReceipt(purchase.id)).items?.filter(
        (order) => order.receipt === purchase.id,
      ) || [];
    if (matches.length)
      D.fail(
        "failed-precondition",
        "A provider order exists. Reconcile it instead of closing this checkout.",
      );
    await db.runTransaction(async (tx) => {
      const current = snapshotData(await tx.get(purchaseRef));
      if (
        !current ||
        current.orderId ||
        current.paymentId ||
        !["creating", "creation_unknown", "failed"].includes(current.status)
      )
        D.fail("failed-precondition", "Checkout changed. Refresh its status.");
      tx.update(purchaseRef, {
        status: "failed",
        needsReview: false,
        lastError: "no_provider_order_found",
        nextReconcileAtMs: FieldValue.delete(),
        updatedAtMs: now(),
      });
      auditRow(tx, current, "uncreated_checkout_closed", { actorUid, reason });
    });
    return { purchaseId: purchase.id, status: "failed" };
  }
  async function scheduledReconcile() {
    // Bounded queue; no scan of users/subscriptions, no per-client polling loop.
    const batch = await db
      .collection(PURCHASES)
      .where("mode", "==", getConfig().mode)
      .where("nextReconcileAtMs", "<=", now())
      .orderBy("nextReconcileAtMs")
      .limit(25)
      .get();
    const queue = [...batch.docs];
    async function processNext(snap) {
      const purchase = snap.data();
      try {
        await reconcile(purchase);
        const latest = (await snap.ref.get()).data();
        const attempts = (latest.reconcileCount || 0) + 1;
        const activeMonitoring = latest.subscriptionExpiresAtMs > now();
        // Pending orders are checked for 48h. Paid orders get one daily refund
        // check while active. Signed webhooks still handle older events.
        const next = latest.paymentId
          ? activeMonitoring
            ? now() + D.DAY_MS
            : null
          : attempts < 192
            ? now() + 15 * 60000
            : null;
        await snap.ref.update({
          reconcileCount: attempts,
          nextReconcileAtMs: next ?? FieldValue.delete(),
          needsReview: !latest.orderId,
        });
      } catch (error) {
        audit("payment_reconcile_failed", {
          purchaseId: purchase.id,
          code: error.code || "internal",
        });
        await snap.ref.update({
          nextReconcileAtMs: now() + 3600000,
          needsReview: true,
        });
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) await processNext(queue.shift());
      }),
    );
  }
  return {
    catalog,
    quote,
    create,
    verify,
    status,
    history,
    legacyHistory,
    entitlement,
    receipt,
    webhook,
    adminSummary,
    adminList,
    adminReconcile,
    closeUncreated,
    scheduledReconcile,
    actor,
    entitlementRef,
    readAppEntitlement,
    account: (owner) => context(owner, directReader),
  };
}
module.exports = { createPaymentService };
