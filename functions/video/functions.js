"use strict";
const { randomUUID, randomBytes } = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { getAuth } = require("firebase-admin/auth");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const D = require("../paymentDomain");
const V = require("./domain");
const { storage } = require("./storage");
const day = 86400000;
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
}) {
  const modeId = () => modeKey(mode.value());
  const root = (m = modeId()) => db.collection("videoService").doc(m);
  const teams = () => db.collection("_videoEditingTeam");
  const requestRef = (id) => root().collection("requests").doc(key(id));
  const draftRef = (uid) => root().collection("drafts").doc(D.hash(uid));
  const feed = (scope, sort) =>
    root()
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
      const ref = teams().doc(uid),
        snap = await (tx ? tx.get(ref) : ref.get()),
        row = snap.data();
      V.check(
        row?.active && ["manager", "editor"].includes(row.role),
        "Team access is disabled.",
        "permission-denied",
      );
      return { uid, role: row.role };
    }
    return { ...service.actor(q), role: "customer" };
  }
  function allow(a, r) {
    V.check(
      r &&
        (a.role === "admin" ||
          a.role === "manager" ||
          (a.role === "customer" ? r.uid === a.uid : r.editor === a.uid)),
      "Request is unavailable.",
      "permission-denied",
    );
  }
  function projections(tx, r, old) {
    const scopes = ["team", "u-" + D.hash(r.uid)];
    if (r.editor) scopes.push("e-" + r.editor);
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
      version: r.version,
      fileCount: r.files.length,
      metrics: metrics(r),
    };
    const values = [r.id, r.name, r.company, r.mobile, r.editorName]
      .filter(Boolean)
      .map((v) => v.toLowerCase());
    const tags = [
      "company:" + r.company.toLowerCase(),
      "state:" + r.state.toLowerCase(),
      "assignment:" + (r.editor ? "assigned" : "unassigned"),
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
    const previousScopes = old
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
      const view = feed(scope).parent;
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
        (!nextScopes.includes(scope) || r.archived || old.updated !== r.updated)
      )
        tx.delete(feed(scope, "updated").doc(updateKey(old)));
      if (nextScopes.includes(scope) && !r.archived) {
        tx.set(feed(scope).doc(r.id), { ...row, tags });
        tx.set(feed(scope, "updated").doc(updateKey(r)), { ...row, tags });
      } else tx.delete(feed(scope).doc(r.id));
    }
  }
  function save(tx, ref, r, change, a, action, old = r) {
    const time = Date.now(),
      next = { ...r, ...change, updated: time };
    tx.set(ref, next);
    projections(tx, next, old);
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
      "archived",
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
    if (a.role === "customer") return "u-" + D.hash(a.uid);
    if (a.role === "editor") return "e-" + a.uid;
    return d.editor ? "e-" + key(d.editor) : "team";
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
          "assignment",
        ].includes(d.filter),
        "Invalid filter.",
      );
      const value = V.line(d.value, 128);
      query = query.where(
        "tags",
        "array-contains",
        d.filter +
          ":" +
          (["search", "company", "state", "assignment"].includes(d.filter)
            ? value.toLowerCase()
            : value),
      );
    }
    query = range(query, d).orderBy(idField);
    if (d.cursor) query = query.startAfter(key(d.cursor));
    const size = [10, 20, 50].includes(d.size) ? d.size : 20;
    const snap = await query.limit(size + 1).get();
    const rows = snap.docs.slice(0, size).map((doc) => {
      const { tags, metrics, ...row } = doc.data();
      return row;
    });
    return { rows, cursor: snap.size > size ? snap.docs[size - 1].id : null };
  }
  async function details(a, d) {
    const ref = requestRef(d.id),
      r = (await ref.get()).data();
    allow(a, r);
    let query = ref
      .collection("history")
      .orderBy("time", "desc")
      .orderBy(idField, "desc");
    if (d.cursor)
      query = query.startAfter(Number(d.cursor.time), key(d.cursor.key));
    const snap = await query.limit(31).get(),
      docs = snap.docs.slice(0, 30),
      last = docs.at(-1);
    const balance = ["admin", "manager"].includes(a.role)
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
      tx.set(quota, { day: bucket, count: count + 1 });
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
        other,
        instructions,
        files,
        stage: "open",
        expires: time + day * configInt("VIDEO_DRAFT_DAYS", 3, 1, 14),
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
      V.check(!r.archived, "Request is archived.");
      if (d.action === "assign") {
        V.check(
          ["admin", "manager"].includes(a.role),
          "Manager required.",
          "permission-denied",
        );
        const member = (await tx.get(teams().doc(key(d.editor)))).data();
        V.check(
          member?.active && member.role === "editor",
          "Select an active editor.",
        );
        d = { ...d, editorName: member.name };
      }
      const change = V.transition(r, d.action, d, a.role, Date.now());
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
  async function members(a, d) {
    V.check(
      ["manager", "admin"].includes(a.role),
      "Manager required.",
      "permission-denied",
    );
    let query = teams().orderBy(idField);
    if (d.cursor) query = query.startAfter(key(d.cursor));
    const snap = await query.limit(51).get(),
      rows = snap.docs
        .slice(0, 50)
        .map((doc) => ({ uid: doc.id, ...doc.data() }));
    return { rows, cursor: snap.size > 50 ? rows.at(-1).uid : null };
  }
  async function manage(a, d) {
    V.check(
      ["manager", "admin"].includes(a.role),
      "Manager required.",
      "permission-denied",
    );
    const auth = getAuth();
    if (d.uid) {
      const ref = teams().doc(key(d.uid)),
        row = (await ref.get()).data();
      V.check(
        row &&
          (a.role === "admin" || row.role === "editor") &&
          typeof d.active === "boolean",
        "Permission denied.",
        "permission-denied",
      );
      // Deny immediately even while Firebase Auth account updates propagate.
      if (!d.active) await ref.update({ active: false });
      await auth.updateUser(ref.id, { disabled: !d.active });
      if (!d.active) await auth.revokeRefreshTokens(ref.id);
      await ref.update({ active: d.active });
      return {};
    }
    const email = V.line(d.email, 254).toLowerCase(),
      name = V.line(d.name, 120),
      mobile = V.line(d.mobile, 16);
    V.check(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && /^\+?\d{10,15}$/.test(mobile),
      "Check email and mobile.",
      "invalid-argument",
    );
    V.check(
      d.role === "editor" || (a.role === "admin" && d.role === "manager"),
      "Invalid team role.",
      "permission-denied",
    );
    const uid = "ve_" + D.hash(email).slice(0, 40),
      ref = teams().doc(uid);
    // Never attach privileges to an existing unrelated email account.
    try {
      await auth.createUser({
        uid,
        email,
        displayName: name,
        password: randomBytes(36).toString("base64url"),
        disabled: true,
      });
    } catch (e) {
      if (e.code !== "auth/uid-already-exists") throw e;
    }
    await db.runTransaction(async (tx) => {
      const row = (await tx.get(ref)).data();
      V.check(
        !row ||
          (row.provisioning && row.role === d.role && row.createdBy === a.uid),
        "Team account already exists.",
      );
      tx.set(ref, {
        name,
        email,
        mobile,
        role: d.role,
        active: false,
        provisioning: true,
        createdBy: a.uid,
      });
    });
    await auth.setCustomUserClaims(uid, { panel: "video-team" });
    await auth.updateUser(uid, { disabled: false });
    await ref.update({ active: true, provisioning: false });
    return { uid, email };
  }
  async function files(q, a, d) {
    const store = privateStore();
    if (["download", "downloadAll", "deleteRaw"].includes(d.action)) {
      const rr = requestRef(d.id),
        r = (await rr.get()).data();
      allow(a, r);
      V.check(
        a.role !== "customer",
        "Team access required.",
        "permission-denied",
      );
      if (d.action === "downloadAll") {
        V.check(!r.rawDeleted && !r.archived, "Raw files unavailable.");
        return {
          urls: await Promise.all(r.files.map((f) => store.download(f, true))),
        };
      }
      if (d.action === "download") {
        const f = r.files[d.index];
        V.check(
          !r.rawDeleted && !r.archived && Number.isInteger(d.index) && f,
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
      if (!r.rawDeleted) {
        await Promise.all(r.files.map((f) => store.remove(f)));
        await db.runTransaction(async (tx) => {
          const current = (await tx.get(rr)).data();
          if (!current.rawDeleted)
            save(
              tx,
              rr,
              current,
              {
                rawDeleted: true,
                rawDeletedAt: Date.now(),
                rawDeletedBy: a.uid,
              },
              a,
              "deleteRaw",
            );
        });
      }
      return {};
    }
    V.check(
      a.role === "customer",
      "Customer access required.",
      "permission-denied",
    );
    const ref = draftRef(a.uid);
    if (d.action === "discard") {
      await cleanup(ref, store, d.id);
      return {};
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
    if (d.action === "part") {
      V.check(
        !f.ready &&
          Number.isInteger(d.part) &&
          d.part >= 1 &&
          d.part <= Math.ceil(f.size / V.PART),
        "Invalid upload part.",
      );
      return { url: await store.sign(f, d.part) };
    }
    V.check(d.action === "finish", "Unknown upload action.");
    if (!f.ready) {
      await store.finish(f);
      await update((old) => ({ ...old, ready: true }));
    }
    return {};
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
    if (!row) return;
    for (const f of row.files) {
      await store.abort(f);
      await store.remove(f);
    }
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.id === row.id) tx.delete(ref);
    });
  }
  function call(handler, options = {}) {
    return onCall({ ...base, ...options }, async (q) => {
      try {
        const a = await actor(q),
          d = q.data || {};
        V.check(
          JSON.stringify(d).length <= 32000,
          "Request is too large.",
          "invalid-argument",
        );
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
        case "draft":
          return draft(q, a, d);
        case "currentDraft": {
          V.check(a.role === "customer", "Customer required.");
          const r = (await draftRef(a.uid).get()).data();
          return { id: r?.id || null, token: r?.token || null };
        }
        case "submit":
          return submit(a, d);
        case "members":
          return members(a, d);
        case "manage":
          return manage(a, d);
        default:
          return mutate(q, d);
      }
    }),
    videoEditingMedia: call(files, { secrets }),
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
