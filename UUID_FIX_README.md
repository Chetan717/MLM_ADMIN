# Admin UUID compatibility fix — 24 Nov 2026

Fixes: AddCompanies.jsx: crypto.randomUUID is not a function.

Apply this patch inside your EXISTING MLM_ADMIN folder (the folder containing package.json).
The archive has src/ and tests/ at its root. Replace the two Company form files and include
the new src/Utils/createPlanId.js helper. Do not extract inside src itself.

For local development: stop the current dev server, start npm run dev again, then hard-refresh
the browser with Ctrl+Shift+R. For a deployed Admin: run npm run build and deploy the new dist.

Only new plan ID creation in AddCompanies/EditCompanies changed. Existing saved plan IDs
continue to be used. No dependency install, Firebase function update or Rules update is required
for this frontend patch.

Browser support: randomUUID when available; otherwise cryptographic getRandomValues UUIDs.
For public non-secret plan identifiers only, a time/counter/random identifier is available if
there is no Web Crypto API. This helper is not a source of payment signatures or auth tokens.

Validation: four compatibility/regression tests passed, including actual form defaults with
randomUUID missing and with crypto completely absent; Admin production build passed.
To run the included tests: node --test tests/createPlanId.test.mjs
