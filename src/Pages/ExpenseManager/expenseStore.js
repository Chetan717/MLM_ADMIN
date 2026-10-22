import { canManageExpenses, normalizeExpenseDocument, applyExpenseCommand } from "./expenseModel.js";

export const CACHE_TTL = 5 * 60 * 1000;

// Small injectable boundary allows the real cache and concurrent write behavior
// to be exercised without connecting tests to the production Firebase project.
export function createExpenseStore({ getUid, readDocument, transact, clock = Date.now }) {
  let cache = null;
  let pendingRead = null;
  let generation = 0;
  let writeSequence = 0;
  const clear = () => { cache = null; pendingRead = null; generation += 1; };
  const identity = session => {
    if (!canManageExpenses(session) || !session.uid || getUid() !== session.uid) throw new Error("Expense Manager is available to the signed-in Master Admin only.");
    return session.uid;
  };
  const cached = session => !canManageExpenses(session) || cache?.uid !== session?.uid || getUid() !== session?.uid ? null : cache;
  const load = async (session, force = false) => {
    const uid = identity(session);
    if (!force && cache?.uid === uid && clock() - cache.loadedAt < CACHE_TTL) return { ...cache, fromCache: true };
    if (pendingRead?.uid === uid) return pendingRead.promise;
    const epoch = generation;
    const sequence = writeSequence;
    const promise = (async () => {
      const raw = await readDocument();
      if (generation !== epoch || getUid() !== uid) throw new Error("Your session changed. Open Expense Manager again.");
      // An older refresh must never overwrite the result of a completed save.
      if (writeSequence !== sequence && cache?.uid === uid) return { ...cache, fromCache: true };
      cache = { uid, data: normalizeExpenseDocument(raw), loadedAt: clock(), exists: raw != null };
      return { ...cache, fromCache: false };
    })();
    pendingRead = { uid, promise };
    try { return await promise; }
    finally { if (pendingRead?.promise === promise) pendingRead = null; }
  };
  const save = async (session, command) => {
    const uid = identity(session);
    const epoch = generation;
    const now = new Date(clock()).toISOString();
    const data = await transact(raw => {
      identity(session);
      if (generation !== epoch) throw new Error("Your session changed. Refresh before saving.");
      return applyExpenseCommand(raw, command, { now, actor: session.id || uid });
    });
    if (generation !== epoch || getUid() !== uid) throw new Error("Your session changed. Refresh to check whether the last save completed.");
    writeSequence += 1;
    cache = { uid, data, loadedAt: clock(), exists: true };
    return { ...cache, fromCache: false };
  };
  return { clear, cached, load, save };
}
