import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis } from "@gravity-ui/icons";
import { Pagination } from "./TempHome";

import { browserTemplateStorage, moveTemplateId, orderTemplateRows, readTemplateListPreferences, writeTemplateListPreferences } from "./templateListPreferences.js";

const PAGE_SIZE = 20;
const toolButton = "px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold disabled:opacity-40 hover:bg-violet-50 dark:hover:bg-gray-800";

function RecentBadge({ change }) {
  if (!change) return null;
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold whitespace-nowrap ${change.kind === "added" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"}`}>
    {change.kind === "added" ? "Recently Added" : "Recently Updated"}
  </span>;
}

function typeBadge(mainType) {
  return mainType === "MLM"
    ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 border border-violet-100 dark:border-violet-500/20"
    : "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 border border-sky-100 dark:border-sky-500/20";
}

function Tab({ label, count, active, onClick, color }) {
  const colors = {
    violet: active
      ? "bg-violet-600 text-white shadow-sm shadow-violet-500/20"
      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
    sky: active
      ? "bg-sky-500 text-white shadow-sm shadow-sky-500/20"
      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${colors[color]}`}
    >
      {label}
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${active ? "bg-white/25" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
        {count}
      </span>
    </button>
  );
}

function TableHeader({ children, className = "" }) {
  return (
    <th className={`px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function StatusPill({ value, yes = "Active", no = "Inactive" }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
      value
        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
        : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${value ? "bg-emerald-500" : "bg-gray-400"}`} />
      {value ? yes : no}
    </span>
  );
}

function QualityStatusPills({ quality }) {
  const okCount = quality?.ok || 0;
  const issueCount = quality?.issues || 0;

  if (!okCount && !issueCount) {
    return <span className="text-gray-300 dark:text-gray-600 text-[11px]">—</span>;
  }

  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap min-w-[112px]">
      {okCount > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 text-[10px] font-bold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          OK {okCount}
        </span>
      )}
      {issueCount > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 text-[10px] font-bold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Issue {issueCount}
        </span>
      )}
    </div>
  );
}

function EmptyState({ filtered, type }) {
  return (
    <tr>
      <td colSpan={10} className="py-20 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Ellipsis className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            {filtered ? `No ${type} templates match this filter` : `No ${type} templates found`}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {filtered ? "Try a different search or filter." : "Click Add Template to create one."}
          </p>
        </div>
      </td>
    </tr>
  );
}

const SectionTable = memo(function SectionTable({ templates, onSelect, filtered, type, companiesMap, qualityStatusMap, recentChanges, view, arranging, onMove }) {
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const touchDrag = useRef(null);
  const container = useRef(null);
  const horizontal = view === "horizontal";

  const clearDrag = () => { setDragging(null); setDropTarget(null); touchDrag.current = null; };
  const moveByArrow = (id, direction) => {
    const index = templates.findIndex(row => row.id === id);
    const target = templates[index + direction];
    if (!target) return;
    onMove(id, target.id, direction < 0 ? "before" : "after");
    setPage(Math.floor((index + direction) / PAGE_SIZE) + 1);
  };
  const placementAt = (element, x, y) => {
    const rect = element.getBoundingClientRect();
    return (horizontal ? x > rect.left + rect.width / 2 : y > rect.top + rect.height / 2) ? "after" : "before";
  };
  const dragProps = tpl => ({
    "data-template-id": tpl.id,
    onDragOver: event => {
      if (!arranging || !dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(tpl.id);
    },
    onDrop: event => {
      event.preventDefault();
      const source = event.dataTransfer.getData("application/x-mlm-template");
      if (arranging && source === dragging) onMove(source, tpl.id, placementAt(event.currentTarget, event.clientX, event.clientY));
      clearDrag();
    },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); },
  });
  const controls = (tpl, index) => arranging && (
    <div className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
      <button type="button" draggable aria-label={`Drag template ${tpl.id}`} title="Drag to arrange"
        className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onDragStart={event => {
          setDragging(tpl.id);
          event.dataTransfer.setData("application/x-mlm-template", tpl.id);
          event.dataTransfer.effectAllowed = "move";
        }} onDragEnd={clearDrag}
        onPointerDown={event => {
          if (event.pointerType === "mouse") return;
          touchDrag.current = { source: tpl.id };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(tpl.id);
        }}
        onPointerMove={event => {
          if (!touchDrag.current) return;
          const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest("[data-template-id]");
          if (!target || !container.current?.contains(target)) return;
          touchDrag.current = { ...touchDrag.current, target: target.dataset.templateId,
            placement: placementAt(target, event.clientX, event.clientY) };
          setDropTarget(target.dataset.templateId);
        }}
        onPointerUp={() => {
          const drag = touchDrag.current;
          if (drag?.target) onMove(drag.source, drag.target, drag.placement);
          clearDrag();
        }} onPointerCancel={() => { if (touchDrag.current) clearDrag(); }}>⠿</button>
      <button type="button" disabled={index === 0} className={toolButton}
        aria-label={`Move template ${tpl.id} ${horizontal ? "left" : "up"}`}
        onClick={() => moveByArrow(tpl.id, -1)}>{horizontal ? "←" : "↑"}</button>
      <button type="button" disabled={index === templates.length - 1} className={toolButton}
        aria-label={`Move template ${tpl.id} ${horizontal ? "right" : "down"}`}
        onClick={() => moveByArrow(tpl.id, 1)}>{horizontal ? "→" : "↓"}</button>
    </div>
  );

  const totalPages = useMemo(() => Math.max(1, Math.ceil(templates.length / PAGE_SIZE)), [templates]);
  const currentPage = Math.min(page, totalPages);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return templates.slice(start, start + PAGE_SIZE);
  }, [templates, currentPage]);

  return (
    <div ref={container} className="space-y-3">
      {view === "table" ? <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800">
                <TableHeader>{arranging ? "Arrange" : "#"}</TableHeader>
                <TableHeader>Company Name</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader>Select Type</TableHeader>
                <TableHeader>Subtype</TableHeader>
                <TableHeader>Date</TableHeader>
                <TableHeader className="text-center">Graphics</TableHeader>
                <TableHeader className="text-center">Active</TableHeader>
                <TableHeader className="text-center">Launched</TableHeader>
                <TableHeader className="text-center">Quality Status</TableHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {paginated.length === 0 ? (
                <EmptyState filtered={filtered} type={type} />
              ) : paginated.map((tpl, i) => {
                const companyName = companiesMap?.[tpl.Company] || tpl.Company || "—";
                const quality = qualityStatusMap?.[tpl.id];
                return (
                  <tr
                    key={tpl.id}
                    {...dragProps(tpl)}
                    onClick={() => { if (!arranging) onSelect(tpl); }}
                    className={`hover:bg-violet-50/40 dark:hover:bg-violet-500/5 cursor-pointer transition-colors ${dropTarget === tpl.id ? "bg-violet-100 dark:bg-violet-900/30 outline outline-violet-400" : recentChanges[tpl.id] ? "bg-amber-50/40 dark:bg-amber-500/5" : ""}`}
                  >
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-[11px]">
                      {arranging ? controls(tpl, (currentPage - 1) * PAGE_SIZE + i) : (currentPage - 1) * PAGE_SIZE + i + 1}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap font-medium">
                      <div className="flex flex-col items-start gap-1">{companyName}<RecentBadge change={recentChanges[tpl.id]} /></div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${typeBadge(tpl.MainType)}`}>
                        {tpl.MainType || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">
                      {tpl.SelectType ? tpl.SelectType.replace(/_/g, " ") : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-[140px] truncate text-xs">
                      {tpl.Subtype || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {tpl.Date || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-bold">
                        {(tpl.GraphicsLink || []).length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill value={tpl.Active} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill value={tpl.Launched} yes="Launched" no="Draft" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <QualityStatusPills quality={quality} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div> : (
        <div className={horizontal ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" : "flex flex-col gap-3"} data-template-view={view}>
          {paginated.length === 0 && <p className="p-10 text-center text-sm text-gray-400">{filtered ? "No templates match this filter." : "No templates found."}</p>}
          {paginated.map((tpl, i) => (
            <article key={tpl.id} {...dragProps(tpl)}
              className={`p-4 rounded-2xl border bg-white dark:bg-gray-900 space-y-3 ${dropTarget === tpl.id ? "border-violet-500 outline outline-violet-300" : recentChanges[tpl.id] ? "border-amber-300 dark:border-amber-500/40" : "border-gray-200 dark:border-gray-800"}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${typeBadge(tpl.MainType)}`}>{tpl.MainType} · #{tpl.serial ?? "—"}</span>
                <RecentBadge change={recentChanges[tpl.id]} />
              </div>
              {controls(tpl, (currentPage - 1) * PAGE_SIZE + i)}
              <button type="button" className="w-full text-left space-y-2" onClick={() => onSelect(tpl)}>
                <p className="font-semibold text-sm text-gray-800 dark:text-gray-100">{companiesMap?.[tpl.Company] || tpl.Company || "General"}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{(tpl.SelectType || "Template").replaceAll("_", " ")} · {tpl.Subtype || "—"}</p>
                <p className="text-xs text-gray-400">{tpl.Date || "No date"} · {(tpl.GraphicsLink || []).length} graphics</p>
                <span className="block text-xs font-semibold text-violet-600 dark:text-violet-400">Open template →</span>
              </button>
              <div className="flex gap-2 flex-wrap"><StatusPill value={tpl.Active} /><StatusPill value={tpl.Launched} yes="Launched" no="Draft" /><QualityStatusPills quality={qualityStatusMap?.[tpl.id]} /></div>
            </article>
          ))}
        </div>
      )}
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
});

// The order is an Admin presentation preference. Template serials and public
// catalog order are not rewritten by arranging this list.
export default function TemplateTable({
  templates, allTemplates = templates, onSelect, filtered, companiesMap,
  qualityStatusMap, activeTab, onTabChange, recentChanges = {}, recentRequest = 0, storageScope,
}) {
  const [preferences, setPreferences] = useState(() => readTemplateListPreferences(browserTemplateStorage(), storageScope));
  const [arranging, setArranging] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  useEffect(() => { if (recentRequest > 0) setRecentOnly(true); }, [recentRequest]);
  const [storageOk, setStorageOk] = useState(true);
  useEffect(() => {
    setStorageOk(writeTemplateListPreferences(browserTemplateStorage(), storageScope, preferences));
  }, [preferences, storageScope]);

  const mlmTemplates = useMemo(() => templates.filter(t => t.MainType === "MLM"), [templates]);
  const generalTemplates = useMemo(() => templates.filter(t => t.MainType === "General"), [templates]);
  const ordered = useMemo(() => orderTemplateRows(activeTab === "MLM" ? mlmTemplates : generalTemplates, preferences.order[activeTab]),
    [activeTab, mlmTemplates, generalTemplates, preferences.order]);
  const recentCount = ordered.filter(row => recentChanges[row.id]).length;
  const showRecent = recentOnly && recentCount > 0;
  const shown = showRecent ? ordered.filter(row => recentChanges[row.id]) : ordered;
  const move = (source, target, placement) => {
    const ids = orderTemplateRows(allTemplates.filter(row => row.MainType === activeTab), preferences.order[activeTab]).map(row => row.id);
    const next = moveTemplateId(ids, source, target, placement);
    if (next === ids) return;
    setPreferences(previous => ({ ...previous, order: { ...previous.order, [activeTab]: next } }));
  };

  return (
    <div className="space-y-4 text-gray-600 dark:text-gray-300">
      <div className="flex flex-wrap items-center gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl w-fit">
        <Tab label="MLM Templates" count={mlmTemplates.length} active={activeTab === "MLM"} onClick={() => onTabChange("MLM")} color="violet" />
        <Tab label="General Templates" count={generalTemplates.length} active={activeTab === "General"} onClick={() => onTabChange("General")} color="sky" />
      </div>
      <div className="flex items-center gap-2 flex-wrap" aria-label="Template list tools">
        <div className="flex gap-1" role="group" aria-label="Template view">
          {[ ["table", "Table"], ["horizontal", "Horizontal"], ["vertical", "Vertical"] ].map(([view, label]) => (
            <button type="button" key={view} aria-pressed={preferences.view === view}
              className={`${toolButton} ${preferences.view === view ? "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300" : ""}`}
              onClick={() => setPreferences(previous => ({ ...previous, view }))}>{label}</button>
          ))}
        </div>
        <button type="button" className={toolButton} aria-pressed={arranging} onClick={() => setArranging(value => !value)}>{arranging ? "Done arranging" : "Arrange"}</button>
        {preferences.order[activeTab].length > 0 && <button type="button" className={toolButton} onClick={() => setPreferences(previous => ({ ...previous, order: { ...previous.order, [activeTab]: [] } }))}>Reset order</button>}
        {recentCount > 0 && <button type="button" aria-pressed={showRecent} className={`${toolButton} bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300`}
          onClick={() => setRecentOnly(value => !value)}>{showRecent ? "Show all templates" : `Recently changed (${recentCount})`}</button>}
      </div>
      {recentCount > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Recently Added / Recently Updated flags stay until Refresh or reopening the app.</p>}
      {arranging && <p className="text-xs text-violet-600 dark:text-violet-400">Drag a handle or use the arrows to move templates. Admin list order is saved in this browser.</p>}
      {!storageOk && <p role="status" className="text-xs text-amber-700">Browser storage is unavailable. This arrangement will last until you reload.</p>}
      <SectionTable key={`${activeTab}:${showRecent}`} templates={shown} onSelect={onSelect} filtered={filtered || showRecent}
        type={activeTab} companiesMap={companiesMap} qualityStatusMap={qualityStatusMap} recentChanges={recentChanges}
        view={preferences.view} arranging={arranging} onMove={move} />
    </div>
  );
}
