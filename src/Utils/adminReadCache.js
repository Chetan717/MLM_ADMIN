// Short, authenticated in-memory reuse. Nothing is written to localStorage.
export function createAdminReadCache({ now = Date.now, maxEntries = 16,
  ttlMs = 120000, maxRows = 10000, maxBytes = 16 * 1024 * 1024 } = {}) {
  const values = new Map(), pending = new Map();
  const keyOf = (uid, name) => uid && name ? JSON.stringify([uid, name]) : "";
  function peek(uid, name) {
    const key = keyOf(uid, name), item = values.get(key);
    if (item && item.until > now()) return item.data;
    values.delete(key);
    return undefined;
  }
  function invalidate(uid, name) { const key = keyOf(uid, name); values.delete(key); pending.delete(key); }
  function invalidatePrefix(uid, prefix) {
    for (const key of new Set([...values.keys(), ...pending.keys()])) {
      const [owner, name] = JSON.parse(key);
      if (owner === uid && name.startsWith(prefix)) { values.delete(key); pending.delete(key); }
    }
  }
  function fits(data) {
    return (!Array.isArray(data) || data.length <= maxRows) && JSON.stringify(data ?? null).length * 2 <= maxBytes;
  }
  async function get(uid, name, load, { force = false } = {}) {
    const key = keyOf(uid, name);
    if (!key) return load();
    if (force) invalidate(uid, name);
    const cached = peek(uid, name);
    if (cached !== undefined) return cached;
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(load).then(data => {
      if (pending.get(key) === promise && ttlMs > 0 && fits(data)) {
        for (const [oldKey, item] of values) if (item.until <= now()) values.delete(oldKey);
        if (values.size >= maxEntries) values.delete(values.keys().next().value);
        values.set(key, { data, until: now() + ttlMs });
      }
      return data;
    }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
    pending.set(key, promise);
    return promise;
  }
  function change(uid, name, update) {
    const key = keyOf(uid, name), current = peek(uid, name), until = values.get(key)?.until;
    pending.delete(key); // An older unfinished read cannot overwrite this edit.
    if (current === undefined) return;
    const data = update(current);
    if (fits(data)) values.set(key, { data, until }); else values.delete(key);
  }
  return { get, peek, change, invalidate, invalidatePrefix, clear: () => { values.clear(); pending.clear(); } };
}

export const adminReadCache = createAdminReadCache();
