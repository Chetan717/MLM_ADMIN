"use strict";
const D = require("../paymentDomain");
const categories = [
  "Car Delivery Video",
  "Motivational Video",
  "Birthday Video",
  "Instagram Reel",
  "Business Promotional Video",
  "Product Promotional Video",
  "Achievement Video",
  "Event Highlights",
  "Festival Video",
  "Testimonial Video",
  "Company Introduction",
  "Other",
];
const statuses = [
  "Submitted",
  "Assigned",
  "Downloaded",
  "Editing",
  "Under Review",
  "Correction Requested",
  "Completed",
  "Cancelled",
  "Rejected",
];
const formats = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const MAX_SIZE = 150000000,
  PART = 8 * 1024 * 1024;
function check(ok, message, code = "failed-precondition") {
  if (!ok) D.fail(code, message);
}
function line(value, max, required = true) {
  check(
    typeof value === "string" &&
      value.trim().length <= max &&
      (!required || value.trim()),
    "Check the required text and length.",
    "invalid-argument",
  );
  return value.trim();
}
function drive(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    /* Invalid URLs are rejected below. */
  }
  check(
    u?.origin === "https://drive.google.com" && !u.username && !u.password,
    "Enter a Google Drive file link.",
    "invalid-argument",
  );
  const id =
    /^\/file\/d\/([\w-]{10,200})(?:\/(?:view|preview|edit))?\/?$/.exec(
      u.pathname,
    )?.[1] ||
    (["/open", "/uc"].includes(u.pathname) && u.searchParams.get("id"));
  check(
    typeof id === "string" && /^[\w-]{10,200}$/.test(id),
    "Enter a Google Drive file link.",
    "invalid-argument",
  );
  const key = u.searchParams.get("resourcekey");
  check(
    !key || /^[\w-]{1,200}$/.test(key),
    "Invalid Drive resource key.",
    "invalid-argument",
  );
  return (
    "https://drive.google.com/file/d/" +
    id +
    "/view" +
    (key ? "?resourcekey=" + key : "")
  );
}
function active(g, time) {
  return (
    g.serviceType === "video" &&
    !g.revoked &&
    g.startsAtMs <= time &&
    time < g.expiresAtMs
  );
}
function free(g) {
  return Number.isSafeInteger(g.remainingCredits)
    ? Math.max(0, g.remainingCredits - (g.reservedVideoCredits || 0))
    : 0;
}
function balance(ledger, time) {
  const terms = (ledger?.grants || []).filter((g) => active(g, time));
  const sum = (fn) => terms.reduce((n, g) => n + fn(g), 0);
  return {
    eligible: !!terms.length,
    plans: [...new Set(terms.map((g) => g.planName).filter(Boolean))],
    available: sum(free),
    reserved: (ledger?.grants || [])
      .filter((g) => g.serviceType === "video")
      .reduce((n, g) => n + (g.reservedVideoCredits || 0), 0),
    used: sum((g) => (g.creditLimit || 0) - (g.remainingCredits || 0)),
    total: sum((g) => g.creditLimit || 0),
    expiry: Math.max(0, ...terms.map((g) => g.expiresAtMs)),
  };
}
function credit(ledger, action, time, purchaseId) {
  const grants = [...(ledger?.grants || [])];
  const g =
    action === "reserve"
      ? grants
          .filter((g) => active(g, time) && free(g) > 0)
          .sort((a, b) => a.expiresAtMs - b.expiresAtMs)[0]
      : grants.find(
          (g) => g.serviceType === "video" && g.purchaseId === purchaseId,
        );
  check(
    g,
    "An active Video Editing Service or Combo plan with an available video credit is required.",
  );
  const held = g.reservedVideoCredits || 0;
  if (action !== "reserve")
    check(
      held >= 1 && g.remainingCredits >= 1,
      "Reserved credit requires reconciliation.",
    );
  if (action === "consume") check(!g.revoked, "Payment was reversed. Contact support before final approval.");
  grants[grants.indexOf(g)] = {
    ...g,
    reservedVideoCredits: held + (action === "reserve" ? 1 : -1),
    remainingCredits: g.remainingCredits - (action === "consume" ? 1 : 0),
  };
  return {
    ledger: D.entitlementSummary({ ...ledger, grants }, time),
    purchaseId: g.purchaseId,
  };
}
// Small private raw-preview asset; never accept arbitrary HTML or remote URLs.
function thumbnail(value) {
  if (value == null || value === "") return "";
  check(typeof value === "string" && value.length <= 12000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value), "Invalid video thumbnail.", "invalid-argument");
  const bytes = Buffer.from(value.split(",")[1],"base64");
  check(bytes.length >= 4 && bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217, "Invalid JPEG thumbnail.", "invalid-argument");
  return value;
}
function manifest(files) {
  check(
    Array.isArray(files) && files.length >= 1 && files.length <= 5,
    "Select one to five raw videos.",
    "invalid-argument",
  );
  return files.map((f) => {
    check(
      f &&
        Object.hasOwn(formats, f.type) &&
        Number.isSafeInteger(f.size) &&
        f.size > 0 &&
        f.size <= MAX_SIZE,
      "Each video must be MP4, MOV or WebM and at most 150 MB.",
      "invalid-argument",
    );
    return { name: line(f.name, 200), size: f.size, type: f.type };
  });
}
function transition(r, action, d, role, time) {
  const customer = role === "customer",
    manager = ["admin", "panel", "manager"].includes(role);
  const states = (...names) =>
    check(
      names.includes(r.status),
      "Request status changed. Refresh the request.",
    );
  const current = () =>
    check(
      Number.isInteger(d.version) && d.version === r.version,
      "Refresh to review the latest version.",
    );
  if (["reviewed", "approve", "correct"].includes(action)) {
    check(customer, "Customer approval is required.", "permission-denied");
    current();
    if (action === "approve" && r.status === "Completed") return {};
    states("Under Review");
    drive(r.link);
    if (action === "reviewed")
      return r.reviewedVersion === r.version
        ? {}
        : { reviewedVersion: r.version };
    check(
      r.reviewedVersion === r.version,
      "Review the latest edited video first.",
    );
    if (action === "approve") {
      check(
        d.confirmed === true && r.credit === "reserved",
        "Confirm final approval.",
      );
      return { status: "Completed", credit: "consumed", approvedAt: time };
    }
    check(
      r.rounds < r.maxRounds,
      "All free corrections have been used. Contact video editing support.",
    );
    return {
      status: "Correction Requested",
      rounds: r.rounds + 1,
      correction: line(d.note, 4000),
    };
  }
  if (action === "cancel" || action === "reject") {
    check(
      manager || (customer && action === "cancel"),
      "Unauthorized cancellation.",
      "permission-denied",
    );
    if (customer) states("Submitted");
    else
      states(
        "Submitted",
        "Assigned",
        "Downloaded",
        "Editing",
        "Under Review",
        "Correction Requested",
      );
    return {
      status: action === "cancel" ? "Cancelled" : "Rejected",
      credit: "released",
      reason: line(d.note, 1000),
    };
  }
  check(!customer, "Team access required.", "permission-denied");
  if (action === "assign") check(false, "Editor assignment is disabled.", "permission-denied");
  if (action === "downloaded") {
    states("Submitted", "Assigned");
    return { status: "Downloaded" };
  }
  if (action === "edit") {
    states("Submitted", "Assigned", "Downloaded", "Correction Requested");
    return { status: "Editing" };
  }
  if (action === "recoverLink") {
    check(role === "admin", "Master Admin required.", "permission-denied");
    states("Completed");
    check(d.confirmed === true, "Confirm recovery.");
    return { link: drive(d.link), reason: line(d.note, 1000) };
  }
  if (action === "deliver") {
    current();
    states("Editing", "Correction Requested");
    return {
      status: "Under Review",
      version: r.version + 1,
      link: drive(d.link),
      remarks: line(d.note || "", 2000, false),
      reviewedVersion: 0,
    };
  }
  if (action === "restore") {
    check(role === "admin" && r.archived && !r.deleting, "Archived request required.", "permission-denied");
    return { archived: false, restoredAt: time };
  }
  if (action === "archive") {
    check(
      role === "admin" && d.mobile === r.mobile,
      "Enter the customer's exact registered mobile number.",
      "permission-denied",
    );
    states("Completed", "Cancelled", "Rejected");
    return { archived: true, archivedAt: time };
  }
  D.fail("invalid-argument", "Unknown video request action.");
}
module.exports = {
  check,
  line,
  drive,
  balance,
  credit,
  transition,
  manifest,
  thumbnail,
  categories,
  statuses,
  formats,
  MAX_SIZE,
  PART,
};
