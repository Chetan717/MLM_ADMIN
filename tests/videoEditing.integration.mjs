import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const { initializeApp, deleteApp } = require("firebase-admin/app"),
  { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { createPaymentService } = require("./paymentService"),
  D = require("./paymentDomain"),
  build = require("./video/functions");
test("Customer, assigned editor and master admin complete and settle one request through the callable handlers", async () => {
  assert.match(
    process.env.FIRESTORE_EMULATOR_HOST || "",
    /^127\.0\.0\.1:\d+$/,
    "Local Firestore emulator required",
  );
  const projectId = "demo-mlmlive-video";
  const app = initializeApp({ projectId }, "test-" + randomUUID()),
    db = getFirestore(app);
  const mobile = "8" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
    uid = "mobile_" + mobile;
  const own = { uid, token: { mobileNo: mobile } },
    outsider = { uid: "mobile_1111111111", token: { mobileNo: "1111111111" } };
  const owner = { uid: "master", token: { panel: "admin" } },
    editor = { uid: "ed-" + randomUUID(), token: { panel: "video-team" } };
  const otherEditor = {
    uid: "ed-" + randomUUID(),
    token: { panel: "video-team" },
  };
  const service = createPaymentService({
    db,
    FieldValue,
    Timestamp,
    getConfig: () => ({ mode: "test" }),
  });
  const parts = new Map(),
    objects = new Set();
  const fakeStorage = {
    start: async (f) => {
      parts.set(f.key, []);
      return "part-id";
    },
    resume: async (f) => parts.get(f.key),
    sign: async (f) => f.key,
    finish: async (f) => {
      assert.equal(parts.get(f.key).length, 1);
      objects.add(f.key);
    },
    download: async (f) => "signed:" + f.key,
    remove: async (f) => objects.delete(f.key),
    abort: async () => {},
  };
  const fns = build({
    db,
    service,
    mode: { value: () => "test" },
    requireMasterAdmin: async (q) => assert.equal(q.auth.uid, owner.uid),
    createStorage: () => fakeStorage,
  });
  const call = (auth, action, data = {}, media = false) =>
    fns[media ? "videoEditingMedia" : "videoEditing"].run({
      auth,
      data: { op: randomUUID(), ...data, action },
    });
  const media = (auth, action, data) => call(auth, action, data, true);
  const er = service.entitlementRef(uid),
    start = Date.now(),
    term = {
      purchaseId: "original",
      startsAtMs: start - 1000,
      expiresAtMs: start + 86400000,
      creditLimit: 1,
      remainingCredits: 1,
    };
  const plan = (serviceType) =>
    er.set({ scope: "app", uid, grants: [{ ...term, serviceType }] });
  const draft = {
    files: [{ name: "clip.mp4", size: 20, type: "video/mp4" }],
    category: "Instagram Reel",
    instructions: "Add captions",
    token: randomUUID(),
  };
  try {
    await db.collection("users").doc(uid).set({
      uid,
      mobileNo: mobile,
      name: "Test Customer",
      companyName: "Demo",
    });
    for (const u of [editor, otherEditor])
      await db
        .collection("_videoEditingTeam")
        .doc(u.uid)
        .set({ role: "editor", active: true, name: u.uid });
    await plan("poster");
    await assert.rejects(() => call(own, "draft", draft), {
      code: "failed-precondition",
    });
    await plan("video");
    const { id } = await call(own, "draft", draft);
    assert.equal((await call(own, "draft", draft)).id, id);
    await assert.rejects(() => call(own, "submit", { id }));
    await media(own, "resume", { id, index: 0 });
    const { url } = await media(own, "part", { id, index: 0, part: 1 });
    parts.get(url).push(1);
    await media(own, "finish", { id, index: 0 });
    assert.deepEqual(await media(own, "resume", { id, index: 0 }), {
      ready: true,
    });
    await Promise.all([
      call(own, "submit", { id }),
      call(own, "submit", { id }),
    ]);
    assert.equal((await er.get()).data().grants[0].reservedVideoCredits, 1);
    await assert.rejects(() =>
      call(own, "draft", { ...draft, token: randomUUID() }),
    );
    await assert.rejects(() => call(outsider, "details", { id }));
    await assert.rejects(() => media(editor, "download", { id, index: 0 }));
    await call(owner, "assign", { id, editor: otherEditor.uid });
    await call(owner, "assign", { id, editor: editor.uid });
    assert.equal((await call(otherEditor, "list")).rows.length, 0);
    await assert.rejects(() =>
      media(otherEditor, "download", { id, index: 0 }),
    );
    assert.ok((await media(editor, "download", { id, index: 0 })).url);
    await assert.rejects(() =>
      media(editor, "deleteRaw", { id, confirmed: true }),
    );
    await call(editor, "downloaded", { id });
    await call(editor, "edit", { id });
    await assert.rejects(() =>
      call(editor, "deliver", { id, version: 0, link: "https://example.test" }),
    );
    // Existing requests remain reviewable and retain their original credit after expiry.
    const expired = (await er.get()).data();
    expired.grants[0].expiresAtMs = Date.now() - 1;
    await er.set(expired);
    for (let version = 1; version <= 4; version++) {
      const link =
        "https://drive.google.com/file/d/version0000" + version + "/view";
      await call(editor, "deliver", { id, version: version - 1, link });
      await assert.rejects(() =>
        call(own, "approve", { id, version, confirmed: true }),
      );
      await assert.rejects(() =>
        call(own, "reviewed", { id, version: version - 1 }),
      );
      await call(own, "reviewed", { id, version });
      if (version < 4) {
        const op = randomUUID();
        await Promise.all([
          call(own, "correct", { op, id, version, note: "Change captions" }),
          call(own, "correct", { op, id, version, note: "Change captions" }),
        ]);
        assert.equal((await er.get()).data().grants[0].remainingCredits, 1);
      } else
        await assert.rejects(() =>
          call(own, "correct", { id, version, note: "Extra round" }),
        );
    }
    await assert.rejects(() =>
      call(editor, "approve", { id, version: 4, confirmed: true }),
    );
    await Promise.all([
      call(own, "approve", { id, version: 4, confirmed: true }),
      call(own, "approve", { id, version: 4, confirmed: true }),
    ]);
    const g = (await er.get()).data().grants[0];
    assert.equal(g.reservedVideoCredits, 0);
    assert.equal(g.remainingCredits, 0);
    const result = await call(own, "details", { id });
    assert.equal(result.row.status, "Completed");
    assert.equal(result.row.rounds, 3);
    assert.equal(
      result.history.filter((e) => e.credit === "consumed").length,
      1,
    );
    assert.equal((await call(own, "dashboard")).stats.s6, 1);
    assert.equal(
      (await call(editor, "list", { filter: "search", value: mobile })).rows[0]
        .id,
      id,
    );
    await assert.rejects(() => call(owner, "archive", { id, mobile: "wrong" }));
    await call(owner, "archive", { id, mobile });
    assert.equal(objects.size, 1, "archive must retain original files");
    assert.equal((await call(owner, "list", {archived:true})).rows[0].id,id);
    assert.equal((await call(own, "list")).rows[0].id,id, "customer retains delivery access");
    await assert.rejects(()=>call(editor,"list",{archived:true}));
    await call(owner,"restore",{id});
    await media(editor, "deleteRaw", { id, confirmed: true });
    assert.equal(objects.size, 0);
    await call(owner, "archive", { id, mobile });
    assert.equal((await call(own, "list")).rows[0].id,id);
    await db
      .collection("_videoEditingTeam")
      .doc(editor.uid)
      .update({ active: false });
    await assert.rejects(() => call(editor, "list"));
    assert.equal((await call(own, "dashboard")).stats.s6, 1);
    await plan("video");
    const { id: second } = await call(own, "draft", {
      ...draft,
      token: randomUUID(),
    });
    await media(own, "resume", { id: second, index: 0 });
    const part = await media(own, "part", { id: second, index: 0, part: 1 });
    parts.get(part.url).push(1);
    await media(own, "finish", { id: second, index: 0 });
    await call(own, "submit", { id: second });
    await call(own, "cancel", { id: second, note: "No longer required" });
    assert.equal(objects.size,0,"cancel automatically removes raw clips");
    const released = (await er.get()).data().grants[0];
    assert.equal(released.remainingCredits, 1);
    assert.equal(released.reservedVideoCredits, 0);
    const next = await call(own, "list", {
      filter: "status",
      value: "Cancelled",
      sort: "updated",
    });
    assert.equal(next.rows[0].id, second);
    await call(owner,"archive",{id:second,mobile});
    await assert.rejects(()=>call(own,"permanentDelete",{id:second,mobile,confirmed:true}));
    await call(owner,"permanentDelete",{id:second,mobile,confirmed:true});
    await assert.rejects(()=>call(owner,"details",{id:second}));
    assert.equal((await er.get()).data().grants[0].remainingCredits,1);
    // Distinct entries and a tie-breaker exercise cursor paging at real page boundaries.
    const feed = db
      .collection("videoService")
      .doc("test")
      .collection("views")
      .doc("u-" + D.hash(uid))
      .collection("entries");
    const batch = db.batch();
    for (let i = 0; i < 12; i++) {
      const ref = feed.doc("sample-" + String(i).padStart(2, "0"));
      batch.set(ref, { id: ref.id, tags: ["status:Submitted"] });
    }
    await batch.commit();
    const page1 = await call(own, "list", {
      size: 10,
      filter: "status",
      value: "Submitted",
    });
    const page2 = await call(own, "list", {
      size: 10,
      filter: "status",
      value: "Submitted",
      cursor: page1.cursor,
    });
    assert.equal(page1.rows.length, 10);
    assert.equal(page2.rows.length, 2);
    assert.equal(
      new Set([...page1.rows, ...page2.rows].map((r) => r.id)).size,
      12,
    );
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
});
