const VIEWS = new Set(["table", "horizontal", "vertical"]);
const keyFor = scope => `mlmlive.admin.template-list.v1:${encodeURIComponent(scope || "admin")}`;
const cleanIds = values => Array.isArray(values) ? [...new Set(values.filter(id => typeof id === "string" && id))] : [];

export function browserTemplateStorage() {
  try { return window.localStorage; } catch { return null; }
}

export function readTemplateListPreferences(storage, scope) {
  try {
    const value = JSON.parse(storage.getItem(keyFor(scope)) || "{}");
    return { view: VIEWS.has(value.view) ? value.view : "table", order: {
      MLM: cleanIds(value.order?.MLM), General: cleanIds(value.order?.General),
    } };
  } catch {
    return { view: "table", order: { MLM: [], General: [] } };
  }
}

export function writeTemplateListPreferences(storage, scope, preferences) {
  try { storage.setItem(keyFor(scope), JSON.stringify(preferences)); return true; }
  catch { return false; }
}

export function orderTemplateRows(rows, ids = []) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (positions.get(a.id) ?? ids.length) - (positions.get(b.id) ?? ids.length));
}

// Always move within the complete tab order, even when the screen is filtered
// or paginated. Hidden templates keep their relative order.
export function moveTemplateId(ids, source, target, placement = "before") {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids;
  const next = ids.filter(id => id !== source);
  const index = next.indexOf(target) + (placement === "after" ? 1 : 0);
  next.splice(index, 0, source);
  return next;
}
