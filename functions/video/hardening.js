"use strict";
const { check } = require("./domain");
function validateParts(parts, max) {
  check(Array.isArray(parts) && parts.length > 0 && parts.length <= 6 && new Set(parts).size === parts.length && parts.every(n => Number.isInteger(n) && n >= 1 && n <= max), "Invalid upload part batch.", "invalid-argument");
  return parts;
}
function makeBurstLimiter(now = Date.now) {
  const buckets = new Map();
  return (uid, action) => {
    const t = now(), bucket = Math.floor(t / 60000);
    // Separate cleanup from ordinary operations so upload throttling cannot trap a draft.
    const group = action === "discard" || action === "cancel" ? "cleanup" : action === "parts" || action === "part" || action === "resume" || action === "finish" ? "media" : "other";
    const key = uid + ":" + group;
    let row = buckets.get(key);
    if (!row || row.bucket !== bucket) {
      if (buckets.size >= 10000) {
        for (const [k,v] of buckets) if (v.bucket !== bucket) buckets.delete(k);
        if (buckets.size >= 10000 && !buckets.has(key)) return false;
      }
      row = { bucket, count: 0 }; buckets.set(key, row);
    }
    return ++row.count <= (group === "media" ? 120 : group === "cleanup" ? 20 : 60);
  };
}
module.exports = {validateParts, makeBurstLimiter};
