import { doc, getDocFromServer, runTransaction, serverTimestamp, collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../../Firebase";
import { COLLECTIONS } from "../../collections";
import { updatePopupCampaign, validatePopupDocument, POPUP_CACHE_MS } from "../../Utils/popupModel";
export const POPUP_CDN_BASE = String(import.meta.env.VITE_TEMPLATE_CDN_BASE_URL || "https://cdn.mlmposter.com").replace(/\/+$/, "");
let cache = null, pending = null, companyCache = null;
const catalogCache = new Map();
const ref = () => doc(db, "popup", "popup");
function checkAdmin(session) {
  if (session?.role !== "Master Admin" || session.uid !== auth.currentUser?.uid) throw new Error("Sign in as Master Admin to manage app popups.");
}
export async function loadPopupSettings(session, force = false) {
  checkAdmin(session);
  if (!force && cache?.uid === session.uid && Date.now() - cache.time < POPUP_CACHE_MS) return cache.data;
  if (pending?.uid === session.uid) return pending.promise;
  const promise = (async () => { const snap = await getDocFromServer(ref()); checkAdmin(session); const data = validatePopupDocument(snap.exists() ? snap.data() : null); cache = { uid: session.uid, time: Date.now(), data }; return data; })();
  pending = { uid: session.uid, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}
export async function savePopupSettings(session, command) {
  checkAdmin(session);
  const data = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref()); checkAdmin(session);
    const next = updatePopupCampaign(snapshot.exists() ? snapshot.data() : null, command);
    transaction.set(ref(), { ...next, updatedAt: serverTimestamp() });
    return next;
  });
  cache = { uid: session.uid, time: Date.now(), data };
  return data;
}
export async function publishPopupSettings(session) {
  checkAdmin(session);
  const result = await httpsCallable(functions, "panelCreateR2AdminMediaUpload")({ operation: "publishPopups" });
  if (!result.data?.ok) throw new Error("CDN publish did not complete. Retry Publish.");
  if (cache?.uid === session.uid) cache.data = { ...cache.data, publishedRevision: result.data.revision };
  return result.data;
}
export async function loadPopupCompanies(session) {
  checkAdmin(session);
  if (companyCache?.uid === session.uid && Date.now() - companyCache.time < POPUP_CACHE_MS) return companyCache.items;
  const snapshot = await getDocs(collection(db, COLLECTIONS.MLMCOMP));
  checkAdmin(session);
  const items = snapshot.docs.map(row => ({ id: row.id, name: row.data().name || row.data().companyName || row.id }));
  companyCache = { uid: session.uid, time: Date.now(), items };
  return items;
}
function segment(value) { return String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 140) || "_"; }
export async function loadPopupTemplates(mainType, type, company = "", force = false) {
  const path = mainType === "General" ? `general/${segment(type)}.json` : `mlm/${segment(company)}/${segment(type)}.json`;
  if (!type || mainType === "MLM" && !company) throw new Error("Select a type and company first.");
  const hit = catalogCache.get(path);
  if (!force && hit && Date.now() - hit.time < POPUP_CACHE_MS) return hit.items;
  const versionResponse = await fetch(`${POPUP_CDN_BASE}/catalog/v1/version.json`, { cache: "no-store" });
  if (!versionResponse.ok) throw new Error("Template CDN is unavailable. Check the existing CDN sync.");
  const version = String((await versionResponse.json()).version || "");
  const response = await fetch(`${POPUP_CDN_BASE}/catalog/v1/${path}?v=${encodeURIComponent(version)}`);
  if (!response.ok) throw new Error("This template category is not on the CDN yet. Finish its normal template publish, then retry.");
  const payload = await response.json();
  if (!Array.isArray(payload.items)) throw new Error("Invalid template catalog.");
  const items = payload.items.filter(row => row.Active === true && row.Launched === true);
  catalogCache.set(path, { items, time: Date.now() });
  return items;
}
