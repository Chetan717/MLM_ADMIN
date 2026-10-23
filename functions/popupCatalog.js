// Public CDN payload builders. No network or Firebase dependencies.
const DAY = 86400000;
const POPUP_ROUTES = Object.freeze([
  "/", "/profile", "/subscription", "/categories", "/search", "/selectcomp",
  "/mlmprofile", "/alltemp?group=everyday-moments", "/reporting", "/ask-ai",
]);
function timestamp(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value && typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  const number = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function subtypeKey(row) {
  return JSON.stringify([row.MainType || "General", row.Company || row.company || "", row.SelectType || row.type || "", String(row.Subtype || "").trim()]);
}
function annotateSubtypeDates(items, previous = {}) {
  const dates = { ...previous };
  for (const row of items) {
    const key = subtypeKey(row);
    if (!String(row.Subtype || "").trim()) continue;
    const birth = timestamp(row.subtypeAddedAt || row.createdAt);
    if (dates[key] === "" || !birth) dates[key] = ""; // Unknown legacy date never labels old designs as new.
    else dates[key] = new Date(Math.min(timestamp(dates[key]) || birth, birth)).toISOString();
  }
  return { subtypeDates: dates, items: items.map(row => ({ ...row, subtypeAddedAt: dates[subtypeKey(row)] || "" })) };
}
function clean(value, max = 120) { return String(value || "").trim().slice(0, max); }
function safeMediaUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function publicTemplate(row) {
  if (!row || row.Active !== true || row.Launched !== true) throw new Error("Selected template is no longer active and launched. Choose a published template.");
  const graphic = row.GraphicsLink?.[0];
  if (!graphic || !safeMediaUrl(graphic.suggestionImage || graphic.url || graphic.backgroundVideoUrl)) throw new Error("The selected template's first GraphicsLink needs a valid image / preview.");
  // All these fields already belong to the public template catalog. Do not copy
  // arbitrary document fields, creator details or admin campaign metadata.
  const keys = ["id", "MainType", "Company", "SelectType", "Subtype", "serial", "ShowCaseForm", "Date", "Active", "Launched"];
  const result = Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
  result.GraphicsLink = row.GraphicsLink.filter(Boolean).slice(0, 20);
  result.type = row.SelectType || row.type || "";
  result.image = row.Showcase_url || row.image || "";
  return result;
}
function buildPopupFeed(source, templates, now = Date.now()) {
  if (source?.schemaVersion !== 1 || !source.campaigns || Array.isArray(source.campaigns)) throw new Error("Popup document must have schemaVersion 1 and a campaigns map.");
  const rows = Object.entries(source.campaigns);
  if (rows.length > 40) throw new Error("Keep at most 40 popup campaigns. Archive old campaigns before publishing more.");
  const items = rows.filter(([, row]) => row?.active === true && (!timestamp(row.endsAt) || timestamp(row.endsAt) > now)).map(([id, row]) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid popup campaign ID.");
    if (!["general", "template"].includes(row.kind)) throw new Error("Invalid popup type.");
    const start = timestamp(row.startsAt), end = timestamp(row.endsAt);
    if (row.startsAt && !start || row.endsAt && !end || end && start && end <= start) throw new Error("Check popup start / end dates.");
    const item = { id, kind: row.kind, title: clean(row.title, 100), message: clean(row.message, 400),
      priority: Math.max(0, Math.min(100, Number(row.priority) || 0)), createdAt: new Date(timestamp(row.createdAt) || now).toISOString(),
      startsAt: start ? new Date(start).toISOString() : "", endsAt: end ? new Date(end).toISOString() : "",
      buttonLabel: row.kind === "template" ? "Create Now" : clean(row.buttonLabel || "Explore Now", 35), companyId: clean(row.companyId),
    };
    if (!item.title) throw new Error("Every active popup needs a title.");
    if (row.kind === "template") {
      item.template = publicTemplate(templates.get(String(row.templateId || "")));
      item.companyId = item.template.MainType === "MLM" ? String(item.template.Company || "") : "";
      if (item.template.MainType === "MLM" && !item.companyId) throw new Error("MLM templates must have a company.");
      const first = item.template.GraphicsLink[0];
      item.imageUrl = safeMediaUrl(first.suggestionImage || first.url || first.backgroundVideoUrl);
      item.video = !first.suggestionImage && !first.url && Boolean(first.backgroundVideoUrl);
    } else {
      if (!POPUP_ROUTES.includes(row.destination)) throw new Error("Choose one of the allowed app pages.");
      item.destination = row.destination;
      item.imageUrl = safeMediaUrl(row.imageUrl);
      if (!item.imageUrl) throw new Error("General popups need an HTTPS image URL.");
    }
    return item;
  });
  const feed = { schemaVersion: 1, revision: Number(source.revision) || 0, generatedAt: new Date(now).toISOString(), items };
  if (Buffer.byteLength(JSON.stringify(feed)) > 750 * 1024) throw new Error("Popup feed is too large. Reduce active campaigns / template graphics.");
  return feed;
}
module.exports = { DAY, POPUP_ROUTES, timestamp, subtypeKey, annotateSubtypeDates, publicTemplate, buildPopupFeed };
