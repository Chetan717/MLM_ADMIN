/* global require, exports, Buffer */

const {
  onCall,
  onRequest,
  HttpsError,
} = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { defineSecret, defineString } = require("firebase-functions/params");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { promisify } = require("util");
const {
  ADMIN_OTP_RECIPIENT,
  MASKED_ADMIN_OTP_RECIPIENT,
  buildAdminOtpMessage,
} = require("./adminEmailOtp");
const { buildTaskEmailMessage } = require("./taskEmail");
const {
  getRemovedTemplateStoragePaths,
  getUnreferencedTemplateStoragePaths,
  isOnlyTemplateUrlMigration,
} = require("./templateStorageCleanup");
const {
  normalizeEmail,
  normalizeCode,
  validateMarketingMemberInput,
  validateCouponInput,
  assertWithinParentPercentage,
  buildHierarchy,
} = require("./marketingHierarchy");
const {
  createPresignedPutUrl,
  getObject: getR2Object,
  putObject: putR2Object,
  deleteObject: deleteR2Object,
  publicObjectUrl: r2PublicObjectUrl,
  keyFromPublicUrl: r2KeyFromPublicUrl,
} = require("./r2");
const { normalizeR2TemplateUrl } = require("./templateCdnUrls");
const { annotateSubtypeDates, buildPopupFeed } = require("./popupCatalog");

initializeApp();
const db = getFirestore();
const scrypt = promisify(crypto.scrypt);
const EMAIL_PASS = defineSecret("EMAIL_PASS");
const EXPO_ACCESS_TOKEN = defineSecret("EXPO_ACCESS_TOKEN");
const R2_ACCOUNT_ID = defineSecret("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = defineString("R2_BUCKET", { default: "mlmlive-media" });
const R2_PUBLIC_BASE_URL = defineString("R2_PUBLIC_BASE_URL", {
  default: "https://cdn.mlmposter.com",
});
const R2_PROFILE_BUCKET = defineString("R2_PROFILE_BUCKET", {
  default: "mlmlive-storage-private",
});
const R2_PROFILE_PUBLIC_BASE_URL = defineString("R2_PROFILE_PUBLIC_BASE_URL", {
  default: "https://profile.mlmposter.com",
});
const EMAIL_NODEMAILER = defineString("EMAIL_NODEMAILER", {
  default: "soilbooster717@gmail.com",
});
const REGION = "asia-south1";
const USER_ACTIVITY_REGION = "us-central1";
const TEMPLATE_STORAGE_CLEANUP_REGION = "us-central1";
const SESSION_MS = 10 * 60 * 60 * 1000;
const OTP_MS = 5 * 60 * 1000;
const OWNER_TABS = [
  "dashboard",
  "companies",
  "templates",
  "templates_operation",
  "templates_quality",
  "Graphics",
  "marketing",
  "removebg",
  "userdashboard",
  "leads",
  "adminmanagement",
  "templatedata",
  "taskmanagement",
  "security",
  "notifications",
  "templates_delete"
];
const EXPO_PROJECT_ID = "555505c6-41df-486d-b225-4d9832044425";
const APP_ORIGIN = "https://app.mlmlive.in";
const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";

const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
const safeTabs = (tabs) =>
  Array.isArray(tabs)
    ? [...new Set(tabs.filter((x) => OWNER_TABS.includes(x)))].slice(0, 20)
    : [];
const cleanText = (value, max = 120) =>
  String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
const mobile10 = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};
const authenticatedMobile = (request) => {
  const uidMatch = String(request.auth?.uid || "").match(/^mobile_(\d{10})$/);
  const candidates = [
    request.auth?.token?.mobileNo,
    request.auth?.token?.mobile,
    request.auth?.token?.phone_number,
    uidMatch?.[1],
  ];
  for (const candidate of candidates) {
    const mobile = mobile10(candidate);
    if (mobile) return mobile;
  }
  return "";
};
const ipOf = (request) =>
  String(
    request.rawRequest?.headers?.["x-forwarded-for"] ||
      request.rawRequest?.ip ||
      "Unavailable",
  )
    .split(",")[0]
    .trim();
const locationOf = (request) => {
  const h = request.rawRequest?.headers || {};
  return (
    [h["x-appengine-city"], h["x-appengine-region"], h["x-appengine-country"]]
      .filter(Boolean)
      .map((x) => cleanText(x, 60))
      .join(", ") || "Location unavailable"
  );
};
const deviceOf = (request) => ({
  label: cleanText(request.data?.device?.label || "Unknown device", 100),
  browser: cleanText(request.data?.device?.browser || "Unknown browser", 60),
  os: cleanText(request.data?.device?.os || "Unknown OS", 60),
  language: cleanText(request.data?.device?.language || "", 20),
  timezone: cleanText(request.data?.device?.timezone || "", 60),
  userAgent: cleanText(request.rawRequest?.headers?.["user-agent"] || "", 300),
});
const validExpoPushToken = (token) =>
  /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
const safeAppUrl = (value) => {
  try {
    const url = new URL(String(value || "/"), `${APP_ORIGIN}/`);
    return url.protocol === "https:" && url.origin === APP_ORIGIN
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

async function requireMasterAdmin(
  request,
  message = "Only Master Admin can perform this action.",
) {
  const session = await requireSession(request);
  if (
    request.auth?.token?.actorType !== "owner" ||
    request.auth?.token?.role !== "Master Admin"
  )
    throw new HttpsError("permission-denied", message);
  return session;
}

async function requireAssignedAdminTab(request, tab, message) {
  const session = await requireSession(request);
  const owner = request.auth?.token?.actorType === "owner" && request.auth?.token?.role === "Master Admin";
  const assigned = Array.isArray(request.auth?.token?.tabs) && request.auth.token.tabs.includes(tab);
  if (!owner && !assigned) throw new HttpsError("permission-denied", message);
  return session;
}

async function requireMarketingAdmin(request) {
  const session = await requireSession(request);
  const isMaster =
    request.auth?.token?.actorType === "owner" &&
    request.auth?.token?.role === "Master Admin";
  const hasMarketingTab =
    Array.isArray(request.auth?.token?.tabs) &&
    request.auth.token.tabs.includes("marketing");
  if (!isMaster && !hasMarketingTab) {
    throw new HttpsError(
      "permission-denied",
      "Marketing management access is required.",
    );
  }
  return session;
}

async function sendExpoMessages(messages) {
  const accessToken = EXPO_ACCESS_TOKEN.value();
  if (!accessToken)
    throw new HttpsError(
      "failed-precondition",
      "Expo push service is not configured.",
    );
  const tickets = [];
  for (let index = 0; index < messages.length; index += 100) {
    const response = await fetch(EXPO_SEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(messages.slice(index, index + 100)),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("push request failed", {
        status: response.status,
        errors: result.errors || [],
      });
      throw new HttpsError(
        "unavailable",
        "Notification service is temporarily unavailable.",
      );
    }
    tickets.push(
      ...(Array.isArray(result.data) ? result.data : [result.data]).filter(
        Boolean,
      ),
    );
  }
  return tickets;
}

function strongPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
function passwordError() {
  return new HttpsError(
    "invalid-argument",
    "Password must be 8–12 characters with uppercase, lowercase, number and special character.",
  );
}
async function rateLimit(bucket, key, max, windowMs) {
  const ref = db.collection("_panelLoginLimits").doc(hash(`${bucket}:${key}`));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref),
      now = Date.now(),
      data = snap.exists ? snap.data() : {};
    const same = now - Number(data.windowStart || 0) < windowMs;
    const count = same ? Number(data.count || 0) : 0;
    if (count >= max)
      throw new HttpsError(
        "resource-exhausted",
        "Too many attempts. Try again later.",
      );
    tx.set(ref, {
      bucket,
      count: count + 1,
      windowStart: same ? data.windowStart : now,
      expiresAt: Timestamp.fromMillis(now + windowMs),
    });
  });
}
async function ownerForEmailLogin() {
  const snap = await db
    .collection("adminuser")
    .where("role", "==", "Master Admin")
    .limit(10)
    .get();
  const owners = snap.docs.filter((d) => d.data().active === true);
  if (owners.length !== 1) {
    throw new HttpsError(
      "failed-precondition",
      "Exactly one active Master Admin is required.",
    );
  }
  return owners[0];
}
async function ownerForId(ownerId) {
  const owner = await db
    .collection("adminuser")
    .doc(String(ownerId || ""))
    .get();
  if (
    !owner.exists ||
    owner.data().active !== true ||
    owner.data().role !== "Master Admin"
  ) {
    throw new HttpsError("permission-denied", "Not authorised.");
  }
  return owner;
}
async function actorsFor(owner) {
  const subs = await db
    .collection("adminuser")
    .where("ownerAdminId", "==", owner.id)
    .where("active", "==", true)
    .get();
  const actors = [
    {
      id: owner.id,
      name: owner.data().name || "Master Admin",
      role: "Master Admin",
      actorType: "owner",
    },
    ...subs.docs
      .filter((d) => d.id !== owner.id)
      .map((d) => ({
        id: d.id,
        name: d.data().name || "Admin",
        role: d.data().role || "Admin",
        actorType: "subuser",
      })),
  ];
  const creds = await Promise.all(
    actors.map((a) =>
      db
        .collection("_panelCredentials")
        .doc(hash(`admin:${owner.id}:${a.id}`))
        .get(),
    ),
  );
  return actors.map((a, i) => ({ ...a, passwordConfigured: creds[i].exists }));
}
async function actorFor(owner, actorId) {
  if (actorId === owner.id)
    return { id: owner.id, ...owner.data(), actorType: "owner" };
  const snap = await db.collection("adminuser").doc(actorId).get();
  if (
    !snap.exists ||
    snap.data().active !== true ||
    snap.data().ownerAdminId !== owner.id
  )
    throw new HttpsError("permission-denied", "Actor not authorised.");
  return { id: snap.id, ...snap.data(), actorType: "subuser" };
}
async function sendEmailOtp(otp) {
  const sender = String(EMAIL_NODEMAILER.value() || "").trim();
  const password = EMAIL_PASS.value();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) || !password) {
    throw new HttpsError(
      "failed-precondition",
      "Email OTP service is not configured.",
    );
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: sender, pass: password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await transporter.sendMail(buildAdminOtpMessage(sender, otp));
  } catch (error) {
    console.error("Admin email OTP delivery failed", {
      code: error?.code || "unknown",
    });
    throw new HttpsError(
      "unavailable",
      "Email OTP could not be sent right now.",
    );
  }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function taskRecipientsForRole(role) {
  if (role === "Master Admin") {
    const master = await db
      .collection("adminuser")
      .where("role", "==", "Master Admin")
      .where("active", "==", true)
      .limit(5)
      .get();
    const emails = master.docs
      .map((document) => document.data().email)
      .filter(validEmail);
    return emails.length ? emails : [ADMIN_OTP_RECIPIENT];
  }
  const roles =
    role === "Developer" ? ["Developer", "Devloper"] : [String(role || "")];
  const snapshots = await Promise.all(
    roles.map((roleName) =>
      db
        .collection("adminuser")
        .where("role", "==", roleName)
        .where("active", "==", true)
        .limit(50)
        .get(),
    ),
  );
  return snapshots
    .flatMap((snapshot) =>
      snapshot.docs
        .filter(
          (document) =>
            Array.isArray(document.data().assigntab) &&
            document.data().assigntab.includes("taskmanagement"),
        )
        .map((document) => document.data().email),
    )
    .filter(validEmail);
}

async function sendTaskEmail(task, eventType, includeMaster = false) {
  const sender = String(EMAIL_NODEMAILER.value() || "").trim();
  const password = EMAIL_PASS.value();
  if (!validEmail(sender) || !password) {
    console.error("Task email skipped: mail service is not configured.");
    return;
  }
  const assigned = await taskRecipientsForRole(task.assignedRole);
  let recipients = [...assigned];
  if (includeMaster)
    recipients.push(...(await taskRecipientsForRole("Master Admin")));
  recipients = [...new Set(recipients)];
  const message = buildTaskEmailMessage({
    sender,
    recipients,
    task,
    eventType,
  });
  if (!message) {
    console.warn(
      "Task email skipped: assigned Admin role has no notification email.",
      { role: task.assignedRole || "" },
    );
    return;
  }
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: sender, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  await transporter.sendMail(message);
}

async function createEmailChallenge(ownerId) {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const salt = crypto.randomBytes(16).toString("hex");
  const id = crypto.randomBytes(24).toString("hex");
  const ref = db.collection("_panelOtpChallenges").doc(id);
  await ref.set({
    panel: "admin",
    delivery: "email",
    ownerId,
    recipientHash: hash(ADMIN_OTP_RECIPIENT),
    salt,
    otpHash: hash(`${salt}:${otp}`),
    attempts: 0,
    verified: false,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + OTP_MS),
  });
  try {
    await sendEmailOtp(otp);
  } catch (error) {
    await ref.delete().catch(() => null);
    throw error;
  }
  return id;
}
async function verifyChallenge(id, otp) {
  const ref = db.collection("_panelOtpChallenges").doc(id),
    snap = await ref.get();
  if (!snap.exists)
    throw new HttpsError("unauthenticated", "OTP session expired.");
  const data = snap.data();
  if (
    data.panel !== "admin" ||
    data.delivery !== "email" ||
    data.used ||
    data.expiresAt.toMillis() < Date.now()
  ) {
    await ref.delete();
    throw new HttpsError("unauthenticated", "OTP session expired.");
  }
  if (Number(data.attempts || 0) >= 5) {
    await ref.delete();
    throw new HttpsError("resource-exhausted", "Too many incorrect attempts.");
  }
  if (hash(`${data.salt}:${otp}`) !== data.otpHash) {
    await ref.update({ attempts: FieldValue.increment(1) });
    throw new HttpsError("unauthenticated", "Incorrect OTP.");
  }
  const ticket = crypto.randomBytes(32).toString("hex");
  await ref.update({
    verified: true,
    ticketHash: hash(ticket),
    ticketExpiresAt: Timestamp.fromMillis(Date.now() + OTP_MS),
    otpHash: FieldValue.delete(),
    salt: FieldValue.delete(),
  });
  return { ...data, ticket };
}
async function readTicket(id, ticket) {
  const ref = db.collection("_panelOtpChallenges").doc(id),
    snap = await ref.get();
  if (!snap.exists)
    throw new HttpsError("unauthenticated", "Login session expired.");
  const data = snap.data();
  if (
    data.panel !== "admin" ||
    data.delivery !== "email" ||
    !data.verified ||
    data.used ||
    data.ticketExpiresAt.toMillis() < Date.now() ||
    data.ticketHash !== hash(ticket)
  )
    throw new HttpsError("unauthenticated", "Login session expired.");
  return { ref, data };
}
async function passwordHash(password, salt) {
  return (await scrypt(password, salt, 64)).toString("hex");
}
async function verifyOrCreatePassword(ownerId, actorId, password, allowCreate) {
  if (!strongPassword(password)) throw passwordError();
  const ref = db
      .collection("_panelCredentials")
      .doc(hash(`admin:${ownerId}:${actorId}`)),
    snap = await ref.get();
  if (!snap.exists) {
    if (!allowCreate)
      throw new HttpsError(
        "failed-precondition",
        "Set password using OTP login first.",
      );
    const salt = crypto.randomBytes(24).toString("hex");
    await ref.create({
      panel: "admin",
      ownerId,
      actorId,
      salt,
      passwordHash: await passwordHash(password, salt),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }
  const data = snap.data(),
    actual = await passwordHash(password, data.salt);
  const a = Buffer.from(actual, "hex"),
    b = Buffer.from(String(data.passwordHash || ""), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new HttpsError("unauthenticated", "Incorrect password.");
}
function sessionPublic(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    actorId: d.actorId,
    actorName: d.actorName,
    actorType: d.actorType,
    ip: d.ip,
    location: d.location,
    device: d.device,
    createdAt: d.createdAt?.toMillis?.() || null,
    lastSeenAt: d.lastSeenAt?.toMillis?.() || null,
    expiresAt: d.expiresAt?.toMillis?.() || null,
    revoked: d.revoked === true,
  };
}
async function requireSession(request) {
  if (request.auth?.token?.panel !== "admin")
    throw new HttpsError("unauthenticated", "Sign in required.");
  const ref = db.collection("_panelSessions").doc(request.auth.uid),
    snap = await ref.get();
  if (
    !snap.exists ||
    snap.data().panel !== "admin" ||
    snap.data().revoked === true ||
    snap.data().expiresAt.toMillis() <= Date.now()
  )
    throw new HttpsError("unauthenticated", "Session expired.");
  return { ref, data: snap.data() };
}

// ── Cloudflare R2 + template CDN catalog -----------------------------------
const TEMPLATE_CATALOG_SCHEMA = 1;
const TEMPLATE_HOME_LIMIT = 30;
// Every General template type is CDN-backed. The previous rollout only kept
// Latest_update/Domestic_Trip in the Home General catalog, which meant edits to
// Product/Motivational/Income/etc. could publish successfully but the app still
// rendered its bundled copy. Home General now mirrors every visible General type.
// The web app only needs an individual template JSON as a CDN fallback for
// Festival editor selections. Writing one detail object for every template on
// the first Sync CDN made large catalogs take several minutes and could hit the
// callable deadline. Normal Firestore writes still publish the changed
// template detail incrementally after bootstrap.
const TEMPLATE_BOOTSTRAP_DETAIL_TYPES = new Set(["Festival"]);
const R2_FUNCTION_SECRETS = [R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY];

function r2Config() {
  return {
    accountId: String(R2_ACCOUNT_ID.value() || "").trim(),
    accessKeyId: String(R2_ACCESS_KEY_ID.value() || "").trim(),
    secretAccessKey: String(R2_SECRET_ACCESS_KEY.value() || "").trim(),
    bucket: String(R2_BUCKET.value() || "mlmlive-media").trim(),
    publicBaseUrl: String(R2_PUBLIC_BASE_URL.value() || "https://cdn.mlmposter.com").replace(/\/+$/, ""),
    legacyPublicBaseUrls: ["https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev"],
  };
}

function profileR2Config() {
  return {
    accountId: String(R2_ACCOUNT_ID.value() || "").trim(),
    accessKeyId: String(R2_ACCESS_KEY_ID.value() || "").trim(),
    secretAccessKey: String(R2_SECRET_ACCESS_KEY.value() || "").trim(),
    bucket: String(R2_PROFILE_BUCKET.value() || "mlmlive-storage-private").trim(),
    publicBaseUrl: String(
      R2_PROFILE_PUBLIC_BASE_URL.value() ||
        "https://profile.mlmposter.com",
    ).replace(/\/+$/, ""),
    legacyPublicBaseUrls: ["https://pub-a9fc3713abb3442ba09ff324db4e136f.r2.dev"],
  };
}

function firebaseStorageObjectPath(value) {
  try {
    const parsed = new URL(String(value || ""));
    const marker = "/o/";
    const index = parsed.pathname.indexOf(marker);
    if (index >= 0) {
      return decodeURIComponent(parsed.pathname.slice(index + marker.length));
    }
    // Handle direct storage.googleapis.com/<bucket>/<object> URLs too.
    if (parsed.hostname === "storage.googleapis.com") {
      const parts = parsed.pathname.replace(/^\/+/, "").split("/");
      if (parts.length >= 2) return decodeURIComponent(parts.slice(1).join("/"));
    }
  } catch {}
  return "";
}

function profileObjectPathFromAnyUrl(value) {
  const r2Key = r2KeyFromPublicUrl(profileR2Config(), value);
  if (r2Key) return r2Key;
  return firebaseStorageObjectPath(value);
}

async function canDeleteLegacyProfileKey(request, key) {
  const mobile = authenticatedMobile(request);
  if (!mobile || !key.startsWith("mlmprofiles/")) return false;
  const snapshot = await db.collection("mlmprofiles").where("mobile", "==", mobile).get();
  for (const profileDoc of snapshot.docs) {
    const data = profileDoc.data() || {};
    const urls = [
      ...(Array.isArray(data.profileImageURLs) ? data.profileImageURLs : []),
      ...(Array.isArray(data.topuplineURLs) ? data.topuplineURLs : []),
      data.profileImageURL,
    ].filter(Boolean);
    if (urls.some((url) => profileObjectPathFromAnyUrl(url) === key)) return true;
  }
  return false;
}

const TEMPLATE_CATALOG_LOCK_REF = db.collection("_systemLocks").doc("templateCatalogR2");
const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireTemplateCatalogLock(owner, { leaseMs = 120000, maxWaitMs = 240000, lockRef = TEMPLATE_CATALOG_LOCK_REF } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    let acquired = false;
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(lockRef);
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const leaseUntil = Number(data.leaseUntil?.toMillis?.() || 0);
      if (!snapshot.exists || leaseUntil <= now || data.owner === owner) {
        transaction.set(
          lockRef,
          {
            owner,
            leaseUntil: Timestamp.fromMillis(now + leaseMs),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        acquired = true;
      }
    });
    if (acquired) return;
    attempt += 1;
    await delayMs(Math.min(2000, 250 + attempt * 150));
  }
  throw new Error("Timed out waiting for the template CDN publish lock.");
}

async function releaseTemplateCatalogLock(owner, lockRef = TEMPLATE_CATALOG_LOCK_REF) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    if (snapshot.exists && snapshot.data()?.owner === owner) {
      transaction.delete(lockRef);
    }
  }).catch((error) => {
    console.warn("Template CDN publish lock release failed", error?.message || error);
  });
}

async function withTemplateCatalogLock(work, options = {}) {
  const owner = `${Date.now()}_${crypto.randomUUID?.() || crypto.randomBytes(12).toString("hex")}`;
  await acquireTemplateCatalogLock(owner, options);
  try {
    return await work();
  } finally {
    await releaseTemplateCatalogLock(owner, options.lockRef);
  }
}

function catalogSegment(value) {
  const clean = String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_");
  return (clean || "_").slice(0, 140);
}
const catalogKey = {
  version: () => "catalog/v1/version.json",
  general: (type) => `catalog/v1/general/${catalogSegment(type)}.json`,
  mlm: (company, type) => `catalog/v1/mlm/${catalogSegment(company)}/${catalogSegment(type)}.json`,
  festival: (date) => `catalog/v1/festival/${catalogSegment(date)}.json`,
  trendingGeneral: (date) => `catalog/v1/trending/general/${catalogSegment(date)}.json`,
  homeGeneral: () => "catalog/v1/home/general.json",
  generalMaster: () => "catalog/v1/genaral_template_firestore_data.json",
  homeCompany: (company) => `catalog/v1/home/company/${catalogSegment(company)}.json`,
  template: (id) => `catalog/v1/template/${catalogSegment(id)}.json`,
};

function jsonSafe(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    // Only known old R2 template assets are rewritten into the CDN catalog;
    // existing Firestore and Firebase Storage URLs are not mutated.
    if (value.startsWith("https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev/templates/")) {
      return normalizeR2TemplateUrl(value, R2_PUBLIC_BASE_URL.value() || "https://cdn.mlmposter.com");
    }
    return value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe).filter((item) => item !== undefined);
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const safe = jsonSafe(child);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  }
  return String(value);
}

function serializeTemplate(id, data) {
  return { id: String(id), ...jsonSafe(data || {}) };
}
function isVisibleTemplate(data) {
  return data?.Active === true && data?.Launched === true;
}
function sortTemplates(items) {
  return [...items].sort((a, b) => {
    const diff = Number(a?.serial || 0) - Number(b?.serial || 0);
    return diff || String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
function catalogPayload(items, extra = {}, previousSubtypeDates = {}) {
  return {
    schema: TEMPLATE_CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    ...extra,
    ...annotateSubtypeDates(sortTemplates(items), previousSubtypeDates),
  };
}
function homeSubtypeDates(items) {
  const byType = {};
  for (const row of items) {
    const type = String(row.SelectType || row.type || "");
    if (!byType[type]) byType[type] = [];
    byType[type].push(row);
  }
  return Object.fromEntries(Object.entries(byType).map(([type, rows]) => [type, annotateSubtypeDates(rows).subtypeDates]));
}
async function putCatalogJson(key, payload, cacheControl = "public,max-age=300,stale-while-revalidate=86400") {
  await putR2Object(
    r2Config(),
    key,
    Buffer.from(JSON.stringify(payload)),
    { contentType: "application/json; charset=utf-8", cacheControl },
  );
}
async function deleteCatalogObject(key) {
  await deleteR2Object(r2Config(), key).catch((error) => {
    // R2 returns 404 for an already-missing key. Keep retry-safe behaviour.
    if (!String(error?.message || "").includes(" 404 ")) throw error;
  });
}
async function readCatalogJson(key) {
  try {
    const response = await getR2Object(r2Config(), key);
    return await response.json();
  } catch (error) {
    if (String(error?.message || "").includes(" 404 ")) return null;
    throw error;
  }
}
async function writeCatalogVersion(reason = "template-write") {
  const version = `${Date.now()}`;
  await putCatalogJson(
    catalogKey.version(),
    { schema: TEMPLATE_CATALOG_SCHEMA, version, reason, generatedAt: new Date().toISOString() },
    "no-store",
  );
  return version;
}

async function templateQuery(filters = {}) {
  let queryRef = db.collection("mlmtemplate");
  if (filters.mainType) queryRef = queryRef.where("MainType", "==", filters.mainType);
  if (filters.type) queryRef = queryRef.where("SelectType", "==", filters.type);
  if (filters.company) queryRef = queryRef.where("Company", "==", filters.company);
  if (filters.date) queryRef = queryRef.where("Date", "==", filters.date);
  queryRef = queryRef.where("Active", "==", true).where("Launched", "==", true);
  const snapshot = await queryRef.get();
  return sortTemplates(snapshot.docs.map((document) => serializeTemplate(document.id, document.data())));
}

async function rebuildGeneralType(type) {
  if (!type) return;
  const items = await templateQuery({ mainType: "General", type });
  await putCatalogJson(catalogKey.general(type), catalogPayload(items, { mainType: "General", type }));
}
async function rebuildMlmType(company, type) {
  if (!company || !type) return;
  const items = await templateQuery({ mainType: "MLM", company, type });
  await putCatalogJson(catalogKey.mlm(company, type), catalogPayload(items, { mainType: "MLM", company, type }));
}
async function rebuildFestivalDate(date) {
  if (!date) return;
  const items = await templateQuery({ mainType: "General", type: "Festival", date });
  await putCatalogJson(catalogKey.festival(date), catalogPayload(items, { type: "Festival", date }));
}
async function rebuildTrendingGeneralDate(date) {
  if (!date) return;
  const items = await templateQuery({ mainType: "General", type: "Trending", date });
  await putCatalogJson(catalogKey.trendingGeneral(date), catalogPayload(items, { type: "Trending", date }));
}
async function rebuildHomeGeneral() {
  const items = annotateSubtypeDates(await templateQuery({ mainType: "General" })).items;
  const types = {};
  const counts = {};
  for (const item of items) {
    const type = String(item.SelectType || "").trim();
    if (!type) continue;
    counts[type] = (counts[type] || 0) + 1;
    if (!types[type]) types[type] = [];
    if (types[type].length < TEMPLATE_HOME_LIMIT) types[type].push(item);
  }
  await putCatalogJson(catalogKey.homeGeneral(), {
    schema: TEMPLATE_CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    limit: TEMPLATE_HOME_LIMIT,
    counts,
    types,
    subtypeDates: homeSubtypeDates(items),
  });
}
async function rebuildHomeCompany(company) {
  if (!company) return;
  const items = annotateSubtypeDates(await templateQuery({ mainType: "MLM", company })).items;
  const grouped = {};
  const counts = {};
  for (const item of items) {
    const type = String(item.SelectType || "").trim();
    if (!type) continue;
    counts[type] = (counts[type] || 0) + 1;
    if (!grouped[type]) grouped[type] = [];
    if (grouped[type].length < TEMPLATE_HOME_LIMIT) grouped[type].push(item);
  }
  await putCatalogJson(catalogKey.homeCompany(company), {
    schema: TEMPLATE_CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    company,
    limit: TEMPLATE_HOME_LIMIT,
    counts,
    types: grouped,
    subtypeDates: homeSubtypeDates(items),
  });
}
async function writeTemplateDetail(templateId, data) {
  if (!templateId) return;
  if (!data || !isVisibleTemplate(data)) {
    await deleteCatalogObject(catalogKey.template(templateId));
    return;
  }
  await putCatalogJson(
    catalogKey.template(templateId),
    { schema: TEMPLATE_CATALOG_SCHEMA, generatedAt: new Date().toISOString(), template: serializeTemplate(templateId, data) },
  );
}

function collectR2TemplateKeys(value, templateId, keys = new Set()) {
  if (typeof value === "string") {
    const key = r2KeyFromPublicUrl(r2Config(), value);
    if (key && key.startsWith(`templates/${templateId}/`)) keys.add(key);
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectR2TemplateKeys(item, templateId, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectR2TemplateKeys(child, templateId, keys);
  }
  return keys;
}

function collectAnyR2TemplateKeys(value, keys = new Set()) {
  if (typeof value === "string") {
    const key = r2KeyFromPublicUrl(r2Config(), value);
    if (key && key.startsWith("templates/")) keys.add(key);
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAnyR2TemplateKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectAnyR2TemplateKeys(child, keys);
  }
  return keys;
}

async function cleanupRemovedR2TemplateAssets(templateId, beforeData, afterData) {
  const beforeKeys = collectR2TemplateKeys(beforeData, templateId);
  const afterKeys = collectR2TemplateKeys(afterData, templateId);
  const removedCandidates = [...beforeKeys].filter((key) => !afterKeys.has(key));
  if (!removedCandidates.length) return 0;

  // Template copy operations can intentionally reuse the source template's
  // CDN URLs. Before deleting a replaced/deleted object, make sure no other
  // Firestore template still references it. This collection scan only happens
  // on rare media replacement/deletion writes, never on normal user reads or
  // normal Admin metadata edits.
  const snapshot = await db.collection("mlmtemplate").get();
  const referencedKeys = new Set();
  for (const document of snapshot.docs) {
    collectAnyR2TemplateKeys(document.data() || {}, referencedKeys);
  }

  const removed = removedCandidates.filter((key) => !referencedKeys.has(key));
  await Promise.all(removed.map((key) => deleteR2Object(r2Config(), key).catch((error) => {
    if (!String(error?.message || "").includes(" 404 ")) throw error;
  })));
  return removed.length;
}

async function requireTemplateAdmin(request) {
  const session = await requireSession(request);
  const isMaster = request.auth?.token?.actorType === "owner" && request.auth?.token?.role === "Master Admin";
  const tabs = Array.isArray(request.auth?.token?.tabs) ? request.auth.token.tabs : [];
  if (!isMaster && !tabs.some((tab) => ["templates", "templates_operation"].includes(tab))) {
    throw new HttpsError("permission-denied", "Template operation access is required.");
  }
  return session;
}

function templateBucketDescriptor(data) {
  if (!data) return null;
  return {
    mainType: String(data.MainType || "").trim(),
    type: String(data.SelectType || "").trim(),
    company: String(data.Company || "").trim(),
    date: String(data.Date || "").trim(),
  };
}
function descriptorKey(descriptor) {
  if (!descriptor) return "";
  return [descriptor.mainType, descriptor.company, descriptor.type, descriptor.date].join("|");
}

function incrementalBucketDescriptors(data) {
  const descriptor = templateBucketDescriptor(data);
  if (!descriptor?.type) return [];
  const list = [];
  if (descriptor.mainType === "General") {
    list.push({ kind: "general", ...descriptor, key: catalogKey.general(descriptor.type) });
    if (descriptor.type === "Festival" && descriptor.date) {
      list.push({ kind: "festival", ...descriptor, key: catalogKey.festival(descriptor.date) });
    }
    if (descriptor.type === "Trending" && descriptor.date) {
      list.push({ kind: "trendingGeneral", ...descriptor, key: catalogKey.trendingGeneral(descriptor.date) });
    }
  } else if (descriptor.mainType === "MLM" && descriptor.company) {
    list.push({ kind: "mlm", ...descriptor, key: catalogKey.mlm(descriptor.company, descriptor.type) });
  }
  return list;
}

function descriptorMatches(data, descriptor) {
  if (!data || !isVisibleTemplate(data)) return false;
  if (String(data.MainType || "").trim() !== descriptor.mainType) return false;
  if (String(data.SelectType || "").trim() !== descriptor.type) return false;
  if (descriptor.company && String(data.Company || "").trim() !== descriptor.company) return false;
  if (descriptor.date && String(data.Date || "").trim() !== descriptor.date) return false;
  return true;
}

async function canonicalItemsForDescriptor(descriptor) {
  if (descriptor.kind === "general") {
    return templateQuery({ mainType: "General", type: descriptor.type });
  }
  if (descriptor.kind === "mlm") {
    return templateQuery({ mainType: "MLM", company: descriptor.company, type: descriptor.type });
  }
  if (descriptor.kind === "festival") {
    return templateQuery({ mainType: "General", type: "Festival", date: descriptor.date });
  }
  if (descriptor.kind === "trendingGeneral") {
    return templateQuery({ mainType: "General", type: "Trending", date: descriptor.date });
  }
  return [];
}

async function updateIncrementalBucket(descriptor, templateId, afterData) {
  const existing = await readCatalogJson(descriptor.key);
  let items;
  if (!existing || !Array.isArray(existing.items)) {
    // This happens only for a brand-new bucket (or before first full sync).
    // Query Firestore once to seed it correctly; future writes are R2-only.
    items = await canonicalItemsForDescriptor(descriptor);
  } else {
    items = existing.items.filter((item) => String(item?.id || "") !== String(templateId));
    if (descriptorMatches(afterData, descriptor)) {
      items.push(serializeTemplate(templateId, afterData));
    }
    items = sortTemplates(items);
  }

  const extra = { mainType: descriptor.mainType, type: descriptor.type };
  if (descriptor.company) extra.company = descriptor.company;
  if (descriptor.date) extra.date = descriptor.date;
  const payload = catalogPayload(items, extra, existing?.subtypeDates || {});
  await putCatalogJson(descriptor.key, payload);
  return payload.items;
}

async function updateHomeGeneralFromType(type, items) {
  if (!type) return;
  const key = catalogKey.homeGeneral();
  const current = (await readCatalogJson(key)) || {};
  const types = { ...(current.types || {}) };
  const counts = { ...(current.counts || {}) };
  types[type] = sortTemplates(items).slice(0, TEMPLATE_HOME_LIMIT);
  counts[type] = items.length;
  await putCatalogJson(key, {
    schema: TEMPLATE_CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    limit: TEMPLATE_HOME_LIMIT,
    counts,
    types,
    subtypeDates: { ...(current.subtypeDates || {}), [type]: annotateSubtypeDates(items).subtypeDates },
  });
}

async function updateHomeCompanyFromType(company, type, items) {
  if (!company || !type) return;
  const key = catalogKey.homeCompany(company);
  const current = (await readCatalogJson(key)) || {};
  const types = { ...(current.types || {}) };
  const counts = { ...(current.counts || {}) };
  types[type] = sortTemplates(items).slice(0, TEMPLATE_HOME_LIMIT);
  counts[type] = items.length;
  await putCatalogJson(key, {
    schema: TEMPLATE_CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    company,
    limit: TEMPLATE_HOME_LIMIT,
    counts,
    types,
    subtypeDates: { ...(current.subtypeDates || {}), [type]: annotateSubtypeDates(items).subtypeDates },
  });
}

function generalMasterPayloadFromItems(items) {
  const data = {};
  for (const item of sortTemplates(items || [])) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const { id: _id, ...templateData } = item;
    data[id] = templateData;
  }
  return {
    meta: {
      format: "JSON",
      version: "2.0.0",
      source: "R2-CDN",
      collection: "mlmtemplate",
      mainType: "General",
      count: Object.keys(data).length,
      generatedAt: new Date().toISOString(),
    },
    data,
  };
}

async function updateGeneralMasterCatalog(templateId, beforeData, currentData) {
  const touchedGeneral = [beforeData, currentData].some(
    (data) => data && String(data.MainType || "").trim() === "General",
  );
  if (!touchedGeneral) return;

  const key = catalogKey.generalMaster();
  const currentPayload = await readCatalogJson(key);
  let data = currentPayload?.data && typeof currentPayload.data === "object"
    ? { ...currentPayload.data }
    : null;

  if (!data) {
    const items = await templateQuery({ mainType: "General" });
    data = generalMasterPayloadFromItems(items).data;
  }

  delete data[String(templateId)];
  if (
    currentData &&
    String(currentData.MainType || "").trim() === "General" &&
    isVisibleTemplate(currentData)
  ) {
    data[String(templateId)] = jsonSafe(currentData);
  }

  await putCatalogJson(key, {
    meta: {
      format: "JSON",
      version: "2.0.0",
      source: "R2-CDN",
      collection: "mlmtemplate",
      mainType: "General",
      count: Object.keys(data).length,
      generatedAt: new Date().toISOString(),
    },
    data,
  });
}

async function publishTemplateCatalogIncrementally(templateId, beforeData, afterData, currentData = afterData) {
  const descriptorMap = new Map();
  // Include the event before/after buckets plus the document's current state.
  // The current state makes retries and out-of-order Firestore trigger delivery
  // converge on the latest source-of-truth document.
  for (const data of [beforeData, afterData, currentData]) {
    for (const descriptor of incrementalBucketDescriptors(data)) {
      descriptorMap.set(descriptor.key, descriptor);
    }
  }

  // Update canonical per-type/date buckets first. These R2 objects are the
  // source for Home slices, so normal Admin writes add zero Firestore reads.
  const updated = new Map();
  for (const descriptor of descriptorMap.values()) {
    updated.set(
      descriptor.key,
      await updateIncrementalBucket(descriptor, templateId, currentData),
    );
  }

  const homeGeneralTypes = new Set();
  const homeCompanyTypes = new Map();
  for (const descriptor of descriptorMap.values()) {
    if (descriptor.kind === "general") {
      homeGeneralTypes.add(descriptor.type);
    }
    if (descriptor.kind === "mlm") {
      if (!homeCompanyTypes.has(descriptor.company)) homeCompanyTypes.set(descriptor.company, new Set());
      homeCompanyTypes.get(descriptor.company).add(descriptor.type);
    }
  }

  for (const type of homeGeneralTypes) {
    const key = catalogKey.general(type);
    await updateHomeGeneralFromType(type, updated.get(key) || []);
  }
  for (const [company, types] of homeCompanyTypes) {
    for (const type of types) {
      const key = catalogKey.mlm(company, type);
      await updateHomeCompanyFromType(company, type, updated.get(key) || []);
    }
  }

  // Keep the legacy all-General JSON available as a live R2 CDN object.
  // The web app loads this at runtime instead of bundling a stale export.
  await updateGeneralMasterCatalog(templateId, beforeData, currentData);
}

async function rebuildAffectedTemplateCatalog(beforeData, afterData) {
  const descriptors = new Map();
  for (const data of [beforeData, afterData]) {
    const descriptor = templateBucketDescriptor(data);
    if (descriptor?.type) descriptors.set(descriptorKey(descriptor), descriptor);
  }

  const jobs = [];
  const homeCompanies = new Set();
  let homeGeneral = false;
  for (const descriptor of descriptors.values()) {
    if (descriptor.mainType === "General") {
      jobs.push(rebuildGeneralType(descriptor.type));
      homeGeneral = true;
      if (descriptor.type === "Festival" && descriptor.date) jobs.push(rebuildFestivalDate(descriptor.date));
      if (descriptor.type === "Trending" && descriptor.date) jobs.push(rebuildTrendingGeneralDate(descriptor.date));
    } else if (descriptor.mainType === "MLM" && descriptor.company) {
      jobs.push(rebuildMlmType(descriptor.company, descriptor.type));
      homeCompanies.add(descriptor.company);
    }
  }
  if (homeGeneral) jobs.push(rebuildHomeGeneral());
  for (const company of homeCompanies) jobs.push(rebuildHomeCompany(company));
  await Promise.all(jobs);
}

async function rebuildEntireTemplateCatalogFromSnapshot(snapshot) {
  const visible = annotateSubtypeDates(snapshot.docs
    .map((document) => ({ id: document.id, data: document.data() }))
    .filter(({ data }) => isVisibleTemplate(data))
    .map(({ id, data }) => serializeTemplate(id, data))).items;

  const generalGroups = new Map();
  const mlmGroups = new Map();
  const festivalGroups = new Map();
  const trendingGroups = new Map();
  const companyGroups = new Map();

  for (const item of visible) {
    const mainType = String(item.MainType || "").trim();
    const type = String(item.SelectType || "").trim();
    const company = String(item.Company || "").trim();
    const date = String(item.Date || "").trim();
    if (mainType === "General" && type) {
      if (!generalGroups.has(type)) generalGroups.set(type, []);
      generalGroups.get(type).push(item);
      if (type === "Festival" && date) {
        if (!festivalGroups.has(date)) festivalGroups.set(date, []);
        festivalGroups.get(date).push(item);
      }
      if (type === "Trending" && date) {
        if (!trendingGroups.has(date)) trendingGroups.set(date, []);
        trendingGroups.get(date).push(item);
      }
    }
    if (mainType === "MLM" && company && type) {
      const groupKey = `${company}\u0000${type}`;
      if (!mlmGroups.has(groupKey)) mlmGroups.set(groupKey, { company, type, items: [] });
      mlmGroups.get(groupKey).items.push(item);
      if (!companyGroups.has(company)) companyGroups.set(company, []);
      companyGroups.get(company).push(item);
    }
  }

  const writeJobs = [];
  for (const [type, items] of generalGroups) {
    writeJobs.push(() => putCatalogJson(catalogKey.general(type), catalogPayload(items, { mainType: "General", type })));
  }
  for (const { company, type, items } of mlmGroups.values()) {
    writeJobs.push(() => putCatalogJson(catalogKey.mlm(company, type), catalogPayload(items, { mainType: "MLM", company, type })));
  }
  for (const [date, items] of festivalGroups) {
    writeJobs.push(() => putCatalogJson(catalogKey.festival(date), catalogPayload(items, { type: "Festival", date })));
  }
  for (const [date, items] of trendingGroups) {
    writeJobs.push(() => putCatalogJson(catalogKey.trendingGeneral(date), catalogPayload(items, { type: "Trending", date })));
  }
  // Do not create one R2 JSON object per template during the initial rebuild.
  // That was the main cause of Sync CDN deadline-exceeded on large datasets.
  // Bootstrap only the individual detail files the current web app actually
  // consumes directly (Festival). Other template writes get their detail JSON
  // from publishTemplateCatalogOnWrite when they are next edited/created.
  const bootstrapDetailItems = visible.filter((item) =>
    String(item.MainType || "").trim() === "General" &&
    TEMPLATE_BOOTSTRAP_DETAIL_TYPES.has(String(item.SelectType || "").trim()),
  );
  for (const item of bootstrapDetailItems) {
    writeJobs.push(() => putCatalogJson(catalogKey.template(item.id), {
      schema: TEMPLATE_CATALOG_SCHEMA,
      generatedAt: new Date().toISOString(),
      template: item,
    }));
  }

  const homeGeneralTypes = {};
  const homeGeneralCounts = {};
  for (const [type, rawItems] of generalGroups) {
    const items = sortTemplates(rawItems || []);
    homeGeneralTypes[type] = items.slice(0, TEMPLATE_HOME_LIMIT);
    homeGeneralCounts[type] = items.length;
  }
  writeJobs.push(() => putCatalogJson(catalogKey.homeGeneral(), {
    schema: TEMPLATE_CATALOG_SCHEMA,
    generatedAt: new Date().toISOString(),
    limit: TEMPLATE_HOME_LIMIT,
    counts: homeGeneralCounts,
    types: homeGeneralTypes,
    subtypeDates: homeSubtypeDates(visible.filter(item => item.MainType === "General")),
  }));

  const allGeneralItems = visible.filter(
    (item) => String(item.MainType || "").trim() === "General",
  );
  writeJobs.push(() => putCatalogJson(
    catalogKey.generalMaster(),
    generalMasterPayloadFromItems(allGeneralItems),
  ));

  for (const [company, itemsRaw] of companyGroups) {
    const grouped = {};
    const counts = {};
    for (const item of sortTemplates(itemsRaw)) {
      const type = String(item.SelectType || "").trim();
      counts[type] = (counts[type] || 0) + 1;
      if (!grouped[type]) grouped[type] = [];
      if (grouped[type].length < TEMPLATE_HOME_LIMIT) grouped[type].push(item);
    }
    writeJobs.push(() => putCatalogJson(catalogKey.homeCompany(company), {
      schema: TEMPLATE_CATALOG_SCHEMA,
      generatedAt: new Date().toISOString(),
      company,
      limit: TEMPLATE_HOME_LIMIT,
      counts,
      types: grouped,
      subtypeDates: homeSubtypeDates(itemsRaw),
    }));
  }

  // Limit concurrent R2 writes so a large first backfill stays stable.
  for (let index = 0; index < writeJobs.length; index += 20) {
    await Promise.all(writeJobs.slice(index, index + 20).map((job) => job()));
  }
  await writeCatalogVersion("full-rebuild");
  return {
    total: snapshot.size,
    published: visible.length,
    detailObjects: bootstrapDetailItems.length,
    objects: writeJobs.length + 1,
  };
}

const millisOf = (value) => value?.toMillis?.() || null;
const numericPercentage = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
};

function validationError(error) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return new HttpsError("invalid-argument", error.message);
  }
  return error;
}

async function writeInBatches(operations) {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + 400))
      operation(batch);
    await batch.commit();
  }
}

async function revokeMarketingSessions(ownerId, reason) {
  const snapshot = await db
    .collection("_panelSessions")
    .where("ownerId", "==", ownerId)
    .get();
  const operations = snapshot.docs.map(
    (document) => (batch) =>
      batch.update(document.ref, {
        revoked: true,
        revokedAt: FieldValue.serverTimestamp(),
        revokeReason: cleanText(reason, 120),
        expiresAt: Timestamp.fromMillis(0),
      }),
  );
  if (operations.length) await writeInBatches(operations);
  await Promise.all(
    snapshot.docs.map((document) =>
      getAuth()
        .revokeRefreshTokens(document.id)
        .catch(() => null),
    ),
  );
}

async function hierarchyDocuments() {
  const [membersSnapshot, couponsSnapshot] = await Promise.all([
    db.collection("mteam").get(),
    db.collection("couponcode").get(),
  ]);
  const coupons = couponsSnapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
  const couponById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
  const members = membersSnapshot.docs.map((document) => {
    const data = document.data();
    const coupon = couponById.get(String(data.assign_coupon_id || ""));
    const fallbackPercentage = coupon?.marketing_member_percentage;
    return {
      id: document.id,
      ...data,
      referCode: data.referCode || coupon?.referCode || "",
      commissionPercentage:
        data.commissionPercentage === undefined
          ? numericPercentage(fallbackPercentage)
          : numericPercentage(data.commissionPercentage),
    };
  });
  return { members, coupons, couponById };
}

async function rebuildMarketingHierarchy() {
  const snapshot = await db.collection("mteam").get();
  const members = snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
  let hierarchy;
  try {
    hierarchy = buildHierarchy(members);
  } catch (error) {
    console.error("Marketing hierarchy rebuild rejected", {
      message: error.message,
    });
    throw new HttpsError(
      "failed-precondition",
      "Marketing hierarchy contains an invalid cycle.",
    );
  }
  const byId = new Map(members.map((member) => [member.id, member]));
  const operations = snapshot.docs.map((document) => (batch) => {
    const info = hierarchy.get(document.id) || { level: 0, ancestorIds: [] };
    const parent = byId.get(String(document.data().parentMteamId || ""));
    batch.set(
      document.ref,
      {
        level: info.level,
        ancestorIds: info.ancestorIds,
        parentName: parent?.name || "",
        hierarchyUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
  if (operations.length) await writeInBatches(operations);
}

async function parentChain(parentId, childId) {
  const ancestorIds = [];
  const visited = new Set();
  let currentId = String(parentId || "");
  let parentDocument = null;
  while (currentId) {
    if (currentId === childId || visited.has(currentId)) {
      throw new HttpsError(
        "invalid-argument",
        "A member cannot be assigned below itself or its descendants.",
      );
    }
    if (ancestorIds.length >= 25)
      throw new HttpsError(
        "failed-precondition",
        "Marketing hierarchy is too deep.",
      );
    visited.add(currentId);
    const snapshot = await db.collection("mteam").doc(currentId).get();
    if (!snapshot.exists)
      throw new HttpsError(
        "not-found",
        "Selected parent Marketing member was not found.",
      );
    if (!parentDocument) parentDocument = snapshot;
    ancestorIds.unshift(snapshot.id);
    currentId = String(snapshot.data().parentMteamId || "");
  }
  return { ancestorIds, parentDocument };
}

async function effectiveMemberPercentage(memberDocument) {
  if (!memberDocument?.exists) return null;
  const data = memberDocument.data();
  if (data.commissionPercentage !== undefined)
    return numericPercentage(data.commissionPercentage);
  if (!data.assign_coupon_id) return 0;
  const coupon = await db
    .collection("couponcode")
    .doc(String(data.assign_coupon_id))
    .get();
  return coupon.exists
    ? numericPercentage(coupon.data().marketing_member_percentage)
    : 0;
}

async function ensureUniqueMarketingEmail(loginEmail, memberId) {
  const snapshot = await db
    .collection("mteam")
    .where("loginEmail", "==", loginEmail)
    .limit(2)
    .get();
  if (snapshot.docs.some((document) => document.id !== memberId)) {
    throw new HttpsError(
      "already-exists",
      "This login email is already assigned to another Marketing member.",
    );
  }
}

async function ensureUniqueCouponField(field, value, couponId, label) {
  if (!value) return;
  const snapshot = await db
    .collection("couponcode")
    .where(field, "==", value)
    .limit(2)
    .get();
  if (snapshot.docs.some((document) => document.id !== couponId)) {
    throw new HttpsError("already-exists", `${label} is already in use.`);
  }
}

async function deleteTemplateStoragePaths(bucket, paths) {
  const failures = [];
  const batchSize = 20;

  for (let index = 0; index < paths.length; index += batchSize) {
    const batch = paths.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((path) => bucket.file(path).delete({ ignoreNotFound: true })),
    );

    results.forEach((result, resultIndex) => {
      if (result.status === "rejected") {
        failures.push({
          path: batch[resultIndex],
          reason: result.reason,
        });
      }
    });
  }

  if (failures.length) {
    console.error("Template Storage cleanup failed", {
      failedObjects: failures.map(({ path }) => path),
    });
    throw failures[0].reason;
  }
}

exports.panelCreateR2TemplateUpload = onCall(
  { region: REGION, cors: true, secrets: R2_FUNCTION_SECRETS },
  async (request) => {
    await requireTemplateAdmin(request);
    const storagePath = String(request.data?.storagePath || "").trim().replace(/^\/+|\/+$/g, "");
    const fileName = String(request.data?.fileName || "").trim();
    const contentType = String(request.data?.contentType || "application/octet-stream").trim().toLowerCase();
    const size = Number(request.data?.size || 0);

    if (!/^templates\/[A-Za-z0-9_-]{8,128}\/[A-Za-z0-9/_-]{1,220}$/.test(storagePath)) {
      throw new HttpsError("invalid-argument", "Invalid template upload path.");
    }
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(fileName) || fileName.includes("..")) {
      throw new HttpsError("invalid-argument", "Invalid upload filename.");
    }
    const isImage = contentType === "image/webp";
    const isVideo = contentType.startsWith("video/");
    if (!isImage && !isVideo) {
      throw new HttpsError("invalid-argument", "Only WebP images and videos can be uploaded here.");
    }
    const maxBytes = isVideo ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
      throw new HttpsError("invalid-argument", `File is too large. Max ${isVideo ? "100 MB" : "20 MB"}.`);
    }

    const key = `${storagePath}/${fileName}`;
    const config = r2Config();
    return {
      ok: true,
      key,
      uploadUrl: createPresignedPutUrl(config, key, 600, contentType),
      publicUrl: r2PublicObjectUrl(config, key),
      expiresInSeconds: 600,
    };
  },
);

// Public profile-media bucket upload for signed-in app users. The bucket is
// public for reads, but writes still require a short-lived presigned URL so R2
// credentials never reach the browser. New uploads are always namespaced by
// Firebase Auth uid; migrated legacy objects can keep their old paths.
exports.createR2ProfileUpload = onCall(
  { region: REGION, cors: true, secrets: R2_FUNCTION_SECRETS },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in again.");
    }
    const contentType = String(request.data?.contentType || "").trim().toLowerCase();
    const size = Number(request.data?.size || 0);
    const scope = String(request.data?.scope || "profile").trim().toLowerCase();
    const originalName = String(request.data?.fileName || "image.webp").trim();

    if (contentType !== "image/webp") {
      throw new HttpsError("invalid-argument", "Profile uploads must be WebP images.");
    }
    if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "Profile image is too large. Max 20 MB.");
    }
    if (!["profile", "topup"].includes(scope)) {
      throw new HttpsError("invalid-argument", "Invalid profile upload type.");
    }

    const safeUid = String(request.auth.uid).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
    const safeName = originalName
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .slice(-140) || "image.webp";
    const nonce = crypto.randomBytes(6).toString("hex");
    const key = `mlmprofiles/${safeUid}/${scope}/${Date.now()}_${nonce}_${safeName}`;
    const config = profileR2Config();

    return {
      ok: true,
      key,
      uploadUrl: createPresignedPutUrl(config, key, 600, contentType),
      publicUrl: r2PublicObjectUrl(config, key),
      expiresInSeconds: 600,
    };
  },
);

exports.deleteR2ProfileObject = onCall(
  { region: REGION, cors: true, secrets: R2_FUNCTION_SECRETS },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in again.");
    }
    const url = String(request.data?.url || "").trim();
    const config = profileR2Config();
    const key = r2KeyFromPublicUrl(config, url);
    if (!key || !key.startsWith("mlmprofiles/")) {
      throw new HttpsError("invalid-argument", "Invalid profile object URL.");
    }

    const ownPrefix = `mlmprofiles/${String(request.auth.uid).replace(/[^A-Za-z0-9_-]/g, "_")}/`;
    const allowed = key.startsWith(ownPrefix) || (await canDeleteLegacyProfileKey(request, key));
    if (!allowed) {
      throw new HttpsError("permission-denied", "This profile image does not belong to this account.");
    }

    await deleteR2Object(config, key);
    return { ok: true, key };
  },
);

exports.panelRebuildTemplateCatalog = onCall(
  {
    region: REGION,
    cors: true,
    secrets: R2_FUNCTION_SECRETS,
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (request) => {
    await requireTemplateAdmin(request);
    return withTemplateCatalogLock(async () => {
      const snapshot = await db.collection("mlmtemplate").get();
      const result = await rebuildEntireTemplateCatalogFromSnapshot(snapshot);
      console.info("R2 template catalog full rebuild complete", result);
      return { ok: true, ...result, cdnBaseUrl: r2Config().publicBaseUrl };
    }, { leaseMs: 10 * 60 * 1000, maxWaitMs: 2 * 60 * 1000 });
  },
);

exports.publishTemplateCatalogOnWrite = onDocumentWritten(
  {
    document: "mlmtemplate/{templateId}",
    region: TEMPLATE_STORAGE_CLEANUP_REGION,
    retry: true,
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: R2_FUNCTION_SECRETS,
  },
  async (event) => {
    const templateId = event.params.templateId;
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;
    const beforeData = beforeSnapshot?.exists ? beforeSnapshot.data() || {} : {};
    const afterData = afterSnapshot?.exists ? afterSnapshot.data() || {} : {};

    // Bulk Firestore URL migration is followed by one Admin Sync CDN rebuild.
    // Do not run expensive serialized R2 publishes for URL-only migration writes.
    if (isOnlyTemplateUrlMigration(beforeData, afterData, getStorage().bucket().name)) {
      console.info("R2 URL-only migration: skipping incremental publish; run Sync CDN after migration", { templateId });
      return;
    }

    // Serialize the small R2 read-modify-write catalog updates. This prevents
    // lost cards when Admin performs bulk/copy operations that write many
    // template documents at nearly the same time.
    return withTemplateCatalogLock(async () => {
      const latestSnapshot = await db.collection("mlmtemplate").doc(templateId).get();
      const currentData = latestSnapshot.exists ? latestSnapshot.data() || {} : {};

      const deletedR2Assets = beforeSnapshot?.exists
        ? await cleanupRemovedR2TemplateAssets(templateId, beforeData, currentData)
        : 0;

      // Do not expose a partial CDN catalog before the one-time Admin "Sync CDN"
      // bootstrap has completed. Until version.json exists, the web app keeps
      // using its Firestore fallback automatically.
      const manifest = await readCatalogJson(catalogKey.version());
      if (!manifest?.version) {
        console.info("R2 template catalog waiting for initial full sync", {
          templateId,
          deletedR2Assets,
        });
        return;
      }

      await Promise.all([
        writeTemplateDetail(templateId, latestSnapshot.exists ? currentData : null),
        publishTemplateCatalogIncrementally(templateId, beforeData, afterData, currentData),
      ]);
      const version = await writeCatalogVersion("template-write");

      console.info("R2 template catalog incremental publish complete", {
        templateId,
        deletedR2Assets,
        version,
        deleted: !latestSnapshot.exists,
      });
    }, { leaseMs: 6 * 60 * 1000, maxWaitMs: 4 * 60 * 1000 });
  },
);

/**
 * Storage cleanup is server-owned so it works for every authorised Admin role
 * and every UI/code path that updates or deletes an mlmtemplate document.
 */
exports.cleanupTemplateStorageOnWrite = onDocumentWritten(
  {
    document: "mlmtemplate/{templateId}",
    region: TEMPLATE_STORAGE_CLEANUP_REGION,
    retry: true,
  },
  async (event) => {
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;

    // Creates cannot make an existing Storage object orphaned.
    if (!beforeSnapshot?.exists) return;

    const beforeData = beforeSnapshot.data() || {};
    const afterData = afterSnapshot?.exists ? afterSnapshot.data() || {} : {};
    const bucket = getStorage().bucket();
    const removedPaths = getRemovedTemplateStoragePaths(
      beforeData,
      afterData,
      bucket.name,
    );

    let deletedCount = 0;
    let sharedCount = 0;

    if (removedPaths.length) {
      // A Storage URL can be intentionally reused. Scan the current template
      // documents and delete only objects that have no remaining reference.
      const currentTemplatesSnapshot = await db.collection("mlmtemplate").get();
      const currentTemplates = currentTemplatesSnapshot.docs.map((document) =>
        document.data(),
      );
      const unreferencedPaths = getUnreferencedTemplateStoragePaths(
        removedPaths,
        currentTemplates,
        bucket.name,
      );

      await deleteTemplateStoragePaths(bucket, unreferencedPaths);
      deletedCount = unreferencedPaths.length;
      sharedCount = removedPaths.length - deletedCount;
    }

    // The per-template quality document must not remain after full deletion.
    if (!afterSnapshot?.exists) {
      await db
        .collection("templatequality")
        .doc(event.params.templateId)
        .delete();
    }

    console.info("Template Storage cleanup complete", {
      templateId: event.params.templateId,
      removedReferences: removedPaths.length,
      deletedObjects: deletedCount,
      retainedSharedObjects: sharedCount,
      templateDeleted: !afterSnapshot?.exists,
    });
  },
);

// The deployed callable IDs stay unchanged so deploying this version safely
// overwrites the old SMS implementation instead of leaving it active.
exports.panelStartTwoFactorOtp = onCall({ region: REGION, cors: true, secrets: [EMAIL_PASS] },
  async (request) => {
    const owner = await ownerForEmailLogin();
    await rateLimit("admin_email_otp_cooldown", owner.id, 1, 60000);
    await Promise.all([
      rateLimit("admin_email_otp_owner", owner.id, 3, 600000),
      rateLimit("admin_email_otp_ip", ipOf(request), 8, 600000),
    ]);
    return {
      challengeId: await createEmailChallenge(owner.id),
      delivery: "email",
      maskedEmail: MASKED_ADMIN_OTP_RECIPIENT,
    };
  },
);
exports.panelVerifyTwoFactorOtp = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const id = String(request.data?.challengeId || ""),
      otp = String(request.data?.otp || "");
    if (!/^[a-f0-9]{48}$/.test(id) || !/^\d{6}$/.test(otp))
      throw new HttpsError("invalid-argument", "Enter a valid 6-digit OTP.");
    await rateLimit("admin_verify_ip", ipOf(request), 20, 600000);
    const verified = await verifyChallenge(id, otp),
      owner = await ownerForId(verified.ownerId);
    return { loginTicket: verified.ticket, actors: await actorsFor(owner) };
  },
);
exports.panelCreateSessionFromTwoFactor = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const challengeId = String(request.data?.challengeId || ""),
      ticket = String(request.data?.loginTicket || "");
    const actorId = String(request.data?.actorId || ""),
      password = String(request.data?.password || "");
    await rateLimit("admin_password_ip", ipOf(request), 20, 600000);
    const { ref: challengeRef, data: verified } = await readTicket(
      challengeId,
      ticket,
    );
    const owner = await ownerForId(verified.ownerId),
      actor = await actorFor(owner, actorId);
    await verifyOrCreatePassword(owner.id, actor.id, password, true);
    await challengeRef.update({ used: true, ticketHash: FieldValue.delete() });
    const tabs =
      actor.actorType === "owner" ? OWNER_TABS : safeTabs(actor.assigntab);
    const claims = {
      panel: "admin",
      actorType: actor.actorType,
      adminId: actor.id,
      ownerAdminId: owner.id,
      name: cleanText(actor.name || "Admin", 80),
      role: actor.role || "Admin",
      tabs,
    };
    const uid = `panel_${hash(`admin:${owner.id}:${actor.id}:${crypto.randomBytes(24).toString("hex")}`).slice(0, 48)}`;
    const prior = await db
      .collection("_panelSessions")
      .where("ownerId", "==", owner.id)
      .get();
    const previous =
      prior.docs
        .map(sessionPublic)
        .filter((s) => s.actorId === actor.id)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
    const now = Timestamp.now(),
      expiresAt = Timestamp.fromMillis(Date.now() + SESSION_MS);
    await db
      .collection("_panelSessions")
      .doc(uid)
      .set({
        panel: "admin",
        ownerId: owner.id,
        actorId: actor.id,
        actorName: claims.name,
        actorType: actor.actorType,
        ip: ipOf(request),
        location: locationOf(request),
        device: deviceOf(request),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        revoked: false,
      });
    return {
      token: await getAuth().createCustomToken(uid, claims),
      expiresAt: expiresAt.toMillis(),
      loginAlert: previous,
    };
  },
);
exports.panelSessionStatus = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { ref, data } = await requireSession(request);
    await ref.update({ lastSeenAt: FieldValue.serverTimestamp() });
    return { valid: true, expiresAt: data.expiresAt.toMillis() };
  },
);
exports.panelUnlockSession = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { ref, data } = await requireSession(request);
    await rateLimit(
      "admin_unlock",
      `${request.auth.uid}:${ipOf(request)}`,
      10,
      900000,
    );
    await verifyOrCreatePassword(
      data.ownerId,
      data.actorId,
      String(request.data?.password || ""),
      false,
    );
    await ref.update({
      lastSeenAt: FieldValue.serverTimestamp(),
      lastUnlockAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  },
);
exports.panelListSessions = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { data } = await requireSession(request);
    const snap = await db
      .collection("_panelSessions")
      .where("ownerId", "==", data.ownerId)
      .get();
    const all = request.auth.token.actorType === "owner";
    return {
      currentSessionId: request.auth.uid,
      sessions: snap.docs
        .map(sessionPublic)
        .filter((s) => all || s.actorId === data.actorId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 100),
    };
  },
);
exports.panelRevokeSession = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { data } = await requireSession(request),
      id = String(request.data?.sessionId || "");
    const target = await db.collection("_panelSessions").doc(id).get();
    if (
      !target.exists ||
      target.data().ownerId !== data.ownerId ||
      (request.auth.token.actorType !== "owner" &&
        target.data().actorId !== data.actorId)
    )
      throw new HttpsError("permission-denied", "Not authorised.");
    await target.ref.update({
      revoked: true,
      revokedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(0),
    });
    try {
      await getAuth().revokeRefreshTokens(id);
    } catch {
      /* session denial is immediate */
    }
    return { ok: true, current: id === request.auth.uid };
  },
);
exports.panelLogout = onCall(
  { region: REGION, cors: true },
  async (request) => {
    if (!request.auth?.uid)
      throw new HttpsError("unauthenticated", "Not signed in.");
    await db.collection("_panelSessions").doc(request.auth.uid).delete();
    try {
      await getAuth().revokeRefreshTokens(request.auth.uid);
    } catch {
      /* deleted session denies access */
    }
    return { ok: true };
  },
);
exports.purgeLegacyPanelSecrets = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireSession(request);
    if (
      request.auth.token.actorType !== "owner" ||
      request.auth.token.role !== "Master Admin"
    )
      throw new HttpsError("permission-denied", "Not authorised.");
    const admins = await db.collection("adminuser").get();
    let batch = db.batch(),
      count = 0;
    for (const doc of admins.docs) {
      const updates = {};
      if (doc.data().pin !== undefined) updates.pin = FieldValue.delete();
      if (doc.data().password !== undefined)
        updates.password = FieldValue.delete();
      if (Object.keys(updates).length) {
        batch.update(doc.ref, updates);
        count++;
      }
    }
    if (count) await batch.commit();
    return { purged: count };
  },
);

exports.panelSetMasterAdminPassword = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { data: session } = await requireMasterAdmin(
      request,
      "Only Master Admin can change the Master Admin password.",
    );
    const password = String(request.data?.password || "");
    if (!strongPassword(password)) throw passwordError();

    const owner = await ownerForId(session.ownerId);
    const credentialRef = db
      .collection("_panelCredentials")
      .doc(hash(`admin:${owner.id}:${owner.id}`));
    const existing = await credentialRef.get();
    const salt = crypto.randomBytes(24).toString("hex");
    const now = FieldValue.serverTimestamp();

    await credentialRef.set(
      {
        panel: "admin",
        ownerId: owner.id,
        actorId: owner.id,
        salt,
        passwordHash: await passwordHash(password, salt),
        ...(existing.exists ? {} : { createdAt: now }),
        updatedAt: now,
      },
      { merge: true },
    );

    const sessions = await db
      .collection("_panelSessions")
      .where("ownerId", "==", owner.id)
      .get();
    const targets = sessions.docs.filter(
      (document) =>
        document.id !== request.auth.uid &&
        document.data().actorId === owner.id,
    );
    const operations = targets.map(
      (document) => (batch) =>
        batch.update(document.ref, {
          revoked: true,
          revokedAt: FieldValue.serverTimestamp(),
          revokeReason: "Master Admin password changed",
          expiresAt: Timestamp.fromMillis(0),
        }),
    );
    if (operations.length) await writeInBatches(operations);
    await Promise.all(
      targets.map((document) =>
        getAuth()
          .revokeRefreshTokens(document.id)
          .catch(() => null),
      ),
    );

    await db.collection("_panelAudit").add({
      panel: "admin",
      action: "master_admin_password_changed",
      targetId: owner.id,
      actorUid: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  },
);

exports.panelListMarketingHierarchy = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMarketingAdmin(request);
    const { members, coupons } = await hierarchyDocuments();
    const byId = new Map(members.map((member) => [member.id, member]));
    return {
      members: members.map((member) => ({
        id: member.id,
        name: cleanText(member.name, 80),
        mobile: String(member.mobile || ""),
        loginEmail: normalizeEmail(member.loginEmail),
        active: member.active === true,
        assign_coupon_id: String(member.assign_coupon_id || ""),
        referCode: String(member.referCode || ""),
        parentMteamId: String(member.parentMteamId || ""),
        parentName: cleanText(
          byId.get(String(member.parentMteamId || ""))?.name,
          80,
        ),
        level: Number(member.level || 0),
        ancestorIds: Array.isArray(member.ancestorIds)
          ? member.ancestorIds.map(String).slice(0, 25)
          : [],
        commissionPercentage: numericPercentage(member.commissionPercentage),
        uplineBonusPercentage: numericPercentage(
          member.uplineBonusPercentage === undefined
            ? 10
            : member.uplineBonusPercentage,
        ),
        createdAt: millisOf(member.createdAt),
        updatedAt: millisOf(member.updatedAt),
      })),
      coupons: coupons.map((coupon) => ({
        id: coupon.id,
        code: String(coupon.code || ""),
        referCode: String(coupon.referCode || ""),
        assigned_user: coupon.assigned_user
          ? {
              id: String(coupon.assigned_user.id || ""),
              name: cleanText(coupon.assigned_user.name, 80),
              mobile: String(coupon.assigned_user.mobile || ""),
            }
          : null,
        user_discount: numericPercentage(coupon.user_discount),
        marketing_member_percentage: numericPercentage(
          coupon.marketing_member_percentage,
        ),
        active: coupon.active === true,
        created_at: millisOf(coupon.created_at),
        updated_at: millisOf(coupon.updated_at),
      })),
    };
  },
);

exports.panelUpsertMarketingMember = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMarketingAdmin(request);
    const requestedId = String(request.data?.memberId || "").trim();
    if (requestedId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestedId)) {
      throw new HttpsError("invalid-argument", "Invalid Marketing member ID.");
    }
    let input;
    try {
      input = validateMarketingMemberInput(request.data || {});
    } catch (error) {
      throw validationError(error);
    }

    const memberRef = requestedId
      ? db.collection("mteam").doc(requestedId)
      : db.collection("mteam").doc();
    const existing = await memberRef.get();
    if (requestedId && !existing.exists)
      throw new HttpsError("not-found", "Marketing member was not found.");
    await ensureUniqueMarketingEmail(input.loginEmail, memberRef.id);

    let lineage = { ancestorIds: [], parentDocument: null };
    if (input.parentMteamId)
      lineage = await parentChain(input.parentMteamId, memberRef.id);
    const parentPercentage = await effectiveMemberPercentage(
      lineage.parentDocument,
    );
    try {
      assertWithinParentPercentage(
        input.commissionPercentage,
        parentPercentage,
      );
    } catch (error) {
      throw validationError(error);
    }

    const children = await db
      .collection("mteam")
      .where("parentMteamId", "==", memberRef.id)
      .get();
    const childPercentages = await Promise.all(
      children.docs.map(effectiveMemberPercentage),
    );
    if (
      childPercentages.some(
        (percentage) => percentage > input.commissionPercentage,
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This percentage is lower than an existing direct team member. Update the child first.",
      );
    }

    const oldData = existing.exists ? existing.data() : {};
    const oldEmail = normalizeEmail(oldData.loginEmail);
    const newEmailIndexRef = db
      .collection("_marketingEmailOwners")
      .doc(hash(input.loginEmail));
    const oldEmailIndexRef = oldEmail
      ? db.collection("_marketingEmailOwners").doc(hash(oldEmail))
      : null;
    const assignedCouponRef = oldData.assign_coupon_id
      ? db.collection("couponcode").doc(String(oldData.assign_coupon_id))
      : null;

    await db.runTransaction(async (transaction) => {
      const [emailOwner, currentMember, parentSnapshot, assignedCoupon] =
        await Promise.all([
          transaction.get(newEmailIndexRef),
          transaction.get(memberRef),
          input.parentMteamId
            ? transaction.get(db.collection("mteam").doc(input.parentMteamId))
            : Promise.resolve(null),
          assignedCouponRef
            ? transaction.get(assignedCouponRef)
            : Promise.resolve(null),
        ]);
      if (requestedId && !currentMember.exists)
        throw new HttpsError("not-found", "Marketing member was not found.");
      if (emailOwner.exists && emailOwner.data().mteamId !== memberRef.id) {
        throw new HttpsError(
          "already-exists",
          "This login email is already assigned to another Marketing member.",
        );
      }
      if (parentSnapshot && !parentSnapshot.exists)
        throw new HttpsError(
          "not-found",
          "Selected parent Marketing member was not found.",
        );

      const now = FieldValue.serverTimestamp();
      transaction.set(
        memberRef,
        {
          ...input,
          parentName: lineage.parentDocument?.data()?.name || "",
          level: lineage.ancestorIds.length,
          ancestorIds: lineage.ancestorIds,
          password: FieldValue.delete(),
          updatedAt: now,
          updatedByUid: request.auth.uid,
          ...(currentMember.exists
            ? {}
            : { createdAt: now, createdByUid: request.auth.uid }),
        },
        { merge: true },
      );
      transaction.set(newEmailIndexRef, {
        panel: "marketing",
        loginEmail: input.loginEmail,
        mteamId: memberRef.id,
        updatedAt: now,
      });
      if (oldEmailIndexRef && oldEmail !== input.loginEmail)
        transaction.delete(oldEmailIndexRef);
      if (assignedCoupon?.exists) {
        transaction.update(assignedCoupon.ref, {
          referCode: input.referCode,
          marketing_member_percentage: input.commissionPercentage,
          assigned_user: {
            id: memberRef.id,
            name: input.name,
            mobile: input.mobile,
          },
          updated_at: now,
        });
      }
    });

    await rebuildMarketingHierarchy();
    const sensitiveChanged =
      existing.exists &&
      (oldEmail !== input.loginEmail ||
        oldData.active !== input.active ||
        String(oldData.parentMteamId || "") !== input.parentMteamId);
    if (sensitiveChanged)
      await revokeMarketingSessions(
        memberRef.id,
        "Marketing account settings changed by Admin",
      );
    await db.collection("_panelAudit").add({
      panel: "admin",
      action: existing.exists
        ? "marketing_member_updated"
        : "marketing_member_created",
      targetId: memberRef.id,
      actorUid: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, memberId: memberRef.id };
  },
);

exports.panelDeleteMarketingMember = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMasterAdmin(
      request,
      "Only Master Admin can delete a Marketing member.",
    );
    const memberId = String(request.data?.memberId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(memberId))
      throw new HttpsError("invalid-argument", "Invalid Marketing member ID.");
    const memberRef = db.collection("mteam").doc(memberId);
    const member = await memberRef.get();
    if (!member.exists)
      throw new HttpsError("not-found", "Marketing member was not found.");
    const children = await db
      .collection("mteam")
      .where("parentMteamId", "==", memberId)
      .limit(1)
      .get();
    if (!children.empty)
      throw new HttpsError(
        "failed-precondition",
        "Move or remove this member's direct team before deleting the member.",
      );

    let coupon = null;
    if (member.data().assign_coupon_id)
      coupon = await db
        .collection("couponcode")
        .doc(String(member.data().assign_coupon_id))
        .get();
    if (coupon?.exists && coupon.data().code) {
      const sales = await db
        .collection("subscription")
        .where("couponApplied", "==", coupon.data().code)
        .where("payment", "==", "Success")
        .limit(1)
        .get();
      if (!sales.empty)
        throw new HttpsError(
          "failed-precondition",
          "This member has sales history. Deactivate the member instead so reports stay accurate.",
        );
    }

    await revokeMarketingSessions(
      memberId,
      "Marketing account deleted by Master Admin",
    );
    const team = Array.isArray(member.data().team) ? member.data().team : [];
    const credentialRefs = [
      memberId,
      ...team.map((user) => user?.id).filter(Boolean),
    ].map((actorId) =>
      db
        .collection("_panelCredentials")
        .doc(hash(`marketing:${memberId}:${actorId}`)),
    );
    const email = normalizeEmail(member.data().loginEmail);
    const operations = [
      (batch) => batch.delete(memberRef),
      ...credentialRefs.map((ref) => (batch) => batch.delete(ref)),
      ...(email
        ? [
            (batch) =>
              batch.delete(
                db.collection("_marketingEmailOwners").doc(hash(email)),
              ),
          ]
        : []),
      ...(coupon?.exists
        ? [
            (batch) =>
              batch.update(coupon.ref, {
                assigned_user: null,
                updated_at: FieldValue.serverTimestamp(),
              }),
          ]
        : []),
    ];
    await writeInBatches(operations);
    await db
      .collection("_panelAudit")
      .add({
        panel: "admin",
        action: "marketing_member_deleted",
        targetId: memberId,
        actorUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    return { ok: true };
  },
);

exports.panelUpsertMarketingCoupon = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMarketingAdmin(request);
    const requestedId = String(request.data?.couponId || "").trim();
    if (requestedId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestedId))
      throw new HttpsError("invalid-argument", "Invalid coupon ID.");
    let input;
    try {
      input = validateCouponInput(request.data || {});
    } catch (error) {
      throw validationError(error);
    }
    const couponRef = requestedId
      ? db.collection("couponcode").doc(requestedId)
      : db.collection("couponcode").doc();
    const [existing, member] = await Promise.all([
      couponRef.get(),
      db.collection("mteam").doc(input.assignedMteamId).get(),
    ]);
    if (requestedId && !existing.exists)
      throw new HttpsError("not-found", "Coupon was not found.");
    if (!member.exists)
      throw new HttpsError(
        "not-found",
        "Assigned Marketing member was not found.",
      );
    if (
      member.data().assign_coupon_id &&
      member.data().assign_coupon_id !== couponRef.id
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This member already has another coupon assigned.",
      );
    }
    await Promise.all([
      ensureUniqueCouponField("code", input.code, couponRef.id, "Coupon code"),
      ensureUniqueCouponField(
        "referCode",
        input.referCode,
        couponRef.id,
        "Refer code",
      ),
    ]);

    let parent = null;
    if (member.data().parentMteamId)
      parent = await db
        .collection("mteam")
        .doc(String(member.data().parentMteamId))
        .get();
    const parentPercentage = await effectiveMemberPercentage(parent);
    try {
      assertWithinParentPercentage(input.marketingPercentage, parentPercentage);
    } catch (error) {
      throw validationError(error);
    }
    const children = await db
      .collection("mteam")
      .where("parentMteamId", "==", member.id)
      .get();
    const childPercentages = await Promise.all(
      children.docs.map(effectiveMemberPercentage),
    );
    if (
      childPercentages.some(
        (percentage) => percentage > input.marketingPercentage,
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This percentage is lower than an existing direct team member. Update the child first.",
      );
    }

    const oldMemberId = existing.exists
      ? String(existing.data().assigned_user?.id || "")
      : "";
    const oldMemberRef =
      oldMemberId && oldMemberId !== member.id
        ? db.collection("mteam").doc(oldMemberId)
        : null;
    const codeIndexRef = db
      .collection("_marketingCouponCodes")
      .doc(hash(input.code));
    const referIndexRef = input.referCode
      ? db.collection("_marketingReferCodes").doc(hash(input.referCode))
      : null;
    const oldCode = existing.exists ? normalizeCode(existing.data().code) : "";
    const oldReferCode = existing.exists
      ? normalizeCode(existing.data().referCode)
      : "";
    await db.runTransaction(async (transaction) => {
      const [currentCoupon, currentMember, oldMember, codeOwner, referOwner] =
        await Promise.all([
          transaction.get(couponRef),
          transaction.get(member.ref),
          oldMemberRef ? transaction.get(oldMemberRef) : Promise.resolve(null),
          transaction.get(codeIndexRef),
          referIndexRef
            ? transaction.get(referIndexRef)
            : Promise.resolve(null),
        ]);
      if (requestedId && !currentCoupon.exists)
        throw new HttpsError("not-found", "Coupon was not found.");
      if (!currentMember.exists)
        throw new HttpsError(
          "not-found",
          "Assigned Marketing member was not found.",
        );
      if (
        currentMember.data().assign_coupon_id &&
        currentMember.data().assign_coupon_id !== couponRef.id
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This member already has another coupon assigned.",
        );
      }
      if (codeOwner.exists && codeOwner.data().couponId !== couponRef.id)
        throw new HttpsError(
          "already-exists",
          "Coupon code is already in use.",
        );
      if (referOwner?.exists && referOwner.data().couponId !== couponRef.id)
        throw new HttpsError("already-exists", "Refer code is already in use.");
      const now = FieldValue.serverTimestamp();
      if (
        oldMember?.exists &&
        oldMember.data().assign_coupon_id === couponRef.id
      ) {
        transaction.update(oldMember.ref, {
          assign_coupon_id: "",
          referCode: "",
          updatedAt: now,
        });
      }
      transaction.set(
        couponRef,
        {
          code: input.code,
          referCode: input.referCode,
          assigned_user: {
            id: member.id,
            name: cleanText(member.data().name, 80),
            mobile: String(member.data().mobile || ""),
          },
          user_discount: input.userDiscount,
          marketing_member_percentage: input.marketingPercentage,
          active: input.active,
          updated_at: now,
          updatedByUid: request.auth.uid,
          ...(currentCoupon.exists
            ? {}
            : { created_at: now, createdByUid: request.auth.uid }),
        },
        { merge: true },
      );
      transaction.update(member.ref, {
        assign_coupon_id: couponRef.id,
        referCode: input.referCode,
        commissionPercentage: input.marketingPercentage,
        password: FieldValue.delete(),
        updatedAt: now,
      });
      transaction.set(codeIndexRef, {
        code: input.code,
        couponId: couponRef.id,
        updatedAt: now,
      });
      if (referIndexRef)
        transaction.set(referIndexRef, {
          referCode: input.referCode,
          couponId: couponRef.id,
          updatedAt: now,
        });
      if (oldCode && oldCode !== input.code)
        transaction.delete(
          db.collection("_marketingCouponCodes").doc(hash(oldCode)),
        );
      if (oldReferCode && oldReferCode !== input.referCode)
        transaction.delete(
          db.collection("_marketingReferCodes").doc(hash(oldReferCode)),
        );
    });
    await db
      .collection("_panelAudit")
      .add({
        panel: "admin",
        action: existing.exists
          ? "marketing_coupon_updated"
          : "marketing_coupon_created",
        targetId: couponRef.id,
        actorUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    return { ok: true, couponId: couponRef.id };
  },
);

exports.panelDeleteMarketingCoupon = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMasterAdmin(
      request,
      "Only Master Admin can delete a Marketing coupon.",
    );
    const couponId = String(request.data?.couponId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(couponId))
      throw new HttpsError("invalid-argument", "Invalid coupon ID.");
    const couponRef = db.collection("couponcode").doc(couponId);
    const coupon = await couponRef.get();
    if (!coupon.exists)
      throw new HttpsError("not-found", "Coupon was not found.");
    if (coupon.data().code) {
      const sales = await db
        .collection("subscription")
        .where("couponApplied", "==", coupon.data().code)
        .where("payment", "==", "Success")
        .limit(1)
        .get();
      if (!sales.empty)
        throw new HttpsError(
          "failed-precondition",
          "This coupon has sales history. Deactivate it instead so reports stay accurate.",
        );
    }
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(couponRef);
      if (!current.exists)
        throw new HttpsError("not-found", "Coupon was not found.");
      const currentMemberId = String(current.data().assigned_user?.id || "");
      if (currentMemberId) {
        const memberRef = db.collection("mteam").doc(currentMemberId);
        const member = await transaction.get(memberRef);
        if (member.exists && member.data().assign_coupon_id === couponId) {
          transaction.update(memberRef, {
            assign_coupon_id: "",
            referCode: "",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      const code = normalizeCode(current.data().code),
        referCode = normalizeCode(current.data().referCode);
      if (code)
        transaction.delete(
          db.collection("_marketingCouponCodes").doc(hash(code)),
        );
      if (referCode)
        transaction.delete(
          db.collection("_marketingReferCodes").doc(hash(referCode)),
        );
      transaction.delete(couponRef);
    });
    await db
      .collection("_panelAudit")
      .add({
        panel: "admin",
        action: "marketing_coupon_deleted",
        targetId: couponId,
        actorUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    return { ok: true };
  },
);

const DELETE_REQUEST_COLLECTION = "_adminDeleteRequests";
const DELETE_TARGETS = Object.freeze({
  template: { collection: "mlmtemplate", routePrefix: "/templates/edit/" },
  company: { collection: "mlmcomp", routePrefix: "/companies/edit/" },
});

function deleteTargetFor(resourceType) {
  return (
    DELETE_TARGETS[
      String(resourceType || "")
        .trim()
        .toLowerCase()
    ] || null
  );
}

function safeDeleteReturnUrl(value, resourceType, resourceId) {
  const target = deleteTargetFor(resourceType);
  const fallback = `${target.routePrefix}${resourceId}`;
  const raw = String(value || fallback).trim();
  if (
    !raw.startsWith(target.routePrefix) ||
    raw.includes("://") ||
    raw.includes("\\")
  )
    return fallback;
  return raw.slice(0, 300);
}

exports.panelCreateDeleteRequest = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { data: session } = await requireSession(request);
    if (
      request.auth?.token?.actorType === "owner" &&
      request.auth?.token?.role === "Master Admin"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Master Admin can delete directly without approval.",
      );
    }
    const resourceType = String(request.data?.resourceType || "")
      .trim()
      .toLowerCase();
    const resourceId = String(request.data?.resourceId || "").trim();
    const target = deleteTargetFor(resourceType);
    if (!target || !/^[A-Za-z0-9_-]{1,128}$/.test(resourceId))
      throw new HttpsError("invalid-argument", "Invalid delete target.");

    const tabs = Array.isArray(request.auth?.token?.tabs)
      ? request.auth.token.tabs
      : [];
    const hasAccess =
      resourceType === "template"
        ? tabs.some((tab) => ["templates", "templates_operation", "templates_delete"].includes(tab))
        : tabs.includes("companies");
    if (!hasAccess)
      throw new HttpsError(
        "permission-denied",
        "You do not have access to request deletion for this item.",
      );

    const targetDoc = await db
      .collection(target.collection)
      .doc(resourceId)
      .get();
    if (!targetDoc.exists)
      throw new HttpsError("not-found", "Item was not found.");

    const ref = db
      .collection(DELETE_REQUEST_COLLECTION)
      .doc(hash(`${resourceType}:${resourceId}`));
    const existing = await ref.get();
    if (
      existing.exists &&
      ["pending", "approved"].includes(existing.data().status)
    ) {
      return { ok: true, requestId: ref.id, duplicate: true };
    }

    const resourceLabel = cleanText(
      request.data?.resourceLabel ||
        targetDoc.data()?.name ||
        targetDoc.data()?.Title ||
        targetDoc.data()?.Subtype ||
        resourceId,
      160,
    );
    await ref.set({
      resourceType,
      resourceId,
      resourceLabel,
      targetCollection: target.collection,
      returnUrl: safeDeleteReturnUrl(
        request.data?.returnUrl,
        resourceType,
        resourceId,
      ),
      status: "pending",
      requestedByUid: request.auth.uid,
      requestedByName: cleanText(
        request.auth?.token?.name || session.actorName || "Admin",
        100,
      ),
      requestedByRole: cleanText(request.auth?.token?.role || "Admin", 60),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db
      .collection("_panelAudit")
      .add({
        panel: "admin",
        action: "delete_request_created",
        targetId: resourceId,
        requestId: ref.id,
        resourceType,
        actorUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    return { ok: true, requestId: ref.id };
  },
);

exports.panelListDeleteRequests = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMasterAdmin(request);
    const snapshot = await db
      .collection(DELETE_REQUEST_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    return {
      requests: snapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          resourceType: data.resourceType || "",
          resourceId: data.resourceId || "",
          resourceLabel: data.resourceLabel || "",
          returnUrl: data.returnUrl || "",
          status: data.status || "pending",
          requestedByName: data.requestedByName || "",
          requestedByRole: data.requestedByRole || "",
          createdAt: data.createdAt?.toMillis?.() || null,
          reviewedAt: data.reviewedAt?.toMillis?.() || null,
        };
      }),
    };
  },
);

exports.panelReviewDeleteRequest = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMasterAdmin(request);
    const requestId = String(request.data?.requestId || "").trim();
    const decision = String(request.data?.decision || "")
      .trim()
      .toLowerCase();
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(requestId) ||
      !["approved", "cancelled"].includes(decision)
    )
      throw new HttpsError("invalid-argument", "Invalid review request.");
    const ref = db.collection(DELETE_REQUEST_COLLECTION).doc(requestId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists)
        throw new HttpsError("not-found", "Delete request was not found.");
      if (snapshot.data().status !== "pending")
        throw new HttpsError(
          "failed-precondition",
          "This request has already been reviewed.",
        );
      transaction.update(ref, {
        status: decision,
        reviewedByUid: request.auth.uid,
        reviewedByName: request.auth?.token?.name || "Master Admin",
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { ok: true, status: decision };
  },
);

exports.panelFinalizeApprovedDelete = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMasterAdmin(request);
    const requestId = String(request.data?.requestId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
      throw new HttpsError("invalid-argument", "Invalid delete request.");
    const requestRef = db.collection(DELETE_REQUEST_COLLECTION).doc(requestId);
    await db.runTransaction(async (transaction) => {
      const approval = await transaction.get(requestRef);
      if (!approval.exists)
        throw new HttpsError("not-found", "Delete request was not found.");
      const data = approval.data();
      if (data.status !== "approved")
        throw new HttpsError(
          "failed-precondition",
          "Delete request is not approved.",
        );
      const target = deleteTargetFor(data.resourceType);
      if (!target || target.collection !== data.targetCollection)
        throw new HttpsError(
          "failed-precondition",
          "Delete target is invalid.",
        );
      const targetRef = db
        .collection(target.collection)
        .doc(String(data.resourceId || ""));
      const targetDoc = await transaction.get(targetRef);
      if (targetDoc.exists) transaction.delete(targetRef);
      transaction.update(requestRef, {
        status: "deleted",
        deletedByUid: request.auth.uid,
        deletedByName: request.auth?.token?.name || "Master Admin",
        deletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await db
      .collection("_panelAudit")
      .add({
        panel: "admin",
        action: "approved_delete_finalized",
        requestId,
        actorUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    return { ok: true };
  },
);

exports.taskEmailNotifications = onDocumentWritten(
  { document: "Taskm/{taskId}", region: REGION, secrets: [EMAIL_PASS] },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!after) return;
    try {
      if (!before) {
        await sendTaskEmail(after, "assigned", false);
        return;
      }
      if (before.status !== "Completed" && after.status === "Completed") {
        await sendTaskEmail(after, "completed", true);
      }
    } catch (error) {
      console.error("Task email notification failed", {
        taskId: event.params.taskId,
        code: error?.code || "unknown",
      });
    }
  },
);

exports.recordUserDownload = onCall(
  { region: USER_ACTIVITY_REGION, cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please login again.");
    }

    const mobile = authenticatedMobile(request);
    if (!mobile) {
      throw new HttpsError(
        "failed-precondition",
        "Verified mobile identity is missing.",
      );
    }

    const requestedId = String(request.data?.userDocumentId || "").trim();
    let userDocument = null;

    if (/^[A-Za-z0-9_-]{1,128}$/.test(requestedId)) {
      const candidate = await db.collection("users").doc(requestedId).get();
      if (
        candidate.exists &&
        mobile10(
          candidate.data().mobileNo ||
            candidate.data().mobile ||
            candidate.data().phone,
        ) === mobile
      ) {
        userDocument = candidate;
      }
    }

    if (!userDocument) {
      const mobileValues = [
        mobile,
        Number(mobile),
        `91${mobile}`,
        `+91${mobile}`,
      ];
      const byMobileNo = await db
        .collection("users")
        .where("mobileNo", "in", mobileValues)
        .limit(5)
        .get();
      userDocument =
        byMobileNo.docs.find(
          (document) => mobile10(document.data().mobileNo) === mobile,
        ) || null;
    }

    if (!userDocument) {
      throw new HttpsError("not-found", "User account was not found.");
    }

    await userDocument.ref.update({
      lastDownloadAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  },
);

exports.registerExpoPushToken = onRequest(
  { region: REGION, cors: true },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.status(405).json({ ok: false });
      return;
    }
    const token = cleanText(request.body?.token, 255),
      platform = cleanText(request.body?.platform, 20),
      projectId = cleanText(request.body?.projectId, 80);
    if (
      !validExpoPushToken(token) ||
      !["android", "ios"].includes(platform) ||
      projectId !== EXPO_PROJECT_ID
    ) {
      response.status(422).json({ ok: false, error: "Invalid registration" });
      return;
    }
    try {
      await rateLimit(
        "push_register_ip",
        ipOf({ rawRequest: request }),
        80,
        10 * 60 * 1000,
      );
      const ref = db.collection("_expoPushDevices").doc(hash(`expo:${token}`)),
        existing = await ref.get();
      await ref.set(
        {
          token,
          platform,
          projectId,
          active: true,
          lastSeenAt: FieldValue.serverTimestamp(),
          ...(existing.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
      response.status(200).json({ ok: true });
    } catch (error) {
      const limited = error?.code === "resource-exhausted";
      response
        .status(limited ? 429 : 500)
        .json({ ok: false, error: limited ? "Try later" : "Server error" });
    }
  },
);

exports.panelPushOverview = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireAssignedAdminTab(request, "notifications", "Notification access is required.");
    const [devices, campaigns] = await Promise.all([
      db
        .collection("_expoPushDevices")
        .where("active", "==", true)
        .count()
        .get(),
      db
        .collection("_pushCampaigns")
        .orderBy("createdAt", "desc")
        .limit(20)
        .get(),
    ]);
    return {
      deviceCount: devices.data().count,
      campaigns: campaigns.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis?.() || null,
      })),
    };
  },
);

exports.panelDeletePushCampaigns = onCall(
  { region: REGION, cors: true },
  async (request) => {
    await requireMasterAdmin(
      request,
      "Only Master Admin can delete notification history.",
    );
    const clearAll = request.data?.clearAll === true;
    const ids = [
      ...new Set(
        (Array.isArray(request.data?.campaignIds)
          ? request.data.campaignIds
          : []
        )
          .map((value) => String(value || "").trim())
          .filter((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value)),
      ),
    ].slice(0, 100);
    if (!clearAll && ids.length === 0)
      throw new HttpsError(
        "invalid-argument",
        "Select at least one notification.",
      );
    const documents = clearAll
      ? (await db.collection("_pushCampaigns").get()).docs
      : (
          await Promise.all(
            ids.map((id) => db.collection("_pushCampaigns").doc(id).get()),
          )
        ).filter((document) => document.exists);
    if (documents.length)
      await writeInBatches(
        documents.map((document) => (batch) => batch.delete(document.ref)),
      );
    await db.collection("_panelAudit").add({
      panel: "admin",
      action: clearAll ? "push_history_cleared" : "push_history_deleted",
      deletedCount: documents.length,
      actorUid: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, deletedCount: documents.length };
  },
);

exports.panelSendPushNotification = onCall(
  { region: REGION, cors: true, secrets: [EXPO_ACCESS_TOKEN] },
  async (request) => {
    const { data: session } = await requireAssignedAdminTab(request, "notifications", "Notification access is required.");
    await rateLimit("admin_push_send", request.auth.uid, 20, 60 * 60 * 1000);
    const title = cleanText(request.data?.title, 100),
      body = cleanText(request.data?.body, 1000),
      url = safeAppUrl(request.data?.url);
    if (!title || !body || !url)
      throw new HttpsError(
        "invalid-argument",
        "Enter a valid title, message and MLM LIVE page URL.",
      );
    const snapshot = await db
      .collection("_expoPushDevices")
      .where("active", "==", true)
      .limit(10000)
      .get();
    if (snapshot.empty)
      throw new HttpsError(
        "failed-precondition",
        "No app devices are registered yet.",
      );
    const messages = snapshot.docs
      .filter((doc) => validExpoPushToken(doc.data().token))
      .map((doc) => ({
        to: doc.data().token,
        title,
        body,
        data: { url },
        priority: "high",
        sound: "default",
        channelId: "default",
      }));
    const tickets = await sendExpoMessages(messages),
      accepted = tickets.filter((ticket) => ticket.status === "ok").length,
      rejected = tickets.length - accepted;
    await db
      .collection("_pushCampaigns")
      .add({
        title,
        body,
        url,
        targeted: messages.length,
        accepted,
        rejected,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: request.auth.uid,
        createdByName:
          request.auth.token.name || session.actorName || "Master Admin",
      });
    return { targeted: messages.length, accepted, rejected };
  },
);


// General Admin media upload: short-lived R2 PUT URL, scoped by panel permissions.
// No Firebase Storage fallback. References are never physically deleted here.
exports.panelCreateR2AdminMediaUpload = onCall(
  { region: REGION, cors: true, secrets: R2_FUNCTION_SECRETS },
  async (request) => {
    await requireSession(request);
    // Reuse the existing authenticated R2 handler. No new callable, trigger or
    // scheduled function is added. App clients only GET the public CDN object.
    if (request.data?.operation === "publishPopups") {
      if (request.auth?.token?.panel !== "admin" || request.auth.token.role !== "Master Admin" || request.auth.token.actorType !== "owner") {
        throw new HttpsError("permission-denied", "Only Master Admin can publish app popups.");
      }
      try {
        return await withTemplateCatalogLock(async () => {
          const popupRef = db.collection("popup").doc("popup");
          const source = await popupRef.get();
          if (!source.exists) throw new HttpsError("failed-precondition", "Save your popup settings first.");
          const settings = source.data();
          const templateIds = [...new Set(Object.values(settings.campaigns || {}).filter(row => row?.active && row.kind === "template" && (!row.endsAt || Date.parse(row.endsAt) > Date.now())).map(row => String(row.templateId || "")))];
          if (templateIds.length > 40) throw new Error("Too many active template popups.");
          const templates = new Map();
          // Reads are admin-publish only, bounded by the number of selected
          // templates. Never scan the whole template collection here.
          await Promise.all(templateIds.map(async id => {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Choose a valid template.");
            const snapshot = await db.collection("mlmtemplate").doc(id).get();
            if (snapshot.exists) templates.set(id, { ...serializeTemplate(snapshot.id, snapshot.data()), id: snapshot.id });
          }));
          const feed = buildPopupFeed(settings, templates);
          await putCatalogJson("catalog/v1/popups.json", feed, "public,max-age=60,s-maxage=300,must-revalidate");
          await db.runTransaction(async transaction => {
            const latest = await transaction.get(popupRef);
            if (latest.exists && latest.data().revision === feed.revision) transaction.update(popupRef, { publishedRevision: feed.revision, publishedAt: FieldValue.serverTimestamp() });
          });
          return { ok: true, revision: feed.revision, count: feed.items.length, publicUrl: r2PublicObjectUrl(r2Config(), "catalog/v1/popups.json") };
        }, { lockRef: db.collection("_systemLocks").doc("popupCatalogR2"), leaseMs: 45000, maxWaitMs: 12000 });
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("failed-precondition", error?.message || "Popup CDN publish failed. Your draft is saved; retry Publish.");
      }
    }
    const path = String(request.data?.storagePath || "").trim().replace(/^\/+|\/+$/g, "");
    const filename = String(request.data?.fileName || "").trim();
    const mime = String(request.data?.contentType || "").trim().toLowerCase();
    const size = Number(request.data?.size || 0);
    const roleMaster = request.auth?.token?.actorType === "owner" && request.auth?.token?.role === "Master Admin";
    const tabs = Array.isArray(request.auth?.token?.tabs) ? request.auth.token.tabs.map(String) : [];
    const scope = path.split("/")[0];
    const needed = scope === "templates" ? ["templates", "templates_operation"]
      : scope === "companies" ? ["companies"]
      : scope === "graphics" || scope === "music" ? ["graphics", "music"] : [];
    if (!needed.length || (!roleMaster && !needed.some((t) => tabs.includes(t)))) {
      throw new HttpsError("permission-denied", "This media section is not assigned to your admin account.");
    }
    if (!/^(?:templates|companies|graphics|music)\/[A-Za-z0-9_/-]{1,220}$/.test(path) || path.includes("..")) {
      throw new HttpsError("invalid-argument", "Unsupported upload folder.");
    }
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(filename) || filename.includes("..")) {
      throw new HttpsError("invalid-argument", "Invalid filename.");
    }
    const allowed = mime === "image/webp" || /^video\/(mp4|webm|quicktime)$/.test(mime)
      || /^audio\/(mpeg|mp3|mp4|wav|ogg|webm|aac|x-m4a)$/.test(mime);
    if (!allowed) throw new HttpsError("invalid-argument", "Only WebP, supported video or audio allowed.");
    const max = mime.startsWith("video/") ? 100 * 1024 * 1024 : mime.startsWith("audio/") ? 30 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!Number.isSafeInteger(size) || size < 1 || size > max) throw new HttpsError("invalid-argument", "Invalid upload size.");
    const config = r2Config();
    const key = `${path}/${filename}`;
    return { ok: true, key, publicUrl: r2PublicObjectUrl(config,key), uploadUrl: createPresignedPutUrl(config,key,600,mime), expiresInSeconds:600 };
  },
);
