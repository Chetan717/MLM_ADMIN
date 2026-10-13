"use strict";

// R2 legacy URLs are rewritten only in generated public catalog JSON.
// The original Firestore document is never changed, and Firebase Storage
// URLs are deliberately left untouched.
const LEGACY_TEMPLATE_BASE = "https://pub-51f26ff29c2f4b7ca6dfe48387d68c35.r2.dev";

function normalizeR2TemplateUrl(value, currentBase = "https://cdn.mlmposter.com") {
  if (typeof value !== "string" || !value.startsWith(`${LEGACY_TEMPLATE_BASE}/templates/`)) return value;
  const base = String(currentBase || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/?#]+$/.test(base)) return value;
  return `${base}${value.slice(LEGACY_TEMPLATE_BASE.length)}`;
}

module.exports = { normalizeR2TemplateUrl };
