import { adminReadCache } from "./adminReadCache.js";
let session = null;
export function setAdminSession(value) {
  if (JSON.stringify([session?.uid, session?.role, session?.assigntab]) !== JSON.stringify([value?.uid, value?.role, value?.assigntab])) adminReadCache.clear();
  session = value;
}
export function getAdminSession() { return session; }
export function clearAdminSession() { session = null; adminReadCache.clear(); }
