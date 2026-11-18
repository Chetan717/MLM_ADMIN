"use strict";

// No browser-supplied money, identity, duration or commission enters this module.
const crypto = require("node:crypto");
const DAY_MS = 86400000;
const MAX_AMOUNT_PAISE = 10000000; // INR 100,000; lower account limits still apply.
class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new PaymentError(code, message);
};
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
function text(value, max = 200) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    fail("invalid-argument", "Invalid text field.");
  return value.trim();
}
function id(value, name = "ID") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    fail("invalid-argument", `Invalid ${name}.`);
  return value;
}
function input(value, fields, maxBytes = 65536) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    fail("invalid-argument", "Unexpected request fields.");
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes)
    fail("invalid-argument", "Request is too large.");
  return value;
}
function integer(value, min, max, name) {
  if (
    typeof value === "boolean" ||
    value === null ||
    value === "" ||
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    fail("failed-precondition", `Invalid ${name}.`);
  return Number(value);
}
// Parse decimal rupees/percent without binary floating-point multiplication.
function decimal100(value, max, name) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match)
    fail(
      "failed-precondition",
      `Invalid ${name}. Use at most two decimal places.`,
    );
  const result =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 0 || result > max)
    fail("failed-precondition", `Invalid ${name}.`);
  return result;
}
const money = (value) => decimal100(value, MAX_AMOUNT_PAISE, "plan amount");
const bps = (value) => decimal100(value, 10000, "percentage");
const percentageOf = (amount, percentageBps) =>
  Math.floor((amount * percentageBps + 5000) / 10000);
function couponCode(value = "") {
  if (value === "") return "";
  if (typeof value !== "string" || !/^[A-Za-z0-9]{6}$/.test(value))
    fail("invalid-argument", "Coupon must contain six letters or numbers.");
  return value.toUpperCase();
}
function normalizePlan(raw, companyId) {
  if (!raw || typeof raw !== "object")
    fail("failed-precondition", "Invalid plan.");
  const PlanName = text(raw.PlanName, 100);
  if (!PlanName) fail("failed-precondition", "Plan name is required.");
  const PlanAmount = money(raw.PlanAmount);
  // Existing duration options include a 1,000,000-day Unlimited option.
  const Day_value = integer(raw.Day_value, 1, 1000000, "plan duration");
  const downloads = integer(
    raw.downloads === "" ? 0 : raw.downloads ?? 0,
    0,
    100000000,
    "download allowance",
  );
  const Type = text(raw.Type || "Basic", 60);
  const normalized = {
    PlanName,
    PlanAmount: PlanAmount / 100,
    amountPaise: PlanAmount,
    Duration: text(raw.Duration || "", 60),
    Day_value,
    Type,
    downloads,
    unlimitedDownloads: raw.unlimitedDownloads === true || Type === "Unlimited",
    Launch: raw.Launch === true,
    Description: text(raw.Description || "", 2000),
    image_url: text(raw.image_url || "", 2048),
  };
  if (normalized.image_url && !/^https:\/\//i.test(normalized.image_url))
    fail("failed-precondition", "Plan image must use HTTPS.");
  normalized.planId = raw.planId
    ? id(raw.planId, "plan ID")
    : `legacy_${hash(`${companyId}:${JSON.stringify(normalized)}`).slice(0, 32)}`;
  return normalized;
}
function companyPlans(company, companyId) {
  if (!Array.isArray(company.Plans) || company.Plans.length > 50)
    fail("failed-precondition", "Invalid company plans.");
  const plans = company.Plans.filter(
    (p) => p && (p.PlanName || p.PlanAmount),
  ).map((p) => normalizePlan(p, companyId));
  if (new Set(plans.map((p) => p.planId)).size !== plans.length)
    fail("failed-precondition", "Duplicate plan IDs. Contact support.");
  return plans;
}
function calculatePrice(plan, coupon = null) {
  const basePaise = money(plan.PlanAmount);
  const discountBps = coupon ? bps(coupon.user_discount) : 0;
  const discountPaise = percentageOf(basePaise, discountBps);
  const taxablePaise = basePaise - discountPaise;
  // Preserve the existing app rule: discount first, then 18% GST.
  const gstBps = 1800;
  const gstPaise = percentageOf(taxablePaise, gstBps);
  const totalPaise = taxablePaise + gstPaise;
  if (totalPaise < 100 || totalPaise > MAX_AMOUNT_PAISE)
    fail(
      "failed-precondition",
      "Payable amount must be between INR 1 and INR 100,000.",
    );
  return {
    currency: "INR",
    basePaise,
    discountBps,
    discountPaise,
    taxablePaise,
    gstBps,
    gstPaise,
    totalPaise,
  };
}
function calculateCommissions(taxablePaise, coupon, members) {
  if (!coupon) return [];
  if (!members.length || members.length > 16)
    fail("failed-precondition", "Invalid marketing hierarchy.");
  const result = [];
  const seen = new Set();
  let previousAmount = 0;
  for (let index = 0; index < members.length; index++) {
    const member = members[index];
    if (seen.has(member.id) || member.active !== true)
      fail("failed-precondition", "Marketing hierarchy is inactive or cyclic.");
    seen.add(member.id);
    const rateBps =
      index === 0
        ? bps(coupon.marketing_member_percentage)
        : bps(members[index - 1].uplineBonusPercentage ?? 10);
    const amountPaise = percentageOf(
      index === 0 ? taxablePaise : previousAmount,
      rateBps,
    );
    result.push({
      memberId: id(member.id),
      kind: index ? "upline_bonus" : "direct",
      rateBps,
      amountPaise,
    });
    previousAmount = amountPaise;
  }
  if (result.reduce((sum, row) => sum + row.amountPaise, 0) > taxablePaise)
    fail(
      "failed-precondition",
      "Marketing allocation exceeds net sale. Ask Admin to correct the percentages.",
    );
  return result;
}
function signatureValid(secret, body, signature) {
  if (
    !secret ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
function validateProviderPayment(purchase, payment, order) {
  if (
    !payment ||
    payment.id !== purchase.candidatePaymentId ||
    payment.order_id !== purchase.orderId ||
    payment.amount !== purchase.price.totalPaise ||
    payment.currency !== "INR"
  )
    fail("permission-denied", "Payment does not match this purchase.");
  if (
    !order ||
    order.id !== purchase.orderId ||
    order.amount !== purchase.price.totalPaise ||
    order.currency !== "INR" ||
    order.receipt !== purchase.id ||
    order.notes?.purchaseId !== purchase.id ||
    order.notes?.ownerHash !== hash(purchase.uid)
  )
    fail("permission-denied", "Order does not match this purchase.");
  if (
    payment.status !== "captured" ||
    payment.captured !== true ||
    order.status !== "paid" ||
    order.amount_paid !== purchase.price.totalPaise ||
    order.amount_due !== 0
  )
    return false;
  return true;
}
function nextEntitlement(previous, purchase, now) {
  const grants = (previous?.grants || []).filter(
    (grant) => grant.expiresAtMs > now - 30 * DAY_MS,
  );
  if (grants.length >= 128)
    fail(
      "resource-exhausted",
      "Subscription renewal limit reached. Contact support.",
    );
  const startsAtMs = Math.max(
    now,
    ...grants.filter((g) => !g.revoked).map((g) => g.expiresAtMs),
  );
  const expiresAtMs = startsAtMs + purchase.plan.Day_value * DAY_MS;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > 253402300799000)
    fail(
      "failed-precondition",
      "Subscription expiry is outside the supported date range.",
    );
  grants.push({
    purchaseId: purchase.id,
    startsAtMs,
    expiresAtMs,
    remainingDownloads: purchase.plan.downloads,
    unlimitedDownloads: purchase.plan.unlimitedDownloads,
    revoked: false,
  });
  return entitlementSummary(
    {
      uid: purchase.uid,
      mobileNo: purchase.mobileNo,
      companyId: purchase.companyId,
      grants,
      lastPurchaseId: purchase.id,
      lastOrderId: purchase.orderId,
    },
    now,
  );
}
function entitlementSummary(value, now) {
  const usable = (value?.grants || []).filter(
    (g) => !g.revoked && g.expiresAtMs > now,
  );
  const current = usable.find((g) => g.startsAtMs <= now);
  return {
    ...value,
    status: current ? "active" : usable.length ? "scheduled" : "expired",
    startsAtMs: current?.startsAtMs || usable[0]?.startsAtMs || 0,
    expiresAtMs: usable.length
      ? Math.max(...usable.map((g) => g.expiresAtMs))
      : 0,
    remainingDownloads: current?.remainingDownloads || 0,
    unlimitedDownloads: current?.unlimitedDownloads === true,
    currentPurchaseId: current?.purchaseId || "",
  };
}
module.exports = {
  PaymentError,
  fail,
  hash,
  text,
  id,
  input,
  integer,
  money,
  bps,
  percentageOf,
  couponCode,
  normalizePlan,
  companyPlans,
  calculatePrice,
  calculateCommissions,
  signatureValid,
  validateProviderPayment,
  nextEntitlement,
  entitlementSummary,
  DAY_MS,
};
