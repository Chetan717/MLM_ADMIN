import { doc, getDocFromServer, runTransaction, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../../../Firebase";
import { createExpenseStore } from "./expenseStore";

export const EXPENSE_PATH = "expense/expense";
const ref = () => doc(db, "expense", "expense");
// PAN and bank details stay in memory, never localStorage / sessionStorage.
const store = createExpenseStore({
  getUid: () => auth.currentUser?.uid,
  readDocument: async () => { const snap = await getDocFromServer(ref()); return snap.exists() ? snap.data() : null; },
  transact: mutate => runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref());
    const next = mutate(snapshot.exists() ? snapshot.data() : null);
    // Reading latest state and atomically replacing it preserves unknown fields,
    // applies map deletions and keeps linked salary totals consistent.
    transaction.set(ref(), { ...next, updatedAt: serverTimestamp() });
    return next;
  }),
});
let previousUid = auth.currentUser?.uid;
onAuthStateChanged(auth, user => { if (!user || user.uid !== previousUid) store.clear(); previousUid = user?.uid; });
export const clearExpenseCache = store.clear;
export const cachedExpenses = store.cached;
export const loadExpenses = store.load;
export const saveExpenseCommand = store.save;

export function expenseError(error) {
  if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") return "Firestore access was denied. Add the expense/expense permission from EXPENSE_MANAGER_SETUP_HINDI.md to your existing rules, then refresh.";
  if (/unavailable|deadline-exceeded/.test(error?.code || "") || /offline/i.test(error?.message || "")) return "Could not reach Firestore. Check your connection and try again. Changes have not been marked as saved.";
  return error?.message || "The action could not be completed. Please try again.";
}
