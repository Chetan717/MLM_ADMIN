# Payment validation — Global App Plans, 24 November 2026

The final source was checked locally. Provider API responses were simulated;
there was no production deployment, real payment or physical-device test.

| Check | Result |
| --- | --- |
| Corrected Admin production build | PASS |
| Corrected Web production build / R2-only check | PASS |
| Admin payment domain, HTTP, installer and UUID tests | 22/22 PASS |
| Admin navigation retention tests | 4/4 PASS |
| Firestore payment integration tests | 31/31 PASS |
| Full merged production rules regression | 15/15 PASS |
| Web payment client tests | 13/13 PASS |
| Actual central App Plans DOM add/save/remove interactions | PASS |
| Actual Web checkout DOM recovery/verification interactions | PASS |

The central catalog tests use different/no company profiles and different old
company prices. All receive the same global catalog and quote. A purchase and
same-service renewal keep app-wide validity when the profile changes. Tests
also exercise optimistic Admin catalog versions, permission/session checks,
server-only direct catalog writes, company metadata saving without plan writes,
trusted legacy allowance/date migration, legacy-refund revocation, unresolved
old-order duplicate protection and strict test/live status isolation.

The existing integration cases also cover server price calculation, identity
and signature tampering, exact provider amount/currency/order capture, concurrent
order/callback/webhook handling, provider-create timeouts, duplicate failures,
refunds, Video/Combo service grants and pending bank payments without false
success. Web unit/DOM cases cover durable request reuse, account changes,
mode isolation, old company draft recovery, secure IDs without randomUUID,
unsupported old WebView handling, cancellation and verification failures.

Full merged rules checks retain Marketing assigned-user/coupon/dashboard reads
and Portal Users edits; normal user profile/name/download writes; template CRUD,
Task Management, reports, Expense and Popup behavior. Financial/identity/catalog
forgeries, revoked sessions, cross-user subscriptions and unknown collections
remain denied. Expected PERMISSION_DENIED logs are assertions in these tests.

No complete App/Admin unrelated-feature regression suite or dependency audit
was rerun for this correction. Prior baseline diagnostics are not reported as
current results. DOM checks use the actual React components with mocked APIs;
they do not verify final device layout, real Razorpay UI or UPI switching.

After deployment, validate Firebase auth, index readiness, Eventarc retry,
Razorpay automatic capture/webhooks, real device restart/UPI switching, a merchant
purchase and refund. Both corrected frontends and payment endpoints must be
released together because payment requests no longer accept companyId.
