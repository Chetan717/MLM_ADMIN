import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../../../Firebase";
import { useAdminAuth } from "../../Auth/AdminAuthContext";
import { adminReadCache } from "../../Utils/adminReadCache";
import { createPlanId } from "../../Utils/createPlanId";
import useUnsavedFormGuard from "../../Utils/useUnsavedFormGuard";
import ImageUploadInput from "../../Utils/Imageuploadinput";

const readPlans = httpsCallable(functions, "panelAppPlans");
const savePlans = httpsCallable(functions, "panelSaveAppPlans");
const input = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm";
const emptyPlan = () => ({ planId: createPlanId(), PlanName: "", PlanAmount: "", Day_value: 30, Duration: "30 Days", Type: "Pro", downloads: 0, videoCredits: "", unlimitedDownloads: false, serviceType: "poster", Launch: false, Description: "", image_url: "" });

export default function AppPlans() {
  const { session } = useAdminAuth();
  const authorized = session?.role === "Master Admin" || session?.assigntab?.includes("companies");
  const [plans, setPlans] = useState([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const guard = useUnsavedFormGuard({ form: plans, ready: authorized && !loading, saving: busy, saved: success });
  const load = useCallback(async (force = false) => {
    if (!authorized) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const result = await adminReadCache.get(auth.currentUser?.uid, "app-plans", async () => (await readPlans({})).data, { force });
      setPlans(result.plans); setVersion(result.version); setSuccess(false);
    } catch (e) { setError(e.message || "App plans could not load."); }
    finally { setLoading(false); }
  }, [authorized]);
  useEffect(() => { void load(); }, [load]);
  const edit = (id, key, value) => {
    setSuccess(false);
    setPlans((old) => old.map((p) => p.planId === id ? { ...p, [key]: value, ...(key === "Day_value" ? { Duration: `${value} Days` } : {}) } : p));
  };
  const save = async (event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setSuccess(false);
    try {
      const result = (await savePlans({ plans, expectedVersion: version })).data;
      setPlans(result.plans); setVersion(result.version); setSuccess(true);
      adminReadCache.invalidate(auth.currentUser?.uid, "app-plans");
    } catch (e) { setError(e.message || "App plans could not save."); }
    finally { setBusy(false); }
  };
  if (!authorized) return <div className="p-6">App plan management permission is required.</div>;
  return <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5 text-gray-900 dark:text-gray-100">
    {guard.modal}
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold">App Plans</h1><p className="text-sm text-gray-500 mt-1">Manage subscriptions for the entire MLM LIVE app.</p></div>
      <button type="button" disabled={loading || busy} onClick={() => { if (!guard.dirty || window.confirm("Discard unsaved plan changes and reload?")) void load(true); }} className="px-4 py-2 rounded-xl border disabled:opacity-50">Reload</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-4">{error}</p>}
    {success && <p role="status" className="rounded-xl bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 p-4">App plans saved. All users will use this catalog.</p>}
    {loading ? <p className="p-6">Loading app plans…</p> : <form data-admin-edit-form="true" onSubmit={save} className="space-y-5">
      {plans.length === 0 && <p className="rounded-2xl border border-dashed p-8 text-center text-gray-500">No app plans yet. Add your first plan below.</p>}
      {plans.map((p, index) => <fieldset key={p.planId} disabled={busy} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
        <div className="flex justify-between items-center"><h2 className="font-bold">{p.PlanName || `Plan ${index + 1}`}</h2><button type="button" onClick={() => { setSuccess(false); setPlans((old) => old.filter((r) => r.planId !== p.planId)); }} className="text-sm text-red-600">Remove</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm font-medium space-y-1 block">Plan name<input required maxLength={100} className={input} value={p.PlanName} onChange={(e) => edit(p.planId, "PlanName", e.target.value)} /></label>
          <label className="text-sm font-medium space-y-1 block">Plan amount (₹)<input required type="number" min="1" max="100000" step="0.01" className={input} value={p.PlanAmount} onChange={(e) => edit(p.planId, "PlanAmount", e.target.value)} /><span className="block text-xs text-gray-500">GST is added during checkout.</span></label>
          <label className="text-sm font-medium space-y-1 block">Duration (days)<input required type="number" min="1" max="1000000" step="1" className={input} value={p.Day_value} onChange={(e) => edit(p.planId, "Day_value", e.target.value)} /></label>
          <label className="text-sm font-medium space-y-1 block">Service<select className={input} value={p.serviceType || "poster"} onChange={(e) => edit(p.planId, "serviceType", e.target.value)}><option value="poster">Poster Design</option><option value="video">Video Editing Service</option><option value="combo">Poster + Video Editing Combo</option></select></label>
          <label className="text-sm font-medium space-y-1 block">Plan type<select className={input} value={p.Type || "Pro"} onChange={(e) => edit(p.planId, "Type", e.target.value)}>{["Basic", "Pro", "Standard", "Annual Plan", "Unlimited"].map((value) => <option key={value}>{value}</option>)}</select></label>
          {p.serviceType !== "video" && <label className="text-sm font-medium space-y-1 block">Poster downloads<input type="number" min="0" max="100000000" step="1" disabled={p.unlimitedDownloads || p.Type === "Unlimited"} className={input} value={p.downloads} onChange={(e) => edit(p.planId, "downloads", e.target.value)} /></label>}
          {p.serviceType !== "poster" && <label className="text-sm font-medium space-y-1 block">Video editing credits (optional)<input type="number" min="1" max="100000000" step="1" className={input} value={p.videoCredits ?? ""} onChange={(e) => edit(p.planId, "videoCredits", e.target.value)} /><span className="block text-xs text-gray-500">Leave empty for validity-based video access. Set a number for credit-based video service.</span></label>}
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.Launch} onChange={(e) => edit(p.planId, "Launch", e.target.checked)} />Published</label>
          {p.serviceType !== "video" && <label className="flex items-center gap-2"><input type="checkbox" checked={p.unlimitedDownloads || p.Type === "Unlimited"} disabled={p.Type === "Unlimited"} onChange={(e) => edit(p.planId, "unlimitedDownloads", e.target.checked)} />Unlimited poster downloads</label>}
        </div>
        <label className="block space-y-1 text-sm font-medium">Description<textarea maxLength={2000} className={input} value={p.Description} onChange={(e) => edit(p.planId, "Description", e.target.value.replace(/[\r\n]+/g, " "))} /></label>
        <div className="space-y-1 text-sm font-medium"><span>Plan image (optional)</span><ImageUploadInput value={p.image_url} onChange={(value) => edit(p.planId, "image_url", value)} storagePath="companies/plans" placeholder="Plan image URL or upload" /></div>
      </fieldset>)}
      <div className="flex flex-wrap gap-3 sticky bottom-0 bg-gray-50 dark:bg-gray-950 py-4">
        <button type="button" disabled={busy || plans.length >= 50} onClick={() => { setSuccess(false); setPlans((old) => [...old, emptyPlan()]); }} className="rounded-xl border px-5 py-2.5 disabled:opacity-50">Add Plan</button>
        <button type="submit" disabled={busy} className="rounded-xl bg-violet-600 text-white px-5 py-2.5 font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save App Plans"}</button>
      </div>
    </form>}
  </div>;
}
