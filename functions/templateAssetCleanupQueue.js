"use strict";

const crypto = require("node:crypto");
const { collectTemplateStoragePaths } = require("./templateStorageCleanup");
const QUEUE_COLLECTION = "_templateAssetCleanup";
const validKey = key => typeof key === "string" && key.startsWith("templates/")
  && key.split("/").every(segment => segment && segment !== "." && segment !== "..");

function createTemplateAssetCleanupQueue({ db, Timestamp, now = Date.now }) {
  async function enqueue(kind, keys, bucket) {
    const unique = [...new Set(keys)].filter(validKey);
    if (!["storage", "r2"].includes(kind) || !bucket) throw new TypeError("Invalid cleanup destination");
    for (let index = 0; index < unique.length; index += 400) {
      const batch = db.batch();
      for (const key of unique.slice(index, index + 400)) {
        const id = crypto.createHash("sha256").update(JSON.stringify([kind, bucket, key])).digest("hex");
        batch.set(db.collection(QUEUE_COLLECTION).doc(id), {
          kind, bucket, key, queuedAt: Timestamp.fromMillis(now()),
          notBefore: Timestamp.fromMillis(now() + 15 * 60 * 1000),
        }, { merge: true });
      }
      await batch.commit();
    }
    return unique.length;
  }

  async function drain({ storageBucket, r2Bucket, collectR2Keys, removeStorage, removeR2 }) {
    const pending = await db.collection(QUEUE_COLLECTION)
      .where("notBefore", "<=", Timestamp.fromMillis(now())).orderBy("notBefore").limit(1000).get();
    const result = { queued: pending.docs.length, scans: 0, deleted: 0, retained: 0, failed: 0, invalid: 0 };
    if (!pending.docs.length) return result;

    // One fresh shared-reference scan for the whole batch, including inactive
    // and unlaunched templates. Never reuse a stale reference cache for deletion.
    const snapshot = await db.collection("mlmtemplate").get();
    result.scans = 1;
    const storageReferences = new Set(), r2References = new Set();
    for (const document of snapshot.docs) {
      const data = document.data();
      for (const key of collectTemplateStoragePaths(data, storageBucket)) storageReferences.add(key);
      for (const key of collectR2Keys(data)) {
        r2References.add(key);
        // Preserve old Firebase bytes when the same key has been migrated to R2.
        storageReferences.add(key);
      }
    }
    for (let index = 0; index < pending.docs.length; index += 10) {
      await Promise.all(pending.docs.slice(index, index + 10).map(async document => {
        const task = document.data();
        if (!validKey(task.key) || !["r2", "storage"].includes(task.kind)
            || task.bucket !== (task.kind === "r2" ? r2Bucket : storageBucket)) {
          result.invalid += 1;
          return; // Keep the task for inspection; never delete in a different bucket.
        }
        try {
          const shared = (task.kind === "r2" ? r2References : storageReferences).has(task.key);
          if (shared) result.retained += 1;
          else {
            await (task.kind === "r2" ? removeR2(task.key) : removeStorage(task.key));
            result.deleted += 1;
          }
          // A newly requeued removal of the same key must not be acknowledged
          // by an older worker. A failed delete/ack remains retryable tomorrow.
          await document.ref.delete({ lastUpdateTime: document.updateTime });
        } catch (error) {
          result.failed += 1;
          console.warn("Queued template asset cleanup will retry", { kind: task.kind, code: error?.code || "unknown" });
        }
      }));
    }
    return result;
  }
  return { enqueue, drain };
}

module.exports = { createTemplateAssetCleanupQueue, QUEUE_COLLECTION };
