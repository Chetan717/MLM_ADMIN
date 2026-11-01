import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../../Firebase";
import { COLLECTIONS } from "../collections";
import { adminReadCache } from "./adminReadCache";
import { adminSavedChanges, applySavedRow } from "./adminSavedChanges.js";

const collectionKey = name => `collection:${name}`;
const companyKey = company => `templates:${COLLECTIONS.MLMTEMPLATE}:company:${company}`;
export function readAdminCollection(name, { force = false } = {}) {
  const uid = auth.currentUser?.uid;
  const revision = adminSavedChanges.revision(uid);
  return adminReadCache.get(uid, collectionKey(name), async () => {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }, { force }).then(rows => adminSavedChanges.mergeSince(uid, name, rows, revision));
}
export async function readAdminTemplates({ company, force = false } = {}) {
  if (!company) return readAdminCollection(COLLECTIONS.MLMTEMPLATE, { force });
  const uid = auth.currentUser?.uid;
  const revision = adminSavedChanges.revision(uid);
  const all = force ? undefined : adminReadCache.peek(uid, collectionKey(COLLECTIONS.MLMTEMPLATE));
  if (all) return all.filter(row => row.MainType === "MLM" && row.Company === company);
  return adminReadCache.get(uid, companyKey(company), async () => {
    const snapshot = await getDocs(query(collection(db, COLLECTIONS.MLMTEMPLATE),
      where("MainType", "==", "MLM"), where("Company", "==", company)));
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }, { force }).then(rows => adminSavedChanges.mergeSince(uid, COLLECTIONS.MLMTEMPLATE, rows, revision)
    .filter(row => row.MainType === "MLM" && row.Company === company));
}
export const readAdminCompanies = options => readAdminCollection(COLLECTIONS.MLMCOMP, options);
export const readAdminQuality = options => readAdminCollection(COLLECTIONS.TEMPLATEQUALITY, options);

export function rememberAdminRow(name, id, changes, kind) {
  adminReadCache.change(auth.currentUser?.uid, collectionKey(name), rows => applySavedRow(rows, { id, changes }));
  adminSavedChanges.remember(auth.currentUser?.uid, name, id, changes, kind);
}
export function rememberTemplateChange(id, changes, kind = "updated") {
  const uid = auth.currentUser?.uid;
  rememberAdminRow(COLLECTIONS.MLMTEMPLATE, id, changes, kind);
  // Company queries are small and may have been loaded independently of the
  // main list; invalidate both sides of moves, copies and deletes.
  adminReadCache.invalidatePrefix(uid, `templates:${COLLECTIONS.MLMTEMPLATE}:company:`);
}
export function invalidateAdminQuality() {
  adminReadCache.invalidate(auth.currentUser?.uid, collectionKey(COLLECTIONS.TEMPLATEQUALITY));
}
