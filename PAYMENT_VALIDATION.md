# Payment validation — 13 November 2026

Implementation was tested locally using synthetic data and a mocked Razorpay
provider. No real payment, production deployment or external customer message
was performed.

| Check | Result |
|---|---|
| App production build | PASS; R2-only asset check passes |
| Admin production build | PASS |
| Payment domain, HTTP webhook intake and rules installer tests | 13/13 PASS |
| Real Firestore Emulator payment/security integration tests | 20/20 PASS |
| App read-cache concurrency tests | 3/3 PASS |
| Full Admin regression suite | 141/141 PASS |
| Full App regression suite | 175/209 PASS; same 34 failures as original uploaded source |
| Runtime dependency audit: App / Admin / Functions | 0 known advisories each, npm audit --omit=dev |
| Actual React component DOM interaction checks | PASS using mocked APIs |

## Payment cases exercised

- App/Admin callable HTTP requests without App Check tokens reach Firebase
  authentication and reject missing login. Signed-in App catalog/quotes and
  authorized Admin assignment work without attestation; wrong-company, missing
  permissions, revoked and expired Admin sessions are rejected.
- Authenticated mobile/account and selected company binding; unpublished plans.
- Server-only paise calculation, discount, 18% GST and marketing hierarchy.
- Extra price/identity fields, inactive coupons and stale quotes rejected.
- Concurrent order requests issue one provider POST outside transaction retries.
- Order-create timeout recovery through signed webhook and exact receipt lookup.
- Authorized-only payment cannot activate; captured payment uses frozen terms.
- Forged signature, wrong buyer/order, altered amount/currency rejected.
- Callback/webhook races activate once and account money/commission once.
- Partial/full refund and refund-before-activation revoke benefits and do not
  re-activate after an old captured notification; exact tax/refund paise totals.
- Same-company renewal queues after the current paid period and is idempotent.
- Test transactions never appear as production subscription benefits or money.
- Kill switch, key/mode mismatch, auth age and rate limits fail closed.
- Master-only closure of truly uncreated orders is delayed and audited.
- Duplicate failure events count the same failed payment once.
- Genuine Admin lead assignment works through the new server-owned attribution
  callable and rejects injected coupon values/unauthorized roles.
- Direct Firestore financial/plan/identity writes fail, even for a signed-in
  Master Admin; own-user subscription queries remain bounded and private.
- Raw webhook bytes are HMAC-checked before intake; altered event-ID headers do
  not bypass durable deduplication. No card details/raw body are persisted.
- Catalog/history cache coalescing, UID/company isolation, refresh and payment
  invalidation cannot be overwritten by slower stale requests.

React DOM checks cover the Plans tab, quote, server-paise checkout, single-order
submission, confirmed success, verification-error recovery, receipt action and
Admin payment details. Browser screenshot QA was unavailable in this execution
environment; these DOM checks do not verify final mobile visual layout.

## Remaining acceptance checks

Production Firebase authentication, Eventarc delivery/retry, live indexes and merged production rules must be checked
after deployment. Test the actual WebView, UPI app switch, real Razorpay purchase,
automatic capture, delayed webhook, refund and dispute notifications with your
merchant account. No live card/UPI transaction was possible without merchant
configuration, and no guarantee of hack-proof/card-fraud-free operation is made.

Admin and App builds show existing bundle-size warnings; the App also has an
existing duplicate translation-key warning. These are not payment-test failures.
The App baseline suite has 34 failures already present in the uploaded archive;
none were added by this release. They were left outside this payment scope:

- Capping uses one responsive horizontal rectangle card
- Domestic Trip is loaded live from Firestore across Home, View All, and Editor
- Editor limits successful image/video download attempts to 10 per day
- English is the base UI language and crop labels remain translatable
- Everyday Moments uses one nameless showcase tile per type in a 3-column grid
- Everyday View All virtualizes off-screen preview images and subtype rows
- Home keeps special layouts and applies the new default tile dimensions
- Income crop result is pushed into the live template instead of leaving a stale saved image
- Latest Update is a first general group directly below Festival on Home
- Latest Update stays a live General editor flow across View All and Editor
- Product is an MLM template type above Motivational and routes directly to Editor
- Production defaults point at customer Cloudflare domains
- all seven supplied coupons select their team's WhatsApp number
- all shared and profile headers use the Home gradient
- both rank and profile hints dismiss on successful flip
- both selected frames use resilient canvas loader rather than thumbnail img
- bundled company logos keep both slots and sizes, and local assets resolve on nested routes
- damaged or blocked storage cannot break login or route to another account
- empty editor video tab hides the design and shows the exact unavailable message
- existing login user data survives a fresh app session without a network call
- first-use quality model does not block indefinitely
- hand visual is animated in theme blue but respects reduced motion
- hint is HTML outside Konva Stage and outside exports
- home card rail keeps a small screen-edge inset and Capping is responsive 16:9
- home cards are inset, compact, one-line, and overflow labels auto-pan only when needed
- image uploads allow exactly 20 MB and reject anything larger
- live preview receives Meeting, Achievement and Income auxiliary form data
- main form uses square live preview and full-screen crop/remove-bg flow
- only the Everyday Moments heading opens the complete grouped View All flow
- quality engine prefers BiRefNet and only capability-falls back to MODNet
- remove background routing is client-only with no VPS inference path
- saved Miss achiever names are parsed and preserved
- single vertical scroll optimization is scoped to Everyday Moments only
- tests/festivalEditorCostOptimization.test.mjs
