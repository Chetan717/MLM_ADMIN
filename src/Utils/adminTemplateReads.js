import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../../Firebase";
import { COLLECTIONS } from "../collections";
import { adminReadCache } from "./adminReadCache";
import { notifyAdminTabUpdates } from "./adminTabUpdates.js";

const collectionKey = name => `collection:${name}`;
const companyKey = company => `templates:${COLLECTIONS.MLMTEMPLATE}:company:${company}`;
export function readAdminCollection(name, { force = false } = {}) {
  return adminReadCache.get(auth.currentUser?.uid, collectionKey(name), async () => {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }, { force });
}
export async function readAdminTemplates({ company, force = false } = {}) {
  if (!company) return readAdminCollection(COLLECTIONS.MLMTEMPLATE, { force });
  const uid = auth.currentUser?.uid;
  const all = force ? undefined : adminReadCache.peek(uid, collectionKey(COLLECTIONS.MLMTEMPLATE));
  if (all) return all.filter(row => row.MainType === "MLM" && row.Company === company);
  return adminReadCache.get(uid, companyKey(company), async () => {
    const snapshot = await getDocs(query(collection(db, COLLECTIONS.MLMTEMPLATE),
      where("MainType", "==", "MLM"), where("Company", "==", company)));
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }, { force });
}
export const readAdminCompanies = options => readAdminCollection(COLLECTIONS.MLMCOMP, options);
export const readAdminQuality = options => readAdminCollection(COLLECTIONS.TEMPLATEQUALITY, options);

export function rememberAdminRow(name, id, changes) {
  adminReadCache.change(auth.currentUser?.uid, collectionKey(name), rows => {
    const previous = rows.find(row => row.id === id);
    const rest = rows.filter(row => row.id !== id);
    return changes === null ? rest : [...rest, { ...previous, ...changes, id }];
  });
  if ([COLLECTIONS.MLMTEMPLATE, COLLECTIONS.TEMPLATEQUALITY].includes(name)) notifyAdminTabUpdates('templates', 'templatedata');
}
export function rememberTemplateChange(id, changes) {
  const uid = auth.currentUser?.uid;
  rememberAdminRow(COLLECTIONS.MLMTEMPLATE, id, changes);
  // Company queries are small and may have been loaded independently of the
  // main list; invalidate both sides of moves, copies and deletes.
  adminReadCache.invalidatePrefix(uid, `templates:${COLLECTIONS.MLMTEMPLATE}:company:`);
}
export function invalidateAdminQuality() {
  adminReadCache.invalidate(auth.currentUser?.uid, collectionKey(COLLECTIONS.TEMPLATEQUALITY));
}
