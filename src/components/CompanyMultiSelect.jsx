import { useMemo, useState } from "react";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export default function CompanyMultiSelect({ companies, excludedIds, onToggle, onSelectAll, onDeselectAll, disabled }) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return companies.filter(company => tokens.every(token => `${company.name} ${company.id}`.toLocaleLowerCase().includes(token)))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [companies, search]);
  const selectedCount = companies.filter(company => !excludedIds.has(company.id)).length;
  return (
    <fieldset disabled={disabled} aria-label="Destination companies" className="space-y-3 disabled:opacity-60">
      <legend className="text-xs font-semibold mb-2">Choose destination companies · {selectedCount} of {companies.length} selected</legend>
      <input type="search" aria-label="Search destination companies" placeholder="Search companies…" value={search}
        onChange={event => setSearch(event.target.value)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800" />
      <div className="flex items-center gap-3 text-xs text-violet-600 dark:text-violet-400">
        <button type="button" onClick={onSelectAll} className="font-semibold hover:underline">Select All Companies</button>
        <button type="button" onClick={onDeselectAll} className="font-semibold hover:underline">Deselect All Companies</button>
        <span className="ml-auto text-gray-400">A–Z</span>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-gray-100 dark:border-gray-800 p-2">
        {shown.map(company => (
          <label key={company.id} className={`flex items-center gap-3 p-2 rounded-lg text-sm cursor-pointer ${!excludedIds.has(company.id) ? "bg-violet-50 dark:bg-violet-500/10" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
            <input type="checkbox" checked={!excludedIds.has(company.id)} onChange={() => onToggle(company.id)} className="accent-violet-600 w-4 h-4" />
            <span>{company.name}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="p-3 text-sm text-gray-400">No companies found.</p>}
      </div>
      <p className="text-xs text-gray-400">Only checked companies will receive copies. The source company is excluded.</p>
    </fieldset>
  );
}
