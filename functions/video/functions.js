"use strict";
const { randomUUID } = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { createVideoMailWorker } = require("./mail");
const { defineSecret } = require("firebase-functions/params");
const { getAuth } = require("firebase-admin/auth");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const D = require("../paymentDomain");
const V = require("./domain");
const { storage } = require("./storage");
const day = 86400000;
// Instance-local burst protection: no additional Firestore reads/writes. Durable draft quotas remain authoritative.
const { makeBurstLimiter, validateParts } = require("./hardening");
const burst = makeBurstLimiter();
const idField = FieldPath.documentId();
const secrets = [
  "VIDEO_R2_ACCOUNT_ID",
  "VIDEO_R2_ACCESS_KEY_ID",
  "VIDEO_R2_SECRET_ACCESS_KEY",
].map((n) => defineSecret(n));
const base = { region: "asia-south1", timeoutSeconds: 90, maxInstances: 12 };
const key = (v) => {
  V.check(
    typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v),
    "Invalid identifier.",
    "invalid-argument",
  );
  return v;
};
const slug = (v) =>
  String(v || "Unknown")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 50) || "Unknown";
const configInt = (name, fallback, min, max) => {
  const n = Number(process.env[name] || fallback);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const modeKey = (v) => {
  V.check(["live", "test"].includes(v), "Invalid payment mode.");
  return v;
};
function expose(r) {
  const { files, ...fields } = r;
  return {
    ...fields,
    files: files.map(({ name, size, type }) => ({ name, size, type })),
  };
}
function metrics(r) {
  const result = Object.fromEntries(
    V.statuses.map((s, i) => ["s" + i, Number(r.status === s)]),
  );
  return {
    ...result,
    rawBytes: r.rawDeleted ? 0 : r.files.reduce((n, f) => n + f.size, 0),
    eligibleCleanup: Number(r.status === "Completed" && !r.rawDeleted),
    elapsed: r.approvedAt ? r.approvedAt - r.created : 0,
  };
}
module.exports = function videoFunctions({
  db,
  service,
  mode,
  requireMasterAdmin,
  createStorage = storage,
  emailSender, emailPassword,
}) {
  const modeId = () => modeKey(mode.value());
  const root = (m = modeId()) => db.collection("videoService").doc(m);
  const teams = () => db.collection("_videoEditingTeam");
  const panelRef = () => teams().doc("_panel");
  const mail = createVideoMailWorker({ db, panelRef, root, emailSender, emailPassword });
  const requestRef = (id) => root().collection("requests").doc(key(id));
  const draftRef = (uid) => root().collection("drafts").doc(D.hash(uid));
  const feed = (scope, sort, m = modeId()) =>
    root(m)
      .collection("views")
      .doc(scope)
      .collection(sort === "updated" ? "updates" : "entries");
  const updateKey = (r) =>
    "VE-" + String(9999999999999 - r.updated).padStart(13, "0") + "-" + r.id;
  const privateStore = () =>
    createStorage({
      account: secrets[0].value(),
      access: secrets[1].value(),
      secret: secrets[2].value(),
      bucket: process.env.VIDEO_R2_BUCKET,
    });
  async function actor(q, tx) {
    V.check(q.auth?.uid, "Sign in first.", "unauthenticated");
    const uid = q.auth.uid,
      panel = q.auth.token.panel;
    if (panel === "admin") {
      await requireMasterAdmin(q);
      return { uid, role: "admin" };
    }
    if (panel === "video-team") {
      const ref = panelRef(), snap = await (tx ? tx.get(ref) : ref.get());
      const row = snap.data();
      V.check(row?.active === true && !row.busyUntil && row.uid === uid && (!row.sessionAfter || Number(q.auth.token.auth_time) >= row.sessionAfter),
        "Video panel access is disabled. Contact the administrator.", "permission-denied");
      return { uid, role: "panel" };
    }
    return { ...service.actor(q), role: "customer" };
  }
  function allow(a, r) {
    V.check(
      r &&
        (a.role === "admin" ||
          (a.role === "panel" && !r.archived && !r.deleting) ||
          (a.role === "customer" && r.uid === a.uid)),
      "Request is unavailable.",
      "permission-denied",
    );
  }
  function projections(tx, r, old, m = modeId()) {
    const scopes = ["u-" + D.hash(r.uid), r.archived ? "archived" : "team"];
    // Legacy per-editor views are removed as requests are updated; shared view is authoritative.
    const row = {
      id: r.id,
      name: r.name,
      mobile: r.mobile,
      company: r.company,
      state: r.state,
      category: r.category,
      created: r.created,
      updated: r.updated,
      status: r.status,
      editorName: r.editorName || "",
      rounds: r.rounds,
      rawDeleted: r.rawDeleted,
      thumbnail: r.thumbnail || "",
      duration: r.duration || 0,
      archived: r.archived === true,
      version: r.version,
      fileCount: r.files.length,
      metrics: metrics(r),
    };
    const values = [r.id, r.name, r.company, r.mobile]
      .filter(Boolean)
      .map((v) => v.toLowerCase());
    const tags = [
      "company:" + r.company.toLowerCase(),
      "state:" + r.state.toLowerCase(),
      "status:" + r.status,
      "category:" + r.category,
      "raw:" + r.rawDeleted,
      ...new Set(
        values.flatMap((v) => {
          const result = [];
          for (let n = 1; n <= Math.min(64, v.length); n++)
            result.push("search:" + v.slice(0, n));
          return result;
        }),
      ),
    ];
    const previousScopes = old?.archived && old.archiveIndexed ? ["archived", "u-" + D.hash(old.uid)] : old
      ? [
          "team",
          "u-" + D.hash(old.uid),
          ...(old.editor ? ["e-" + old.editor] : []),
        ]
      : [];
    const nextScopes = scopes;
    for (const scope of new Set([...previousScopes, ...nextScopes])) {
      const before = previousScopes.includes(scope)
        ? { total: 1, ...metrics(old) }
        : {};
      const after = nextScopes.includes(scope)
        ? { total: 1, ...metrics(r) }
        : {};
      const changes = {};
      for (const k of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        const delta = (after[k] || 0) - (before[k] || 0);
        if (delta) changes[k] = FieldValue.increment(delta);
      }
      const view = feed(scope, "created", m).parent;
      if (Object.keys(changes).length) {
        tx.set(view, changes, { merge: true });
        tx.set(
          view
            .collection("days")
            .doc(new Date(r.created + 19800000).toISOString().slice(0, 10)),
          changes,
          { merge: true },
        );
      }
      if (
        old &&
        previousScopes.includes(scope) &&
        (!nextScopes.includes(scope) || old.updated !== r.updated)
      )
        tx.delete(feed(scope, "updated", m).doc(updateKey(old)));
      if (nextScopes.includes(scope)) {
        tx.set(feed(scope, "created", m).doc(r.id), { ...row, tags });
        tx.set(feed(scope, "updated", m).doc(updateKey(r)), { ...row, tags });
      } else tx.delete(feed(scope, "created", m).doc(r.id));
    }
  }
  function save(tx, ref, r, change, a, action, old = r) {
    const time = Date.now(),
      next = { ...r, ...change, editor: "", editorName: "", updated: time };
    if (next.archived) next.archiveIndexed = true;
    tx.set(ref, next);
    projections(tx, next, old, ref.parent.parent.id);
    const detail = {};
    for (const k of [
      "status",
      "link",
      "version",
      "remarks",
      "rounds",
      "correction",
      "reason",
      "credit",
      "editorName",
      "rawDeleted",
      "rawCleanupPending",
      "archived",
      "archivedBy",
      "archivedAt",
      "restoredAt",
      "reviewedVersion",
    ])
      if (k in change) detail[k] = change[k];
    tx.create(ref.collection("history").doc(), {
      time,
      actor: a.uid,
      role: a.role,
      action,
      ...detail,
    });
    return next;
  }
  async function configuration(reader) {
    const ref = root().collection("settings").doc("service");
    const stored = (await (reader ? reader.get(ref) : ref.get())).data() || {};
    return {
      support:
        stored.support ??
        String(process.env.VIDEO_SUPPORT_WHATSAPP || "").replace(/^\+/, ""),
      maxRounds:
        stored.maxRounds ?? configInt("MAX_VIDEO_CORRECTIONS", 3, 0, 100),
      categories: stored.categories || V.categories,
    };
  }
  async function configure(a, d) {
    V.check(
      a.role === "admin",
      "Master Admin access required.",
      "permission-denied",
    );
    const support = V.line(d.support || "", 15, false);
    V.check(
      !support || /^[1-9]\d{7,14}$/.test(support),
      "Enter the support number with country code and digits only.",
    );
    V.check(
      Number.isInteger(d.maxRounds) && d.maxRounds >= 0 && d.maxRounds <= 100,
      "Enter 0 to 100 free rounds.",
    );
    V.check(
      Array.isArray(d.categories) &&
        d.categories.length > 0 &&
        d.categories.length <= 50,
      "Choose 1 to 50 categories.",
    );
    const categories = d.categories.map((v) => V.line(v, 100));
    V.check(
      new Set(categories).size === categories.length,
      "Category names must be unique.",
    );
    const ref = root().collection("settings").doc("service"),
      settings = { support, maxRounds: d.maxRounds, categories };
    const batch = db.batch();
    batch.set(ref, settings);
    batch.create(ref.collection("history").doc(), {
      ...settings,
      actor: a.uid,
      time: Date.now(),
    });
    await batch.commit();
    return {};
  }
  async function dashboard(q, a, d) {
    const settings = await configuration();
    const support = settings.support;
    const out = {
      role: a.role,
      maxRounds: settings.maxRounds,
      categories: settings.categories,
      statuses: V.statuses,
      support: /^[1-9]\d{7,14}$/.test(support) ? support : "",
    };
    if (a.role === "customer") {
      const [ledger, ctx] = await Promise.all([
        service.readAppEntitlement(a),
        service.account(a),
      ]);
      Object.assign(out, {
        balance: V.balance(ledger, Date.now()),
        name: ctx.user.name || "",
        mobile: a.mobileNo,
      });
    }
    const view = feed(scopeFor(a, d)).parent;
    if (d.from != null || d.to != null) {
      V.check(
        Number.isSafeInteger(d.from) &&
          Number.isSafeInteger(d.to) &&
          d.to >= d.from &&
          d.to - d.from <= 366 * day,
        "Choose up to one year.",
      );
      const indiaDay = (t) => new Date(t + 19800000).toISOString().slice(0, 10);
      const snap = await view
        .collection("days")
        .orderBy(idField)
        .startAt(indiaDay(d.from))
        .endAt(indiaDay(d.to))
        .get();
      out.stats = {};
      for (const doc of snap.docs)
        for (const [k, v] of Object.entries(doc.data()))
          out.stats[k] = (out.stats[k] || 0) + v;
    } else out.stats = (await view.get()).data() || {};
    return out;
  }
  function scopeFor(a, d) {
    if (d.archived === true) {
      V.check(a.role === "admin", "Admin required.", "permission-denied");
      return "archived";
    }
    if (a.role === "customer") return "u-" + D.hash(a.uid);
    V.check(!d.editor, "Editor assignment is no longer supported.", "invalid-argument");
    return "team";
  }
  function range(query, d) {
    for (const field of ["from", "to"])
      if (d[field] != null) {
        V.check(
          Number.isSafeInteger(d[field]) &&
            d[field] > 0 &&
            d[field] < 9999999999999,
          "Invalid date range.",
          "invalid-argument",
        );
        const prefix =
          "VE-" + String(9999999999999 - d[field]).padStart(13, "0") + "-";
        query = query.where(
          idField,
          field === "from" ? "<=" : ">=",
          prefix + (field === "from" ? "\uf8ff" : ""),
        );
      }
    return query;
  }
  async function list(a, d) {
    let query = feed(scopeFor(a, d), d.sort);
    if (d.filter) {
      V.check(
        [
          "status",
          "category",
          "raw",
          "search",
          "company",
          "state",
        ].includes(d.filter),
        "Invalid filter.",
      );
      const value = V.line(d.value, 128);
      query = query.where(
        "tags",
        "array-contains",
        d.filter +
          ":" +
          (["search", "company", "state"].includes(d.filter)
            ? value.toLowerCase()
            : value),
      );
    }
    query = range(query, d).orderBy(idField);
    if (d.cursor) query = query.startAfter(key(d.cursor));
    // Customer requests use five-row batches; keep admin/team paging unchanged.
    const size = a.role === "customer" ? 5 : 10;
    const snap = await query.limit(size).get();
    const rows = snap.docs.map((doc) => {
      const { tags, metrics, ...row } = doc.data();
      return row;
    });
    return { rows, cursor: snap.size === size ? snap.docs[size - 1].id : null };
  }
  async function details(a, d) {
    const ref = requestRef(d.id),
      r = (await ref.get()).data();
    allow(a, r);
    V.check(!r.deleting || a.role === "admin", "Request is being deleted.", "permission-denied");
    V.check(!r.archived || ["admin", "customer"].includes(a.role), "Request is archived.", "permission-denied");
    let query = ref
      .collection("history")
      .orderBy("time", "desc")
      .orderBy(idField, "desc");
    if (d.cursor)
      query = query.startAfter(Number(d.cursor.time), key(d.cursor.key));
    const snap = await query.limit(31).get(),
      docs = snap.docs.slice(0, 30),
      last = docs.at(-1);
    const balance = a.role === "admin"
      ? V.balance(
          (await service.entitlementRef(r.uid).get()).data(),
          Date.now(),
        )
      : null;
    return {
      row: expose(r),
      balance,
      history: docs.map((s) => s.data()),
      cursor: snap.size > 30 ? { time: last.data().time, key: last.id } : null,
    };
  }
  async function draft(q, a, d) {
    V.check(
      a.role === "customer",
      "Customer access required.",
      "permission-denied",
    );
    const manifest = V.manifest(d.files),
      token = key(d.token),
      ref = draftRef(a.uid);

    const thumbnail = V.thumbnail(d.thumbnail);
    const duration = typeof d.duration === "number" && Number.isFinite(d.duration) && d.duration > 0 && d.duration < 86400 ? Math.round(d.duration) : 0;
    const instructions = V.line(d.instructions, 5000),
      other = V.line(d.other || "", 100, false);
    const ctx = await service.account(a);
    await service.readAppEntitlement(a);
    return db.runTransaction(async (tx) => {
      const [snap, ent] = await Promise.all([
        tx.get(ref),
        tx.get(service.entitlementRef(a.uid)),
      ]);
      const old = snap.data(),
        time = Date.now();
      V.check(
        V.balance(ent.data(), time).available > 0,
        "An active Video Editing Service or Combo plan with one available video credit is required.",
      );
      if (
        old &&
        old.token === token &&
        old.stage === "open" &&
        old.expires > time
      )
        return { id: old.id, partSize: V.PART };
      const settings = await configuration(tx);
      V.check(
        settings.categories.includes(d.category),
        "Choose a video category.",
        "invalid-argument",
      );
      V.check(
        !old,
        "Resume or discard your previous draft before creating another.",
      );
      const quota = root().collection("draftLimits").doc(D.hash(a.uid)),
        bucket = Math.floor(time / day);
      const previous = (await tx.get(quota)).data();
      const count = previous?.day === bucket ? previous.count : 0;
      V.check(
        count < configInt("VIDEO_DAILY_DRAFT_LIMIT", 30, 1, 500),
        "Daily upload draft limit reached. Contact support.",
        "resource-exhausted",
      );
      const bytes = previous?.day === bucket ? Number(previous.bytes || 0) : 0;
      const requestedBytes = manifest.reduce((sum, f) => sum + f.size, 0);
      V.check(bytes + requestedBytes <= configInt("VIDEO_DAILY_UPLOAD_MB", 3000, 750, 30000) * 1000000,
        "Daily video upload allowance reached. Try tomorrow or contact support.", "resource-exhausted");
      tx.set(quota, { day: bucket, count: count + 1, bytes: bytes + requestedBytes });
      const id =
        "VE-" +
        String(9999999999999 - time).padStart(13, "0") +
        "-" +
        randomUUID().slice(0, 12);
      const name = String(
          ctx.user.name || ctx.user.fullName || "Customer",
        ).slice(0, 150),
        company = String(ctx.user.companyName || d.company || "").slice(0, 150),
        state = String(ctx.user.state || d.state || "").slice(0, 100);
      const date = new Date(time)
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "");
      const files = manifest.map((f, i) => {
        const stored =
          slug(name) +
          "_" +
          date +
          "_" +
          slug(company) +
          "_Video" +
          String(i + 1).padStart(2, "0") +
          "." +
          V.formats[f.type];
        return {
          ...f,
          key: [modeId(), D.hash(a.uid), id, stored].join("/"),
          ready: false,
        };
      });
      tx.create(ref, {
        id,
        token,
        uid: a.uid,
        name,
        mobile: a.mobileNo,
        company,
        state,
        category: d.category,
        thumbnail,
        duration,
        other,
        instructions,
        files,
        stage: "open",
        expires: time + day * configInt("VIDEO_DRAFT_DAYS", 1, 1, 14),
        created: time,
      });
      return { id, partSize: V.PART };
    });
  }
  function openDraft(row, id) {
    V.check(
      row && row.id === id && row.stage === "open" && row.expires > Date.now(),
      "Draft expired or was discarded.",
    );
  }
  async function submit(a, d) {
    V.check(
      a.role === "customer",
      "Customer access required.",
      "permission-denied",
    );
    const dr = draftRef(a.uid),
      rr = requestRef(d.id),
      er = service.entitlementRef(a.uid);
    return db.runTransaction(async (tx) => {
      const [ds, rs, es] = await Promise.all([
        tx.get(dr),
        tx.get(rr),
        tx.get(er),
      ]);
      if (rs.exists) {
        allow(a, rs.data());
        return { id: rs.id };
      }
      const row = ds.data();
      openDraft(row, d.id);
      V.check(
        row.files.every((f) => f.ready),
        "Finish uploading every video first.",
      );
      const settings = await configuration(tx);
      const c = V.credit(es.data(), "reserve", Date.now());
      const { stage, token, expires, ...data } = row;
      const r = {
        ...data,
        files: row.files.map(({ uploadId, ready, ...f }) => f),
        purchaseId: c.purchaseId,
        credit: "reserved",
        editor: "",
        editorName: "",
        archived: false,
        rawDeleted: false,
        rounds: 0,
        maxRounds: settings.maxRounds,
        version: 0,
        reviewedVersion: 0,
      };
      tx.set(er, c.ledger);
      save(
        tx,
        rr,
        r,
        { status: "Submitted", credit: "reserved" },
        a,
        "submit",
        null,
      );
      tx.create(root().collection("newRequestMail").doc(r.id), { id: r.id, category: r.category, created: r.created, nextAttemptAt: Date.now(), attempts: 0 });
      tx.delete(dr);
      return { id: r.id };
    });
  }
  async function mutate(q, d) {
    const rr = requestRef(d.id),
      op = key(d.op),
      receipt = rr.collection("commands").doc(D.hash(q.auth.uid + ":" + op));
    return db.runTransaction(async (tx) => {
      const a = await actor(q, tx),
        [snap, seen] = await Promise.all([tx.get(rr), tx.get(receipt)]),
        r = snap.data();
      allow(a, r);
      if (seen.exists) {
        V.check(
          seen.data().action === d.action,
          "Command was used for another action.",
        );
        return { id: r.id };
      }
      V.check(!r.deleting && (!r.archived || d.action === "restore"), "Request is archived or being deleted.");
      V.check(d.action !== "assign", "Editor assignment is disabled.", "permission-denied");
      const change = V.transition(r, d.action, d, a.role, Date.now());
      if (d.action === "archive") change.archivedBy = a.uid;
      if (["cancel", "reject"].includes(d.action) && !r.rawDeleted) change.rawCleanupPending = true;
      if (change.credit) {
        const er = service.entitlementRef(r.uid),
          snap = await tx.get(er);
        const c = V.credit(
          snap.data(),
          change.credit === "consumed" ? "consume" : "release",
          Date.now(),
          r.purchaseId,
        );
        tx.set(er, c.ledger);
      }
      if (Object.keys(change).length) save(tx, rr, r, change, a, d.action);
      tx.create(receipt, { action: d.action, time: Date.now() });
      return { id: r.id };
    });
  }
  function adminOnly(a) { V.check(a.role === "admin", "Master Admin required.", "permission-denied"); }
  async function panelAccount(a) {
    adminOnly(a);
    const row = (await panelRef().get()).data();
    return { account: row ? { uid: row.uid, email: row.email || "", name: row.name || "Video Editing", active: row.active === true, pending: !!row.busyUntil } : null };
  }
  async function managePanel(a, d) {
    adminOnly(a);
    const auth = getAuth(), ref = panelRef(), operation = d.operation;
    V.check(["save", "delete", "toggle"].includes(operation), "Invalid account action.", "invalid-argument");
    let email, name;
    if (operation === "save") {
      email = V.line(d.email, 254).toLowerCase(); name = V.line(d.name || "Video Editing", 120);
      V.check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter a valid email.", "invalid-argument");
      V.check(!d.password || (typeof d.password === "string" && d.password.length >= 8 && d.password.length <= 128 && /[a-z]/.test(d.password) && /[A-Z]/.test(d.password) && /[0-9]/.test(d.password)), "Use 8–128 characters with upper/lowercase letters and a number.", "invalid-argument");
    }
    if (operation === "delete") V.check(d.confirmed === true, "Confirm account deletion.");
    if (operation === "toggle") V.check(typeof d.active === "boolean", "Choose account status.");
    const initial = (await ref.get()).data();
    let candidate = initial?.uid || "ve_shared_" + randomUUID().replaceAll("-", "");
    if (!initial && operation === "save") {
      // Adopt a former editor account only if its Auth claims AND server-only record match.
      try {
        const existing = await auth.getUserByEmail(email);
        const legacy = (await teams().doc(existing.uid).get()).data();
        V.check(existing.customClaims?.panel === "video-team" && legacy && ["editor", "manager"].includes(legacy.role) && String(legacy.email).toLowerCase() === email, "Email belongs to another account. Choose another email.");
        candidate = existing.uid;
      } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
    }
    if (initial && operation === "save" && email !== initial.email) {
      try { const existing = await auth.getUserByEmail(email); V.check(existing.uid === initial.uid, "Email belongs to another account."); }
      catch(e) { if (e.code !== "auth/user-not-found") throw e; }
    }
    const op = randomUUID();
    const previous = await db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      V.check((row?.uid || null) === (initial?.uid || null), "Account changed. Refresh and retry.");
      V.check(!row?.busyUntil || row.busyUntil < Date.now(), "Account update in progress. Try again shortly.");
      V.check(row || operation === "save", "Create the panel account first.");
      if (!row && operation === "save") V.check(!!d.password, "Enter an initial password.");
      tx.set(ref, { uid: row?.uid || candidate, email: row?.email || email, name: row?.name || name, active: false, operation: op, busyUntil: Date.now()+180000 });
      return row || null;
    });
    const uid = previous?.uid || candidate;
    try {
      if (operation === "delete") {
        try { await auth.deleteUser(uid); } catch(e) { if (e.code !== "auth/user-not-found") throw e; }
        await ref.delete();
        return {};
      }
      if (operation === "toggle") {
        await auth.updateUser(uid, { disabled: !d.active });
        if (!d.active) await auth.revokeRefreshTokens(uid);
        await ref.set({ uid, email: previous.email, name: previous.name, active: d.active, sessionAfter: Math.ceil(Date.now()/1000) });
        return {};
      }
      let existing;
      try { existing = await auth.getUser(uid); } catch(e) { if(e.code !== "auth/user-not-found") throw e; }
      if (!existing) {
        V.check(!!d.password, "Set a password to finish account creation.");
        await auth.createUser({ uid, email, displayName: name, password: d.password, disabled: true });
      } else {
        await auth.updateUser(uid, { email, displayName: name, disabled: true, ...(d.password ? { password:d.password } : {}) });
      }
      await auth.setCustomUserClaims(uid, { panel: "video-team" });
      await auth.revokeRefreshTokens(uid);
      const active = previous ? (previous.active === true || d.active === true) : true;
      await auth.updateUser(uid, { disabled: !active });
      await ref.set({ uid, email, name, active, sessionAfter: Math.ceil(Date.now()/1000) });
      return {};
    } catch (e) {
      // Fail closed; administrator can retry with the same UID, or delete the account.
      await ref.set({ uid, email: previous?.email || email, name: previous?.name || name, active: false });
      throw e;
    }
  }
  async function files(q, a, d) {
    const store = privateStore();
    if (["download", "downloadAll", "deleteRaw"].includes(d.action)) {
      const rr = requestRef(d.id),
        r = (await rr.get()).data();
      allow(a, r);
      V.check(
        a.role !== "customer",
        "Video panel access required.",
        "permission-denied",
      );
      if (d.action === "downloadAll") {
        V.check(!r.rawDeleted && !r.archived && !r.rawCleanupPending && !r.deleting, "Raw files unavailable.");
        return {
          urls: await Promise.all(r.files.map((f) => store.download(f, true))),
        };
      }
      if (d.action === "download") {
        const f = r.files[d.index];
        V.check(
          !r.rawDeleted && !r.archived && !r.rawCleanupPending && !r.deleting && Number.isInteger(d.index) && f,
          "Raw file unavailable.",
        );
        return { url: await store.download(f, d.attachment === true) };
      }
      V.check(
        r.status === "Completed" &&
          r.approvedAt &&
          r.credit === "consumed" &&
          d.confirmed === true,
        "Final customer approval and deletion confirmation are required.",
      );
      V.check(!r.archived && !r.deleting, "Request unavailable.");
      await cleanRequestRaw(rr, store, a, "deleteRaw");
      return {};
    }
    V.check(
      a.role === "customer",
      "Customer access required.",
      "permission-denied",
    );
    const ref = draftRef(a.uid);
    if (d.action === "discard") {
      const id = key(d.id);
      if (!(await cleanup(ref, store, id))) {
        const existing = (await requestRef(id).get()).data();
        if (existing?.uid === a.uid) return { submitted: true, id };
      }
      return { discarded: true };
    }
    // Durable signing quota uses the same two authoritative reads as before; one write per batch.
    if (["parts", "part"].includes(d.action)) {
      const {file, numbers} = await db.runTransaction(async tx => {
        const [ds, es] = await Promise.all([tx.get(ref), tx.get(service.entitlementRef(a.uid))]);
        const row = ds.data(); openDraft(row, d.id);
        V.check(V.balance(es.data(), Date.now()).available > 0, "An active video plan and an available credit are required to upload.");
        const i = d.index, file = row.files[i];
        V.check(Number.isInteger(i) && file && file.uploadId && !file.ready, "Invalid upload session.");
        const numbers = validateParts(d.action === "part" ? [d.part] : d.parts, Math.ceil(file.size / V.PART));
        const count = Number(file.signedParts || 0) + numbers.length;
        V.check(count <= 150, "Upload retry allowance reached. Cancel and retry your draft or contact support.", "resource-exhausted");
        const files = [...row.files]; files[i] = {...file, signedParts: count}; tx.update(ref, {files});
        return {file, numbers};
      });
      const urls = await Promise.all(numbers.map(async part => ({part, url: await store.sign(file, part)})));
      return d.action === "part" ? {url: urls[0].url} : {urls};
    }
    const [draftSnap, ent] = await Promise.all([
      ref.get(),
      service.entitlementRef(a.uid).get(),
    ]);
    const row = draftSnap.data();
    openDraft(row, d.id);
    V.check(
      V.balance(ent.data(), Date.now()).available > 0,
      "An active video plan and an available credit are required to upload.",
    );
    const i = d.index,
      f = row.files[i];
    V.check(Number.isInteger(i) && f, "Invalid file.");
    async function update(fn) {
      return db.runTransaction(async (tx) => {
        const live = (await tx.get(ref)).data();
        openDraft(live, d.id);
        const files = [...live.files];
        files[i] = fn(files[i]);
        tx.update(ref, { files });
        return files[i];
      });
    }
    if (d.action === "resume") {
      if (f.ready) return { ready: true };
      if (!f.uploadId) {
        const uploadId = await store.start(f);
        let current;
        try {
          current = await update((old) =>
            old.uploadId ? old : { ...old, uploadId },
          );
        } finally {
          if (current?.uploadId !== uploadId)
            await store.abort({ ...f, uploadId });
        }
        Object.assign(f, current);
      }
      return { parts: await store.resume(f) };
    }
    V.check(f.uploadId, "Start upload first.");
    V.check(d.action === "finish", "Unknown upload action.");
    if (!f.ready) {
      try {
        await store.finish(f);
        await update((old) => ({ ...old, ready: true }));
      } catch (error) {
        const live = (await ref.get()).data();
        if ((!live || live.id !== d.id || live.stage === "cleaning") && !(await requestRef(d.id).get()).exists) {
          await store.remove(f);
        }
        throw error;
      }
    }
    return {};
  }
  async function cleanRequestRaw(ref, store, a, action) {
    const r = (await ref.get()).data();
    if (!r || r.rawDeleted || r.deleting) return;
    V.check(["Cancelled", "Rejected"].includes(r.status) || (r.status === "Completed" && r.approvedAt && r.credit === "consumed"), "Raw cleanup is not permitted.");
    for (const f of r.files) { await store.abort(f); await store.remove(f); }
    await db.runTransaction(async tx => {
      const live = (await tx.get(ref)).data();
      if (!live || live.rawDeleted || live.deleting) return;
      // Keep a minimal clip manifest for audit, not storage credentials or keys.
      save(tx, ref, live, { files: live.files.map(({name,size,type})=>({name,size,type})), rawDeleted: true, thumbnail: "", rawCleanupPending: false, rawDeletedAt: Date.now(), rawDeletedBy: a.uid }, a, action);
    });
  }
  async function permanentlyDelete(a,d) {
    V.check(a.role === "admin" && d.confirmed === true, "Admin deletion confirmation required.", "permission-denied");
    const ref = requestRef(d.id);
    const r = await db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      if (!row) return null;
      V.check(row.archived && ["Completed","Cancelled","Rejected"].includes(row.status) && d.mobile === row.mobile, "Archive a terminal request and confirm customer mobile first.");
      tx.update(ref, { deleting: true });
      return row;
    });
    if (!r) return {};
    // Final videos are externally owned Google Drive links; never delete an external file by URL.
    if (!r.rawDeleted) { const store = privateStore(); for (const f of r.files) { await store.abort(f); await store.remove(f); } }
    const audit = root().collection("deletionAudit").doc(r.id);
    await audit.set({id:r.id,uid:r.uid,credit:r.credit,purchaseId:r.purchaseId,status:r.status,actor:a.uid,time:Date.now(),externalDriveLinkRetained:!!r.link},{merge:true});
    // Keep the request in the archive until cleanup is complete so admins can retry safely.
    for (const child of await ref.listCollections()) await db.recursiveDelete(child);
    await db.runTransaction(async tx => {
      const live = (await tx.get(ref)).data();
      if (!live) return;
      const values = {total:1,...metrics(live)};
      const delta = Object.fromEntries(Object.entries(values).map(([k,v])=>[k,FieldValue.increment(-v)]));
      const scopes = live.archiveIndexed ? ["archived", "u-" + D.hash(live.uid)] : ["team", "u-" + D.hash(live.uid), ...(live.editor ? ["e-" + live.editor] : [])];
      for (const scope of scopes) {
        const view = feed(scope).parent;
        tx.set(view,delta,{merge:true});
        tx.set(view.collection("days").doc(new Date(live.created+19800000).toISOString().slice(0,10)),delta,{merge:true});
        tx.delete(feed(scope).doc(live.id));
        tx.delete(feed(scope,"updated").doc(updateKey(live)));
      }
      tx.delete(ref);
    });
    return {};
  }
  async function reindexArchived(a,d) {
    V.check(a.role === "admin", "Admin required.", "permission-denied");
    let q = root().collection("requests").where("archived","==",true).orderBy(idField);
    if(d.cursor) q=q.startAfter(key(d.cursor));
    const snap = await q.limit(10).get();
    let migrated=0;
    for (const doc of snap.docs) {
      const changed=await db.runTransaction(async tx=>{
        const row=(await tx.get(doc.ref)).data();
        if(!row || !row.archived || row.archiveIndexed || row.deleting) return false;
        const next={...row,archiveIndexed:true};
        projections(tx,next,row);
        tx.update(doc.ref,{archiveIndexed:true});
        return true;
      });
      if(changed) migrated++;
    }
    return {migrated,cursor:snap.size===10?snap.docs.at(-1).id:null};
  }
  async function cleanup(ref, store, expected) {
    const row = await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data || (expected && expected !== data.id)) return null;
      if (!expected && data.expires > Date.now()) return null;
      tx.update(ref, {
        stage: "cleaning",
        expires: Math.min(Date.now(), data.expires),
      });
      return data;
    });
    if (!row) return false;
    for (const f of row.files) {
      await store.abort(f);
      await store.remove(f);
    }
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.id === row.id) tx.delete(ref);
    });
    return true;
  }
  function call(handler, options = {}) {
    return onCall({ ...base, ...options }, async (q) => {
      try {
        const d = q.data || {};
        V.check(q.auth?.uid, "Sign in first.", "unauthenticated");
        V.check(
          JSON.stringify(d).length <= 32000,
          "Request is too large.",
          "invalid-argument",
        );
        V.check(burst(q.auth.uid, d.action), "Too many video operations. Please retry shortly.", "resource-exhausted");
        const a = await actor(q);
        return await handler(q, a, d);
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        if (e instanceof D.PaymentError)
          throw new HttpsError(e.code, e.message);
        console.error("Video service error", {
          action: q.data?.action,
          code: e.code || e.name,
        });
        throw new HttpsError(
          "internal",
          "Video service operation failed. Refresh and retry.",
        );
      }
    });
  }
  return {
    videoEditing: call(async (q, a, d) => {
      switch (d.action) {
        case "configure":
          return configure(a, d);
        case "dashboard":
          return dashboard(q, a, d);
        case "list":
          return list(a, d);
        case "details":
          return details(a, d);
        case "finalLink": {
          const r = (await requestRef(d.id).get()).data();
          allow(a, r);
          V.check(!r.deleting && r.status === "Completed" && r.link, "Final video is not available yet.");
          return { link: V.drive(r.link) };
        }
        case "draft":
          return draft(q, a, d);
        case "currentDraft": {
          V.check(a.role === "customer", "Customer required.");
          const r = (await draftRef(a.uid).get()).data();
          return { id: r?.id || null, token: r?.token || null, partSize: V.PART };
        }
        case "submit":
          return submit(a, d);
        case "panelAccount":
          return panelAccount(a);
        case "managePanel":
          return managePanel(a, d);
        case "members":
        case "manage":
          V.check(false, "Team accounts have been replaced by the single Video Panel account.", "permission-denied");
          break;
        case "reindexArchived":
          return reindexArchived(a,d);
        case "permanentDelete":
          return permanentlyDelete(a,d);
        case "reject":
        case "cancel": {
          const result = await mutate(q,d);
          try { await cleanRequestRaw(requestRef(d.id),privateStore(),a,"cancelRawCleanup"); } catch(e) { console.error("Raw cancellation cleanup deferred", {code:e.code||e.name}); }
          return result;
        }
        default:
          return mutate(q, d);
      }
    }, { secrets }),
    videoEditingMedia: call(files, { secrets }),
    ...(emailSender && emailPassword ? {
      videoNewRequestEmail: onDocumentCreated({ document: "videoService/{mode}/newRequestMail/{id}", region: "asia-south1", secrets: [emailPassword], timeoutSeconds: 90, maxInstances: 3, concurrency: 2 }, async event => { if (event.data) await mail.deliver(event.data.ref); }),
      videoNewRequestEmailRetry: onSchedule({ region: "asia-south1", secrets: [emailPassword], schedule: "every 5 minutes", timeoutSeconds: 300, maxInstances: 1 }, mail.retry),
    } : {}),
    videoEditingDraftCleanup: onSchedule(
      {
        ...base,
        secrets,
        schedule: "every 12 hours",
        timeoutSeconds: 540,
        maxInstances: 1,
      },
      async () => {
        const store = privateStore();
        for (const m of ["test", "live"]) {
          const pending = await root(m).collection("requests").where("rawCleanupPending","==",true).limit(60).get();
          for (const doc of pending.docs) {
            try { await cleanRequestRaw(doc.ref,store,{uid:"system",role:"admin"},"cancelRawCleanup"); } catch(e) { console.error("Raw cleanup retry failed", {code:e.code||e.name}); }
          }
          const snap = await root(m)
            .collection("drafts")
            .where("expires", "<=", Date.now())
            .limit(60)
            .get();
          for (const doc of snap.docs) {
            try {
              await cleanup(doc.ref, store);
            } catch (e) {
              console.error("Video draft cleanup deferred", {
                code: e.code || e.name,
              });
              // Give other expired drafts a turn if this object remains unavailable.
              await db.runTransaction(async (tx) => {
                const live = (await tx.get(doc.ref)).data();
                if (live?.stage === "cleaning" && live.id === doc.data().id)
                  tx.update(doc.ref, { expires: Date.now() + 3600000 });
              });
            }
          }
        }
      },
    ),
  };
};
