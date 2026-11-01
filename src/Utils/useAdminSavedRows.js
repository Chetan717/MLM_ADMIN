import { useCallback, useEffect, useSyncExternalStore } from "react";
import { auth } from "../../Firebase";
import { adminSavedChanges, applySavedRow } from "./adminSavedChanges.js";

export function useAdminSavedRows(collection, setRows) {
  const uid = auth.currentUser?.uid;
  useEffect(() => adminSavedChanges.subscribe(uid, change => {
    if (change.collection === collection) setRows(rows => applySavedRow(rows, change));
  }), [uid, collection, setRows]);
}

export function useRecentTemplateChanges() {
  const uid = auth.currentUser?.uid;
  const subscribe = useCallback(listener => adminSavedChanges.subscribe(uid, listener), [uid]);
  const snapshot = useCallback(() => adminSavedChanges.recent(uid), [uid]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
