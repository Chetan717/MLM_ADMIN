# Validation — Plans UI / eligibility / invoice, 25 November 2026

| Check | Result |
| --- | --- |
| Backend payment domain, HTTP, installer and UUID | 24/24 pass |
| Firestore payment integration | 38/38 pass; Razorpay provider mocked |
| Web client, eligibility and PDF/bridge units | 18/18 pass |
| Actual React DOM scenario groups | 8 pass |
| Admin production build | Pass |
| Web production build + R2-only assertion | Pass |

Backend cases cover independent Poster/Video ownership, Combo conflicts, stale
quotes, forged direct orders, concurrent different-plan requests, exact expiry,
credit exhaustion, unlimited/time-only plans, legacy migration and invoice
owner/mode checks. They retain signature/amount/currency/capture/refund/race and
pending-bank recovery coverage. A zero-benefit published Poster plan and an
unfulfillable full ledger are refused before creating a payable provider order.

DOM cases exercise the actual bottom tab and subscription components. The mock
gateway bank/continue controls receive clicks and retain focus with the app
sheet unmounted. A failed-attempt event does not restore an overlay onto the
still-open gateway. Cancellation/verification rejection never activate a plan;
verified success downloads an invoice through the existing native PDF bridge;
active ownership hides overlapping buy options; unsupported native shell and
server-confirmed failure are handled without fake success/debit promises.

PDF units verify actual amount/reference content, one-page output with long
fields and the Android/iOS bridge payloads. Physical native file permissions,
real Razorpay UI, real payments/UPI switching and pixel-level browser QA remain
deployment acceptance checks. The browser binary/download was unavailable.

No production deployment or real payment was performed. Unrelated full suites,
full merged-rule tests and dependency audits were not rerun for this update.
Rules/indexes and native source are unchanged. See PLANS_UI_UPDATE_HINDI.md.
