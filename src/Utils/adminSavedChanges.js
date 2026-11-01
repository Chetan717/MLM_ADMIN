// Confirmed writes only. This store never reads or writes Firebase and is
// deliberately session-only: reloading/reopening clears the recent badges.
const EMPTY_RECENT = Object.freeze({});

export function applySavedRow(rows, { id, changes }) {
  if (changes === null) return rows.filter(row => row.id !== id);
  const index = rows.findIndex(row => row.id === id);
  if (index < 0) return [...rows, { ...changes, id }];
  return rows.map((row, i) => i === index ? { ...row, ...changes, id } : row);
}

export function createAdminSavedChanges() {
  const accounts = new Map();
  const account = uid => {
    const key = uid || "anonymous";
    if (!accounts.has(key)) accounts.set(key, { revision: 0, rows: new Map(), recent: EMPTY_RECENT, listeners: new Set() });
    return accounts.get(key);
  };
  const emit = (state, event) => state.listeners.forEach(listener => listener(event));
  return {
    revision: uid => account(uid).revision,
    recent: uid => account(uid).recent,
    subscribe(uid, listener) {
      const state = account(uid);
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    remember(uid, collection, id, changes, kind) {
      const state = account(uid);
      const revision = ++state.revision;
      if (!state.rows.has(collection)) state.rows.set(collection, new Map());
      const rows = state.rows.get(collection);
      const previous = rows.get(id);
      rows.set(id, { id, changes: changes === null ? null : { ...previous?.changes, ...changes }, revision });
      if (kind || changes === null) {
        const recent = { ...state.recent };
        if (changes === null) delete recent[id];
        else recent[id] = { kind: recent[id]?.kind === "added" ? "added" : kind, revision };
        state.recent = recent;
      }
      emit(state, { collection, id, changes, revision });
    },
    // A write that completed while an older request was running wins locally.
    mergeSince(uid, collection, rows, revision) {
      let result = rows;
      for (const mutation of account(uid).rows.get(collection)?.values() || []) {
        if (mutation.revision > revision) result = applySavedRow(result, mutation);
      }
      return result;
    },
    clearRecent(uid, through = Infinity) {
      const state = account(uid);
      state.recent = Object.fromEntries(Object.entries(state.recent).filter(([, value]) => value.revision > through));
      emit(state, { recentCleared: true });
    },
    clear() {
      for (const state of accounts.values()) {
        state.rows.clear();
        state.recent = EMPTY_RECENT;
        ++state.revision;
        emit(state, { reset: true });
      }
    },
  };
}

export const adminSavedChanges = createAdminSavedChanges();
