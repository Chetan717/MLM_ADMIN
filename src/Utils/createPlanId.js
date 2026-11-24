let sequence = 0;

// Plan IDs are public identifiers, not authentication or payment tokens.
// randomUUID is unavailable in some browsers and HTTP development contexts.
export function createPlanId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Only for non-secret plan IDs when the browser exposes no Web Crypto API.
  sequence += 1;
  return `plan_${Date.now().toString(36)}_${sequence.toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
