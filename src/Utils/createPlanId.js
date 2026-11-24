let sequence = 0;
// Public plan IDs; never used as authentication or payment signatures.
export function createPlanId(api = globalThis.crypto) {
  if (typeof api?.randomUUID === "function") return api.randomUUID();
  if (typeof api?.getRandomValues === "function") {
    const bytes = api.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  sequence++;
  return `plan_${Date.now().toString(36)}_${sequence.toString(36)}_${Math.random().toString(36).slice(2,12)}`;
}
