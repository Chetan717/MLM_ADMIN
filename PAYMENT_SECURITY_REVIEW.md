# Payment boundary and security review

Implementation date: 13 November 2026. This is a code review and test report,
not a penetration-test certificate or a guarantee against fraud.

## Server authority

The client sends only company ID, stable plan ID, optional coupon, current quote
digest and an opaque idempotency request ID. Extra money/identity fields are
rejected. Firebase signed identity determines the buyer. A fresh server lookup
of the user's company profile binds the company; unpublished company/plan and
duplicate/ambiguous identity records fail closed.

Plan amount, discount, GST, duration, downloads, marketing allocation and
renewal dates come from server records. Financial calculations use integer
paise and basis points; rounding is half-up to a paise. GST is 18% on discounted
taxable value. Marketing commission uses taxable value before GST. A parent's
bonus is the configured percentage of its child's commission, recursively up
to 16 members. Inactive/cyclic hierarchy, invalid percentages, parent-cap
violations and total commission above taxable revenue are rejected.

Order reservation re-reads relevant documents in a Firestore transaction.
Provider POST happens once after reservation, outside transaction retries.
Concurrent requests share the active purchase. An ambiguous POST timeout
requires provider reconciliation; it does not issue another chargeable order.
Immutable purchase snapshots preserve the price a customer agreed to, even
when Admin later edits a plan. Old quotes must be reviewed again after changes.

Signed webhook intake is persisted before acknowledgement; an Eventarc trigger
performs provider verification with retry. Only event names and payment IDs are
stored in this inbox. Unknown orders can also be recovered by exact receipt
lookup; closing a genuinely missing order is Master-only, delayed and audited.

Before fulfilment the server checks owner, stored order ID, HMAC, provider order
receipt/notes, exact INR amount, paid order and captured payment. Merely
authorized or browser-reported success is insufficient. Payment-ID ownership,
subscription creation, entitlement grant, commission ledger and financial
aggregates commit atomically. Duplicate callbacks/webhooks cannot grant twice.

## OWASP Top 10:2025 mapping

| Risk | Implemented control / deployment requirement |
|---|---|
| A01 Broken Access Control | Firebase auth, buyer ownership, company-profile binding, Admin session and tab checks, Master-only reconciliation, mandatory merged server-only Firestore rules |
| A02 Security Misconfiguration | Default-off payment creation, strict mode/key match, exact HTTPS CORS origins, security response headers; configured merchant risk/capture/webhooks required |
| A03 Software Supply Chain Failures | Locked dependency updates, official patched SheetJS distribution, runtime npm audits; scheduled dependency review still required |
| A04 Cryptographic Failures | Secrets in Firebase Secret Manager, server HMAC-SHA256, constant-time digest comparison, TLS-only fixed provider URL, hosted card collection |
| A05 Injection | Bounded input schemas, IDs/decimals/URLs validated, unknown request fields rejected, company fields allowlisted, React text rendering, no user-supplied provider URL |
| A06 Insecure Design | Frozen quotes/orders, explicit capture/activation state, transactional ownership/deduplication, per-user/IP order caps, queued renewal periods, refund revocation |
| A07 Authentication Failures | Signed Firebase mobile identity, seven-day maximum auth age when claim exists, live Admin session expiry/revocation and server-side role checks on sensitive calls |
| A08 Software/Data Integrity Failures | Raw-body webhook signature before JSON parse, signed-body deduplication, provider API reconciliation, immutable payment snapshots, isolated test/live entitlements and totals |
| A09 Security Logging & Alerting Failures | Structured sanitized rejection logs, append-only client-inaccessible payment audit, refund/dispute records, needsReview queue; deploy the included metric/alert with your notification channel |
| A10 Mishandling of Exceptional Conditions | Fail-closed verification, redacted errors, provider timeouts, durable webhook inbox/retry, no blind POST retry, bounded scheduled recovery, manual unknown-order reconciliation |

## Limits and operations

- Per buyer: order creation 8/hour and 20/day; quote attempts 20/hour and
  100/day; verification 60/hour; status 40/hour. Order creation also has IP
  caps of 40/hour and 100/day. Genuine repeated failure payments block new
  order creation for six hours after five failures. An existing hosted order
  also needs Razorpay merchant-side risk/velocity controls.
- CAPTCHA/App Check integration and limited-use tokens have been removed from
  both frontends and payment/Admin callables at the owner's request. There is
  no device/app attestation gate. Firebase signed login, live Admin sessions,
  company/ownership checks, server-side rate limits and payment verification
  remain mandatory; CORS and hidden UI controls are not access checks.
- Card/PAN/CVV data is collected by Razorpay, never these apps/functions.
  The application does not store payment signatures or raw webhook bodies.
- Refund money and commission reversals are monotonic and transactional.
  GST/taxable refund allocation sums exactly to the refunded paise. Any
  refunded/disputed grant is revoked, including partial refunds. Other paid
  periods keep their original dates. Dispute resolution requires support review.
- Test/live purchases, queries, stats and entitlements are isolated; test
  subscription records cannot appear in production subscription queries.
- New grants queue after the latest valid paid period of that company. A
  previous Unlimited plan does not make a later limited plan Unlimited.
- Plan price ceiling including GST: INR 100,000. Minimum payable INR 1;
  zero/100%-discount orders do not silently create free subscriptions.
- Lifetime grant count in a rolling entitlement is bounded to 128. Queued
  terms and invalid/out-of-range expiry values fail safely for support review.

## Firestore read strategy

No new live snapshot listener or background client polling loop was added.
In-memory caches are keyed by verified UID + company and coalesce identical
requests: catalog 60 seconds, history/entitlement 30 seconds. A confirmed
payment invalidates caches. Prices/permissions never rely on cached client data.

| Operation | Bounded work |
|---|---|
| Catalog | Rate-limit transaction + one buyer query (max 2), one profile query (max 3), one company document |
| Quote / order reservation | Same fresh identity/company lookup; optional one coupon query and bounded hierarchy chain; order reservation/lock documents |
| History | At most 21 purchase records + one entitlement; next page only on demand |
| Earlier subscriptions | Separate explicit user action, max 21 legacy records per page; not read on every plans visit |
| Expiry notice | One own-company entitlement + rate-limit transaction; uses shared short cache |
| Admin payments | One aggregate + max 26 purchases; optional cached company directory; no users/subscription collection scan |
| Webhook | One durable inbox create before acknowledgement; bounded provider calls/transactions in background trigger |
| Recovery job | Max 25 due purchases each run, indexed queue and bounded provider calls; no users scan |

Real critical checks consume necessary reads; exact billing also includes
Firestore's minimum-query charges, transaction retries and security-rule reads.
Existing unrelated legacy dashboards retain their older full-collection
reporting behavior; this release does not claim to optimize the entire project.

## Remaining deployment/architecture boundaries

The supplied archives did not include current production rules, the old
external payment server, native app code or user-auth backend. Those cannot be
audited or disabled from this workspace. Merge rules, disable old Admin-SDK
payment writers, finish merchant risk/alert settings and run live
purchase/refund acceptance tests before production activation.

The editor in the uploaded app is deliberately in free-export mode with public
client-rendered assets. Payment integration does not convert that architecture
into a secure paid-content gateway. Legacy subscriptions are available as
historical records; migrating their benefits requires verified payment proofs.

Rate limits and 3DS/provider risk checks reduce abuse; they do not make carding,
fraud, compromised accounts or all infrastructure failures impossible.

References used for implementation:

- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps
- https://razorpay.com/docs/webhooks/validate-test
- https://razorpay.com/docs/api/orders/create
- https://razorpay.com/docs/api/payments/fetch-with-id
- https://top10.owasp.org/2025/0x00_2025-Introduction/
- https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html
- https://docs.sheetjs.com/docs/getting-started/installation/frameworks/
