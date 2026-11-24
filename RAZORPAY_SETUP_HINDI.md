# MLMLIVE Razorpay — App + Admin setup

Is release mein code implementation hai. Production par deploy, merchant keys,
real bank/card transaction is workspace se nahi kiye gaye. App aur Admin mein
CAPTCHA/App Check integration nahi hai. Neeche ka setup complete hone tak PAYMENTS_ENABLED=false rakhein.

## 1. Existing configuration bachayein

- Dono source projects ke apne existing Firebase/Vercel environment values rakhein.
  ZIP mein production `.env`, private keys, `node_modules` aur compiled `dist`
  intentionally include nahi hain. Apne environment se dobara build karein.
- App aur Admin same Firebase project use karein. User auth ke existing
  us-central1 functions ko replace nahi karna hai. Naya payment backend
  Admin project ke `functions/` se asia-south1 mein deploy hota hai.
- Backend existing collection names use karta hai: `users`, `mlmprofiles`,
  `mlmcomp`, `couponcode`, `mteam`, `subscription`. Frontend VITE_COL_* values
  in names se match honi chahiye. Agar aapne collection names badle hain,
  backend aur rules ka mapping bhi deployment se pehle badlein.
- Purane `VITE_PSERVER_URL`, `VITE_PSERVER_API_KEY` aur `VITE_RAZORPAY_KEY_ID`
  checkout mein use nahi hote. Inhe frontend se remove karein. **Purane payment
  server/order/verify endpoints ko disable karein aur unki exposed credentials
  rotate/revoke karein.** Unka server source in uploads mein nahi tha; kisi
  doosre Admin SDK writer ko Firestore client rules nahi rok sakte.

## 2. Dependencies aur local checks

Node 24 aur Firebase CLI use karein.

```bash
# Admin folder
npm ci --legacy-peer-deps
npm --prefix functions ci
npm run test:payments
npm test
firebase emulators:exec --only firestore --project demo-mlmlive-payment --config firebase.payment-test.json "node --test tests/payment.integration.mjs"
npm run build

# App folder
npm ci --legacy-peer-deps
npm run build
```

SheetJS ka patched official 0.20.3 package official CDN se lock hua hai. Normal
`npm install xlsx` karke purana 0.18.5 wapas install na karein. Dependency locks
commit/retain karein; production builds mein `npm ci` use karein.

## 3. Frontend — CAPTCHA setup nahi karna hai

App aur Admin se CAPTCHA/App Check initialization aur token requirements hata
diye hain. CAPTCHA site key, secret, debug token ya IAM token-verifier role ka
setup is payment flow ke liye nahi chahiye. Firebase login aur Admin session
permissions required rahenge.

App ke existing environment mein bas payment region rakhein:

```dotenv
VITE_PAYMENT_FUNCTIONS_REGION=asia-south1
```

Admin ka existing `VITE_FUNCTIONS_REGION=asia-south1` rahe. Pehle add kiye
`VITE_FIREBASE_APPCHECK_SITE_KEY` aur `VITE_APPCHECK_DEBUG_TOKEN` App/Admin
ke local aur hosting environment se hata sakte hain. Uske baad dono ko fresh
build/deploy karein. Firebase Console mein bani key delete karna zaroori nahi.

Purana App Check-enforced payment backend deploy hua hai to step 6 se updated
functions redeploy karna compulsory hai. Sirf frontend badalne se purane backend
checks nahi hatenge. Agar aapne manually Firebase Console mein Firestore, Storage
ya Authentication ke liye App Check **Enforce** kiya tha, un affected services ko
**Unenforced** karein, warna token na bhejne wale updated clients block honge.
Firebase Authentication aur Firestore Security Rules enabled hi rakhein.

24 Nov plan integration mein separate expomlm package mein native Razorpay bridge bhi diya gaya hai.
Updated native build aur setup ke liye PLAN_INTEGRATION_SETUP_HINDI.md padhein; device par UPI app-switch test karein.

## 4. Razorpay secrets aur backend flags

Pehle Razorpay TEST mode keys use karein. Keys Firebase Secret Manager mein:

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
```

Webhook secret API key secret se alag, random aur private rakhein. Backend ke
`functions/.env.YOUR_FIREBASE_PROJECT_ID` mein existing settings ke saath add karein:

```dotenv
RAZORPAY_MODE=test
PAYMENTS_ENABLED=false
PAYMENT_ALLOWED_ORIGINS=https://app.mlmlive.in,https://YOUR_ACTUAL_ADMIN_DOMAIN
```

Origins exact HTTPS origins hon, trailing slash/path nahi. Actual Admin host
zaroor set karein. Key prefix mode se match hona chahiye, e.g. test key ke saath
RAZORPAY_MODE=test. Wrong mode/key combination fail closed hota hai.

## 5. Firestore rules — compulsory

Uploaded Admin ZIP mein full production Firestore rules nahi the. Isliye
`firestore.payment.rules` ko akela production replacement ki tarah deploy na
karein: woh unrelated app modules ko default-deny karega.

Firebase Console se current full rules ko `current-production.rules` naam se
export/save karein. Phir:

```bash
node tools/install-payment-rules.mjs current-production.rules firestore.rules
```

Installer payment, subscription, company, identity, coupon, marketing aur
session collection blocks ko secure versions se replace karta hai. Unrelated
named collection rules bachata hai. Agar broad wildcard allow rule payment
collections ko cover karta hai, installer **refuse** karega. Us wildcard ko
explicit non-payment collection rules mein scope karein, phir rerun karein.
Firestore mein allow rules OR hote hain; deny block add karna broad allow ko
override nahi karta. Generated full rules review/test karna zaroori hai.

New client restrictions:

- Subscription/payment/commission/totals/log/session/credential writes server-only.
- Company create/update, including plan prices, only panelSavePaymentCompany.
- Coupon/marketing writes existing authenticated Admin callables se.
- User apna coupon, UID, mobile, credits ya financial fields change nahi kar sakta.
- Existing profile ka company ID direct update nahi ho sakta; normal profile
  deletion/recreation flow remains available.
- Direct user subscription queries mobile-filtered aur max 50 records hon.
- `users` ke unrelated custom editable fields hon to explicit safe whitelist
  extend karein; identity/credits/attribution fields ko editable na banayein.

Rules + indexes pehle deploy karein:

```bash
firebase deploy --config firebase.payment.deploy.json --only firestore:rules,firestore:indexes
```

Indexes ready hone dein. TTL policies `_paymentLimits.expiresAt` aur
`_razorpayWebhookEvents.expiresAt` aur `_razorpayWebhookInbox.expiresAt` included hain. Payment-ID ownership documents
ko delete/TTL na karein: permanent deduplication un par depend karti hai.

## 6. Sirf nayi payment Functions deploy karein

```bash
firebase deploy --only functions:paymentCatalog,functions:paymentQuote,functions:paymentCreateOrder,functions:paymentVerify,functions:paymentStatus,functions:paymentHistory,functions:paymentLegacyHistory,functions:paymentEntitlement,functions:panelSavePaymentCompany,functions:panelAssignPaymentMarketingUsers,functions:panelUpsertMarketingMember,functions:panelUpsertMarketingCoupon,functions:panelDeleteMarketingMember,functions:panelDeleteMarketingCoupon,functions:panelPaymentOverview,functions:panelReconcilePayment,functions:panelCloseUncreatedPayment,functions:razorpayWebhook,functions:processRazorpayWebhook,functions:reconcileRazorpayPayments
```

Existing auth/OTP functions ko delete ya redeploy-all karke replace na karein.
No existing user-auth source was supplied in these archives.

## 7. Webhook aur merchant settings

Razorpay Dashboard > Webhooks:

- URL: `https://asia-south1-YOUR_FIREBASE_PROJECT_ID.cloudfunctions.net/razorpayWebhook`
- Secret: Firebase RAZORPAY_WEBHOOK_SECRET ke bilkul same value.
- Events: payment.captured, order.paid, payment.failed, refund.processed,
  payment.dispute.created, payment.dispute.lost, payment.dispute.won,
  payment.dispute.closed; apne account mein available dispute events select karein.
- Payment Capture: **automatic capture** configure karein. Sirf authorized
  payment se subscription activate nahi hota.
- Merchant account activation/KYC, allowed methods, fraud/risk controls,
  card velocity limits aur alerts Razorpay Dashboard mein configure karein.
  Browser retry limit security boundary nahi hai. Account/UID/IP limits aur Razorpay risk controls abuse ko reduce karte hain; fraud impossible guarantee nahi hai.

Webhook pehle signed event ko durable inbox mein save karke acknowledge karta hai.
processRazorpayWebhook trigger background verification karta hai; failure par
Eventarc retry hota hai. Trigger deploy karna compulsory hai.

Webhook validation original raw bytes par hoti hai; handler ke aage body ko
re-serialize na karein. Webhook endpoints par Firebase user login nahi lagta: provider HMAC verification mandatory hai. Key/webhook-secret rotation ke
waqt pending orders aur provider retry window plan karein. Old-key purchases
new key se verify nahi honge; original-key reconciliation required hai.

## 8. Test mode se live

1. PAYMENTS_ENABLED=true (RAZORPAY_MODE=test) karke paymentCreateOrder function
   redeploy karein. App aur Admin ko apne production/test env se build/deploy karein.
2. Selected company, inactive plan, coupon, failed payment, cancel, captured
   payment, double click, app restart, duplicate webhook aur refund test karein.
3. Admin > Razorpay Payments mein exact price/GST/commission aur reconciliation
   check karein. App receipt/payment history check karein.
4. Live keys aur live webhook secret Secret Manager mein set karein;
   RAZORPAY_MODE=live set karke payment functions redeploy karein. Live Dashboard
   par webhook bhi separately configure karein. Real small purchase/refund verify
   karne ke baad users ko release karein.

Test and live orders/history/totals/entitlements alag hain. Test subscriptions
`paymentTestSubscriptions` mein jaate hain, production `subscription` mein nahi.

## 9. Support aur recovery

- App: Payment history > Check payment. Server capture confirm karega; UI ko
  manually paid mark karne ka option nahi hai.
- Admin > Razorpay Payments > Details > Reconcile with Razorpay (Master Admin).
- Provider order-create timeout ke baad automatic POST retry nahi hota. Status
  `creation_unknown` hoga. Check payment receipt se original order automatically
  dhoondhta hai. Zarurat par original Razorpay order ID Dashboard se nikal kar Admin
  details mein paste karein; server amount, receipt, purchase notes aur owner
  binding verify karega. Agar provider par order bana hi nahi ho, Master Admin
  minimum ek ghante baad reason ke saath Close uncreated checkout use kar sakta
  hai. Server provider receipt search dobara karta hai; matching order milne par
  closure reject hota hai. Blindly second payment na lein.
- Scheduler har 15 minutes max 25 due records process karta hai. Pending orders
  48h tak, active paid orders daily check hote hain. No-order/exception records
  `needsReview` flag lete hain. Admin ko unresolved records review karne hain.
- Partial/full refund se affected purchase grant revoke aur money/commission
  reversal idempotently update hota hai. Dispute events fail closed hold karte
  hain. Won/closed dispute par automatic access restore intentionally nahi hota;
  support review required hai. Refund amount provider se fetch hota hai.
- Purchase ke waqt expired checkout ID ko dobara charge nahi karte. Provider
  orders native expiry guarantee nahi dete; delayed but genuine captured payment
  ko webhook honour karta hai. Isliye late-capture notifications enabled rakhein.

## 10. Existing app behavior aur legacy data

Existing editor source free-export mode mein tha. Yeh release payment accounting
aur server-owned subscription records integrate karta hai; free editor policy
ko silently paid-only nahi banata. Public assets/client-side canvas export ko
browser code se unbreakable paywall nahi banaya ja sakta. Paid-only export chahiye
to protected assets/server rendering aur server-side usage authorization ka
separate rollout chahiye.

Legacy subscriptions App > Payment history > View earlier subscriptions par
on-demand read hoti hain. Unverified legacy client-written records ko naye
trusted entitlements mein automatically convert nahi kiya gaya. Existing legacy
subscriber ka remaining period carry forward karne se pehle Admin ko original
payment proof verify karke controlled migration karni hogi. Naye verified
Razorpay renewals same-company paid periods ke baad queue hote hain.

Receipt payment acknowledgement hai, GST tax invoice nahi. GST 18% discount ke
baad apply hota hai, jaisa existing checkout mein tha; merchant tax registration
aur invoice requirements alag se configure karein.

Exact security coverage, read costs aur remaining limits PAYMENT_SECURITY_REVIEW.md
aur test evidence PAYMENT_VALIDATION.md mein hai.
