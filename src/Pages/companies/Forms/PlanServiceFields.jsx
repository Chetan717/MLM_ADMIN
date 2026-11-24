export default function PlanServiceFields({ plan, update, inputCls }) {
  return (
    <div className="space-y-3 rounded-xl border border-violet-200 dark:border-violet-900 p-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Plan Service
        <select value={plan.serviceType || "poster"} onChange={(e) => update("serviceType", e.target.value)} className={inputCls}>
          <option value="poster">Poster Design</option>
          <option value="video">Video Editing Service</option>
          <option value="combo">Poster + Video Editing Combo</option>
        </select>
      </label>
      {plan.serviceType !== "video" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={plan.unlimitedDownloads === true || plan.Type === "Unlimited"}
            disabled={plan.Type === "Unlimited"} onChange={(e) => update("unlimitedDownloads", e.target.checked)} />
          Unlimited poster downloads
        </label>
      )}
      <p className="text-xs text-gray-500">Poster and Video Editing validity are stored separately. Video plans do not include poster downloads. Video editing tools will be connected separately.</p>
    </div>
  );
}
