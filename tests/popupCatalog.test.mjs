import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { updatePopupCampaign, popupPreview, eligiblePopupQueue, isNewSubtypeDate } from "../src/Utils/popupModel.js";
const require = createRequire(import.meta.url);
const { annotateSubtypeDates, buildPopupFeed, POPUP_ROUTES } = require("../functions/popupCatalog.js");
const now = Date.parse("2026-10-23T12:00:00Z");
const image = "https://cdn.mlmposter.com/templates/new/first.webp";
const template = { id: "template-1", MainType: "MLM", Company: "company-a", SelectType: "Rank_Promotion", Subtype: "Gold", createdAt: new Date(now).toISOString(), Active: true, Launched: true, GraphicsLink: [{ id: "first", url: image }, { id: "second", url: "https://cdn.mlmposter.com/second.webp" }] };
const general = { kind: "general", title: "Offer", message: "Hello", imageUrl: image, destination: "/subscription", active: true, priority: 10 };
const campaign = { kind: "template", title: "Gold is here", active: true, templateId: template.id, templateMeta: template };
const config = rows => ({ schemaVersion: 1, revision: 7, campaigns: rows });

test("publisher uses exactly the first GraphicsLink and scopes MLM campaigns to their company", () => {
  const feed = buildPopupFeed(config({ launch: campaign }), new Map([[template.id, template]]), now);
  assert.equal(feed.items[0].imageUrl, image);
  assert.equal(feed.items[0].companyId, "company-a");
  assert.equal(feed.items[0].buttonLabel, "Create Now");
  assert.equal(eligiblePopupQueue(feed, "company-b", new Set(), now).length, 0);
  assert.equal(eligiblePopupQueue(feed, "company-a", new Set(), now).length, 1);
});
test("inactive or unlaunched templates cannot publish and a missing first link cannot select the second", () => {
  for (const invalid of [{ ...template, Active: false }, { ...template, Launched: false }, { ...template, GraphicsLink: [null, template.GraphicsLink[1]] }]) {
    assert.throws(() => buildPopupFeed(config({ launch: campaign }), new Map([[template.id, invalid]]), now));
  }
});
test("general popups only redirect to existing allowed app pages", () => {
  const feed = buildPopupFeed(config({ offer: general }), new Map(), now);
  assert.equal(feed.items[0].destination, "/subscription");
  assert.ok(POPUP_ROUTES.includes("/ask-ai"));
  for (const destination of ["https://example.com", "//example.com", "javascript:alert(1)", "/editor"]) assert.throws(() => buildPopupFeed(config({ offer: { ...general, destination } }), new Map(), now));
});
test("private admin fields never enter the public popup payload", () => {
  const feed = buildPopupFeed(config({ offer: { ...general, privateNote: "internal", createdByEmail: "private@example.com" } }), new Map(), now);
  const text = JSON.stringify(feed);
  assert.ok(!text.includes("private@example.com")); assert.ok(!text.includes("privateNote"));
});
test("queue supports dates, company targeting, priority and separate once-only IDs", () => {
  const feed = buildPopupFeed(config({ first: general, second: { ...general, priority: 20 }, future: { ...general, startsAt: new Date(now + 10000).toISOString() }, expired: { ...general, endsAt: new Date(now - 10000).toISOString() } }), new Map(), now);
  assert.deepEqual(eligiblePopupQueue(feed, "company-a", new Set(), now).map(row => row.id), ["second", "first"]);
  assert.deepEqual(eligiblePopupQueue(feed, "company-a", new Set(["second"]), now).map(row => row.id), ["first"]);
});
test("edit keeps a campaign identity; stale edits are rejected; delete removes only that entry", () => {
  const a = updatePopupCampaign(null, { id: "offer", values: general });
  const b = updatePopupCampaign(a, { id: "offer", expectedVersion: 1, values: { ...general, title: "Updated" } });
  assert.equal(b.campaigns.offer.id, "offer"); assert.equal(b.revision, 2);
  assert.throws(() => updatePopupCampaign(b, { id: "offer", expectedVersion: 1, values: general }), /another session/);
  assert.equal(Object.keys(updatePopupCampaign(b, { id: "offer", expectedVersion: 2, remove: true }).campaigns).length, 0);
});
test("preview and publisher agree on first link selection", () => {
  assert.equal(popupPreview(campaign), image);
  assert.throws(() => updatePopupCampaign(null, { id: "bad", values: { ...campaign, templateMeta: null } }), /select a template/);
});
test("subtype birth uses the earliest creation date, never updatedAt or serial", () => {
  const old = { ...template, createdAt: "2026-09-01T00:00:00Z", updatedAt: new Date(now).toISOString(), serial: 999999 };
  const result = annotateSubtypeDates([old, template]);
  assert.equal(result.items[1].subtypeAddedAt, old.createdAt.replace("Z", ".000Z"));
  assert.equal(isNewSubtypeDate(result.items[0].subtypeAddedAt, now), false);
});
test("new badges last exactly seven days, with future / legacy dates excluded", () => {
  assert.equal(isNewSubtypeDate(new Date(now - 7 * 86400000 + 1).toISOString(), now), true);
  assert.equal(isNewSubtypeDate(new Date(now - 7 * 86400000).toISOString(), now), false);
  assert.equal(isNewSubtypeDate(new Date(now + 1).toISOString(), now), false);
  assert.equal(isNewSubtypeDate("", now), false);
  assert.equal(annotateSubtypeDates([{ ...template, createdAt: undefined }, template]).items[1].subtypeAddedAt, "");
});
test("known older subtype birth survives deleting its oldest template", () => {
  const initial = annotateSubtypeDates([{ ...template, createdAt: "2026-09-01T00:00:00Z" }]);
  const afterDelete = annotateSubtypeDates([template], initial.subtypeDates);
  assert.equal(isNewSubtypeDate(afterDelete.items[0].subtypeAddedAt, now), false);
});
test("new subtype remains independently dated within the same main type / company", () => {
  const rows = annotateSubtypeDates([{ ...template, Subtype: "Silver", createdAt: "2026-09-01" }, template]);
  assert.equal(isNewSubtypeDate(rows.items[0].subtypeAddedAt, now), false);
  assert.equal(isNewSubtypeDate(rows.items[1].subtypeAddedAt, now), true);
});
test("publish reuses the existing callable and bounded exact-document reads", () => {
  const source = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const section = source.slice(source.indexOf('exports.panelCreateR2AdminMediaUpload ='));
  assert.match(section, /operation === "publishPopups"/);
  assert.match(section, /db\.collection\("popup"\)\.doc\("popup"\)/);
  assert.match(section, /catalog\/v1\/popups\.json/);
  assert.ok(!/exports\.\w*Popup\w*\s*=/.test(source));
});
