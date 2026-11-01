import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAdminSavedChanges, applySavedRow, adminSavedChanges } from "../src/Utils/adminSavedChanges.js";
import { setAdminSession, clearAdminSession } from "../src/Utils/adminSession.js";
import { moveTemplateId, orderTemplateRows, readTemplateListPreferences, writeTemplateListPreferences } from "../src/Pages/Templates/templateListPreferences.js";

test("confirmed adds/edits/deletes update local rows and flags without a loader", () => {
  const store = createAdminSavedChanges();
  let rows = [{ id: "old", serial: 1 }];
  const unsubscribe = store.subscribe("admin", change => { if (change.collection === "templates") rows = applySavedRow(rows, change); });
  store.remember("admin", "templates", "new", { serial: 2 }, "added");
  store.remember("admin", "templates", "old", { serial: 3 }, "updated");
  assert.deepEqual(rows, [{ id: "old", serial: 3 }, { id: "new", serial: 2 }]);
  assert.equal(store.recent("admin").new.kind, "added");
  assert.equal(store.recent("admin").old.kind, "updated");
  store.remember("admin", "templates", "new", { Active: true }, "updated");
  assert.equal(store.recent("admin").new.kind, "added");
  store.remember("admin", "templates", "old", null);
  assert.equal(rows.length, 1); assert.equal(store.recent("admin").old, undefined);
  unsubscribe();
});

test("badges stay isolated by account, survive tab subscribers, and clear on refresh/logout/reopen", () => {
  const store = createAdminSavedChanges();
  store.remember("a", "templates", "one", {}, "added");
  const off = store.subscribe("a", () => {}); off();
  assert.equal(store.recent("a").one.kind, "added");
  assert.deepEqual(store.recent("b"), {});
  const beforeRefresh = store.revision("a");
  store.remember("a", "templates", "two", {}, "updated");
  store.clearRecent("a", beforeRefresh);
  assert.deepEqual(Object.keys(store.recent("a")), ["two"]);
  assert.deepEqual(createAdminSavedChanges().recent("a"), {});
  store.clear(); assert.deepEqual(store.recent("a"), {});
});

test("session verification preserves flags, while a different actor or logout clears them", () => {
  const first = { uid: "shared", id: "first", role: "Admin", assigntab: ["templates", "leads"] };
  setAdminSession(first);
  adminSavedChanges.remember("shared", "templates", "one", {}, "added");
  setAdminSession({ ...first, assigntab: ["leads", "templates"] });
  assert.equal(adminSavedChanges.recent("shared").one.kind, "added");
  setAdminSession({ ...first, id: "second" });
  assert.deepEqual(adminSavedChanges.recent("shared"), {});
  adminSavedChanges.remember("shared", "templates", "two", {}, "added");
  clearAdminSession(); assert.deepEqual(adminSavedChanges.recent("shared"), {});
});

test("an older in-flight read cannot undo a newer saved row or deletion", () => {
  const store = createAdminSavedChanges();
  const revision = store.revision("a");
  store.remember("a", "templates", "one", { Subtype: "new" }, "updated");
  store.remember("a", "templates", "one", { Active: true }, "updated");
  store.remember("a", "templates", "gone", null);
  store.remember("a", "quality", "one", { checks: {} });
  assert.deepEqual(store.mergeSince("a", "templates", [{ id: "one", Subtype: "old", serial: 8 }, { id: "gone" }], revision),
    [{ id: "one", Subtype: "new", serial: 8, Active: true }]);
  assert.deepEqual(store.mergeSince("a", "templates", [{ id: "one", Subtype: "remote" }], store.revision("a")), [{ id: "one", Subtype: "remote" }]);
});

test("arranging filtered/paginated IDs preserves every hidden record and its relative order", () => {
  const ids = Array.from({ length: 45 }, (_, i) => `t${i}`);
  const moved = moveTemplateId(ids, "t0", "t40", "after");
  assert.equal(moved.indexOf("t0"), 40);
  assert.deepEqual(moved.filter(id => id !== "t0"), ids.slice(1));
  assert.equal(new Set(moved).size, ids.length);
  assert.equal(moveTemplateId(ids, "missing", "t1"), ids);
  assert.equal(moveTemplateId(ids, "t1", "t1"), ids);
  assert.deepEqual(orderTemplateRows([{ id: "new" }, { id: "t40" }, { id: "t0" }], moved).map(row => row.id), ["t40", "t0", "new"]);
});

test("view/order preferences persist by account using IDs only and tolerate blocked storage", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const preferences = { view: "horizontal", order: { MLM: ["one", "two"], General: [] } };
  assert.equal(writeTemplateListPreferences(storage, "admin a", preferences), true);
  assert.deepEqual(readTemplateListPreferences(storage, "admin a"), preferences);
  assert.equal(readTemplateListPreferences(storage, "admin b").view, "table");
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("quota"); } };
  assert.equal(readTemplateListPreferences(blocked, "a").view, "table");
  assert.equal(writeTemplateListPreferences(blocked, "a", preferences), false);
});

test("save paths mark added templates only after confirmed writes and never refetch retained template pages", async () => {
  const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [add, edit, copy, home, data, reads] = await Promise.all([
    source("Pages/Templates/Forms/AddTemplate.jsx"), source("Pages/Templates/Forms/EditTemplate.jsx"),
    source("Pages/Templates/Forms/CopyRankPromotion.jsx"), source("Pages/Templates/TemplateHome.jsx"),
    source("Pages/Templates/TemplateData.jsx"), source("Utils/adminTemplateReads.js"),
  ]);
  assert.ok(add.indexOf("await setDoc(") < add.indexOf("rememberTemplateChange(templateId"));
  assert.match(add, /rememberTemplateChange\([\s\S]*?"added"\)/);
  assert.ok(edit.indexOf("await batch.commit()") < edit.indexOf("rememberTemplateChange(id"));
  assert.equal((copy.match(/updatedAt: new Date\(\) }, "added"\)/g) || []).length, 2);
  assert.doesNotMatch(home + data, /useAdminTabUpdates/);
  assert.doesNotMatch(reads, /notifyAdminTabUpdates/);
  assert.match(home, /clearRecent\(uid, revision\)/);
});
