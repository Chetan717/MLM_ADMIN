"use strict";
const {
  onCall,
  onRequest,
  HttpsError,
} = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const {
  defineSecret,
  defineString,
  defineBoolean,
} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const D = require("./paymentDomain");
const { createPaymentService } = require("./paymentService");
// Company media metadata shares one Firestore document. Keep a bounded margin
// below its 1 MiB limit; checkout/payment requests retain D.input's 64 KiB cap.
const COMPANY_MAX_BYTES = 768 * 1024;
const COMPANY_MAX_ENTRIES = 2000;

module.exports = function paymentFunctions({
  db,
  FieldValue,
  Timestamp,
  requireAssignedAdminTab,
  requireMasterAdmin,
  emailSender, emailPassword,
}) {
  const keyId = defineSecret("RAZORPAY_KEY_ID");
  const keySecret = defineSecret("RAZORPAY_KEY_SECRET");
  const webhookSecret = defineSecret("RAZORPAY_WEBHOOK_SECRET");
  const enabled = defineBoolean("PAYMENTS_ENABLED", { default: false });
  const mode = defineString("RAZORPAY_MODE", { default: "test" });
  // CORS is a browser control, not an authentication substitute. Firebase
  // authentication and ownership are checked even when a caller has no Origin.
  const origins = String(
    process.env.PAYMENT_ALLOWED_ORIGINS ||
      "https://app.mlmlive.in,https://admin.mlmlive.in,https://mlm-admin-smoky.vercel.app",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    origins.some(
      (origin) => !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin),
    )
  )
    throw new Error(
      "PAYMENT_ALLOWED_ORIGINS must contain exact HTTPS origins.",
    );
  const audit = (action, fields) => logger.warn(action, fields);
  const service = createPaymentService({
    db,
    FieldValue,
    Timestamp,
    getConfig: () => ({
      get keyId() {
        return keyId.value();
      },
      get keySecret() {
        return keySecret.value();
      },
      mode: mode.value(),
      enabled: enabled.value(),
    }),
    audit,
  });
  const base = {
    region: "asia-south1",
    cors: origins,
    maxInstances: 12,
    concurrency: 20,
    timeoutSeconds: 60,
    memory: "256MiB",
  };
  function wrap(action, callback) {
    return async (request) => {
      try {
        return await callback(request);
      } catch (error) {
        audit(action, {
          code: error.code || "internal",
          actorHash: D.hash(request.auth?.uid || "anonymous").slice(0, 20),
        });
        if (error instanceof HttpsError) throw error;
        if (error instanceof D.PaymentError)
          throw new HttpsError(error.code, error.message, error.details);
        throw new HttpsError(
          "internal",
          "Payment could not be completed. Check payment status before trying again.",
        );
      }
    };
  }
  const secrets = [keyId, keySecret];
  async function companySave(request) {
    await requireAssignedAdminTab(
      request,
      "companies",
      "Company management access is required.",
    );
    D.input(request.data, ["companyId", "company", "expectedPlansVersion"], COMPANY_MAX_BYTES);
    const source = D.input(request.data.company, [
      "name",
      "address",
      "owner",
      "designation",
      "logos",
      "topuplines",
      "profile",
      "active",
      "launched",
      "trainings",
      "meetings",
    ], COMPANY_MAX_BYTES);
    const companyRef = request.data.companyId
      ? db.collection("mlmcomp").doc(D.id(request.data.companyId))
      : db.collection("mlmcomp").doc();
    const company = {
      name: D.text(source.name, 200),
      address: D.text(source.address || "", 500),
      owner: D.text(source.owner || "", 200),
      designation: D.text(source.designation || "", 200),
      active: source.active === true,
      launched: source.launched === true,
    };
    if (!company.name) D.fail("invalid-argument", "Company name is required.");
    // Never spread an arbitrary object into a document with financial fields.
    const entries = (rows, field, max = COMPANY_MAX_ENTRIES) => {
      if (rows === undefined) return [];
      if (!Array.isArray(rows))
        D.fail("invalid-argument", `Company ${field} must be a list.`);
      if (rows.length > max)
        D.fail("invalid-argument", `Company ${field} has ${rows.length} entries; maximum is ${max}.`);
      return rows;
    };
    const stringRows = (rows, fields, label) => {
      rows = entries(rows, label);
      return rows.map((row) => {
        D.input(row, fields);
        return Object.fromEntries(
          fields.map((field) => {
            let raw = row[field] ?? "";
            // Older company documents store logo sizes as numbers. Preserve
            // those values in the form's string representation, not as objects.
            if (field === "size" && typeof raw === "number") {
              if (!Number.isFinite(raw) || raw < 0 || raw > 100000)
                D.fail("invalid-argument", "Invalid company logos size.");
              raw = String(raw);
            }
            const value = D.text(raw, 2048);
            if (
              ["link", "profileimage"].includes(field) &&
              value &&
              !/^https:\/\//i.test(value)
            )
              D.fail("invalid-argument", "Company images must use HTTPS.");
            return [field, value];
          }),
        );
      });
    };
    company.logos = stringRows(source.logos, ["link", "size"], "logos");
    company.topuplines = stringRows(source.topuplines, ["name", "link"], "topuplines");
    company.profile = stringRows(source.profile, [
      "profilename",
      "profileimage",
    ], "profile");
    for (const [kind, label, images] of [
      ["trainings", "trainingname", "trainingimages"],
      ["meetings", "meetingname", "meetingimages"],
    ]) {
      company[kind] = entries(source[kind], kind, 200).map((row) => {
        D.input(row, [label, images], COMPANY_MAX_BYTES);
        const urls = entries(row[images], `${kind}.${images}`, 500);
        return {
          [label]: D.text(row[label], 200),
          [images]: urls.map((url) => {
            const value = D.text(url, 2048);
            if (!/^https:\/\//i.test(value))
              D.fail("invalid-argument", "Image must use HTTPS.");
            return value;
          }),
        };
      });
    }
    await db.runTransaction(async (tx) => {
      const current = await tx.get(companyRef);
      if (request.data.companyId && !current.exists)
        D.fail("not-found", "Company was not found.");
      const version = Number(current.data()?.plansVersion || 0);
      if (current.exists && request.data.expectedPlansVersion !== version)
        D.fail(
          "failed-precondition",
          "Company changed in another session. Reload before saving.",
        );
      // Include preserved legacy fields in the size check. Never truncate media
      // lists to make the document fit or silently clear an invalid section.
      if (Buffer.byteLength(JSON.stringify({ ...current.data(), ...company })) > COMPANY_MAX_BYTES)
        D.fail("invalid-argument", "Company data is too large. Reduce media entries before saving.");
      tx.set(
        companyRef,
        {
          ...company,
          plansVersion: version + 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByUid: request.auth.uid,
          ...(!current.exists
            ? { createdAt: FieldValue.serverTimestamp() }
            : {}),
        },
        { merge: true },
      );
      tx.create(db.collection("paymentAudit").doc(), {
        action: "company_saved",
        companyId: companyRef.id,
        actorUid: request.auth.uid,
        atMs: Date.now(),
      });
    });
    return { companyId: companyRef.id };
  }
  async function appPlansRead(request) {
    await requireAssignedAdminTab(request, "companies", "App plan management access is required.");
    D.input(request.data || {}, []);
    const snap = await db.collection("appPlans").doc("main").get();
    return { version: Number(snap.data()?.version || 0), plans: D.appPlans(snap.data()) };
  }
  async function appPlansSave(request) {
    await requireAssignedAdminTab(request, "companies", "App plan management access is required.");
    D.input(request.data, ["plans", "expectedVersion"], COMPANY_MAX_BYTES);
    if (!Array.isArray(request.data.plans)) D.fail("invalid-argument", "Plans must be a list.");
    const expectedVersion = D.integer(request.data.expectedVersion, 0, Number.MAX_SAFE_INTEGER, "catalog version");
    const plans = D.appPlans({ Plans: request.data.plans });
    if (plans.some(p => p.Launch && !D.planHasBenefits(p)))
      D.fail("failed-precondition", "Published Poster/Combo plans need at least one poster credit or Unlimited poster downloads.");
    const ref = db.collection("appPlans").doc("main");
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const version = Number(current.data()?.version || 0);
      if (version !== expectedVersion) D.fail("failed-precondition", "App plans changed in another session. Reload before saving.");
      tx.set(ref, { Plans: plans, version: version + 1, scope: "app", appId: "mlmlive",
        updatedAt: FieldValue.serverTimestamp(), updatedByUid: request.auth.uid });
      tx.create(db.collection("paymentAudit").doc(), { action: "app_plans_saved", scope: "app",
        actorUid: request.auth.uid, planIds: plans.map((p) => p.planId), atMs: Date.now() });
    });
    return { version: expectedVersion + 1, plans };
  }
  return {
    panelAppPlans: onCall(base, wrap("app_plans_read_denied", appPlansRead)),
    panelSaveAppPlans: onCall(base, wrap("app_plans_save_denied", appPlansSave)),
    panelAssignPaymentMarketingUsers: onCall(
      base,
      wrap("payment_marketing_assignment_denied", async (request) => {
        await requireAssignedAdminTab(request, "leads", "User Leads access is required.");
        D.input(request.data, ["memberId", "userIds"]);
        const memberId = D.id(request.data.memberId);
        if (!Array.isArray(request.data.userIds) || !request.data.userIds.length || request.data.userIds.length > 100) D.fail("invalid-argument", "Select between 1 and 100 users.");
        const userIds = [...new Set(request.data.userIds.map(value => D.id(value)))];
        await db.runTransaction(async tx => {
          const member = await tx.get(db.collection("mteam").doc(memberId));
          if (!member.exists || member.data().active !== true || !member.data().referCode || !member.data().assign_coupon_id) D.fail("failed-precondition", "Select an active Marketing member with a coupon and refer code.");
          const coupon = await tx.get(db.collection("couponcode").doc(D.id(member.data().assign_coupon_id)));
          if (!coupon.exists || coupon.data().active !== true || coupon.data().assigned_user?.id !== memberId) D.fail("failed-precondition", "Marketing coupon assignment needs review.");
          const users = await Promise.all(userIds.map(userId => tx.get(db.collection("users").doc(userId))));
          if (users.some(user => !user.exists)) D.fail("not-found", "A selected user no longer exists. Refresh the list.");
          users.forEach(user => tx.update(user.ref, { referredBy: D.couponCode(member.data().referCode), referredByMteam: memberId, mteamCouponCode: D.couponCode(coupon.data().code) }));
          tx.create(db.collection("paymentAudit").doc(), { action: "marketing_users_assigned", actorUid: request.auth.uid, memberId, userIds, atMs: Date.now() });
        });
        return { count: userIds.length };
      }),
    ),
    ...require("./video/functions")({ db, service, mode, requireMasterAdmin, emailSender, emailPassword }),
    paymentCatalog: onCall(
      base,
      wrap("payment_catalog_denied", service.catalog),
    ),
    paymentQuote: onCall(base, wrap("payment_quote_denied", service.quote)),
    paymentCreateOrder: onCall(
      { ...base, secrets },
      wrap("payment_order_denied", service.create),
    ),
    paymentVerify: onCall(
      { ...base, secrets },
      wrap("payment_verification_denied", service.verify),
    ),
    paymentStatus: onCall(
      { ...base, secrets },
      wrap("payment_status_failed", service.status),
    ),
    paymentHistory: onCall(
      base,
      wrap("payment_history_denied", service.history),
    ),
    paymentLegacyHistory: onCall(
      base,
      wrap("payment_legacy_history_denied", service.legacyHistory),
    ),
    paymentEntitlement: onCall(
      base,
      wrap("payment_entitlement_denied", service.entitlement),
    ),
    paymentReceipt: onCall(base, wrap("payment_receipt_denied", service.receipt)),
    panelSavePaymentCompany: onCall(
      base,
      wrap("payment_company_write_denied", companySave),
    ),
    panelPaymentOverview: onCall(
      base,
      wrap("payment_admin_read_denied", async (request) => {
        await requireAssignedAdminTab(
          request,
          "userdashboard",
          "Subscription Dashboard access is required.",
        );
        D.input(request.data, ["status", "cursor"]);
        const [summary, page] = await Promise.all([
          service.adminSummary(),
          service.adminList(request.data),
        ]);
        return { summary, ...page };
      }),
    ),
    panelReconcilePayment: onCall(
      { ...base, secrets },
      wrap("payment_admin_reconcile_failed", async (request) => {
        await requireMasterAdmin(request);
        return service.adminReconcile(request.data);
      }),
    ),
    panelCloseUncreatedPayment: onCall(
      { ...base, secrets },
      wrap("payment_admin_close_failed", async (request) => {
        await requireMasterAdmin(request);
        return service.closeUncreated(request.data, request.auth.uid);
      }),
    ),
    razorpayWebhook: onRequest(
      {
        region: "asia-south1",
        secrets: [...secrets, webhookSecret],
        cors: false,
        maxInstances: 12,
        concurrency: 20,
        timeoutSeconds: 60,
        memory: "256MiB",
      },
      async (req, res) => {
        res.set("Cache-Control", "no-store");
        if (req.method !== "POST")
          return res.status(405).send("Method not allowed");
        const body = req.rawBody;
        if (!Buffer.isBuffer(body) || body.length > 262144)
          return res.status(413).send("Invalid body");
        if (
          !D.signatureValid(
            webhookSecret.value(),
            body,
            req.get("x-razorpay-signature"),
          )
        ) {
          audit("payment_webhook_bad_signature", {});
          return res.status(401).send("Invalid signature");
        }
        try {
          const payload = JSON.parse(body.toString("utf8"));
          // Headers other than the HMAC are not signed. Deduplicate the signed
          // bytes, so changing x-razorpay-event-id cannot bypass replay handling.
          const eventId = D.hash(body);
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
          if (!supported.includes(payload.event))
            return res.status(200).json({ ignored: true });
          const paymentId =
            payload.payload?.payment?.entity?.id ||
            payload.payload?.refund?.entity?.payment_id ||
            payload.payload?.dispute?.entity?.payment_id;
          D.id(paymentId, "payment ID");
          if (!paymentId.startsWith("pay_"))
            return res.status(400).send("Invalid payment ID");
          // Durable intake acknowledges promptly, before slow provider/API work.
          // Only minimal IDs are stored, never raw bodies, card details or CVV.
          try {
            await db
              .collection("_razorpayWebhookInbox")
              .doc(eventId)
              .create({
                event: payload.event,
                // Only the signed provider timestamp is used for dispute ordering.
                providerCreatedAt: Number.isSafeInteger(payload.created_at) && payload.created_at > 0 ? payload.created_at : 0,
                paymentId,
                mode: mode.value(),
                status: "pending",
                receivedAtMs: Date.now(),
                expiresAt: Timestamp.fromMillis(Date.now() + 90 * D.DAY_MS),
              });
          } catch (error) {
            if (error.code !== 6 && error.code !== "already-exists")
              throw error;
          }
          return res.status(200).json({ received: true });
        } catch (error) {
          audit("payment_webhook_processing_failed", {
            code: error.code || "internal",
          });
          // Non-2xx asks Razorpay to retry. Never acknowledge a transient failure.
          return res
            .status(error instanceof SyntaxError ? 400 : 503)
            .send("Processing pending");
        }
      },
    ),
    processRazorpayWebhook: onDocumentCreated(
      {
        document: "_razorpayWebhookInbox/{eventId}",
        region: "asia-south1",
        secrets,
        retry: true,
        maxInstances: 12,
        concurrency: 20,
        timeoutSeconds: 120,
        memory: "256MiB",
      },
      async (event) => {
        const snapshot = event.data;
        if (!snapshot) return;
        const row = (await snapshot.ref.get()).data();
        if (!row || row.status === "processed") return;
        try {
          if (row.mode !== mode.value())
            throw new D.PaymentError(
              "failed-precondition",
              "Webhook requires its original payment mode.",
            );
          await service.webhook(
            {
              event: row.event,
              created_at: row.providerCreatedAt || 0,
              payload: { payment: { entity: { id: row.paymentId } } },
            },
            event.params.eventId,
          );
          await snapshot.ref.update({
            status: "processed",
            processedAtMs: Date.now(),
            lastError: FieldValue.delete(),
          });
        } catch (error) {
          audit("payment_webhook_processing_failed", {
            eventId: event.params.eventId,
            code: error.code || "internal",
          });
          await snapshot.ref.update({
            status: "pending",
            lastError: error.code || "internal",
            lastAttemptAtMs: Date.now(),
          });
          throw error; // Eventarc retries; no charge/benefit is duplicated.
        }
      },
    ),
    reconcileRazorpayPayments: onSchedule(
      {
        region: "asia-south1",
        schedule: "every 15 minutes",
        timeZone: "Asia/Kolkata",
        secrets,
        maxInstances: 1,
        timeoutSeconds: 540,
        memory: "256MiB",
      },
      service.scheduledReconcile,
    ),
  };
};
