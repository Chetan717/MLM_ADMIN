import { adminReadCache } from "./adminReadCache.js";
import { adminSavedChanges } from "./adminSavedChanges.js";
import { adminWorkspaceKey } from "./adminPageState.js";
let session = null;
export function setAdminSession(value) {
  if (adminWorkspaceKey(session) !== adminWorkspaceKey(value)) {
    adminReadCache.clear();
    adminSavedChanges.clear();
  }
  session = value;
}
export function getAdminSession() { return session; }
export function clearAdminSession() { session = null; adminReadCache.clear(); adminSavedChanges.clear(); }
