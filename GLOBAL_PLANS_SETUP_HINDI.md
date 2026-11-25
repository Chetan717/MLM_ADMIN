# MLM LIVE Plans / Checkout / Invoice update — 25 November 2026

## इस update में

- Bottom tab bar में Home, Plans, Ask AI और Profile हैं। Desktop sidebar में Plans है।
- Plans, plan details sheet, My plan, purchase history, verified success और failed/pending screens को supplied images की blue/white/gold style में बनाया है। Images के example categories, amounts, savings, benefit promises या payment logic copy नहीं किए हैं।
- Catalog central `appPlans/main` से ही आता है। Amount, duration, service और actual credit balance Admin/backend से आते हैं।

## दोबारा खरीदने का नियम

| ग्राहक की valid service | खरीदने के लिए दिखाई देंगे |
| --- | --- |
| कोई service नहीं | Poster, Video और Combo के published plans |
| सिर्फ Poster | केवल Video plans |
| सिर्फ Video | केवल Poster plans |
| दोनों services / valid Combo | Buy list नहीं |

Expiry या applicable credits zero होने पर उस service के plans वापस उपलब्ध होते हैं। Combo तभी मिलेगा जब दोनों services खरीदने के लिए available हों। Unlimited Poster plan credits zero होने से expire नहीं होता। पुराना validity-only Video plan अपनी expiry तक valid रहता है। पहले से paid scheduled grants भी ownership में गिने जाते हैं।

यह रोक केवल UI filter नहीं है: quote और order reservation में server checks हैं। Stale quote, direct request और concurrent orders भी duplicate service checkout नहीं बना सकते। एक pending checkout का वही order recover होता है। पहले से बने genuine pending/captured payments का verification/refund path सुरक्षित रखा है।

## Admin में credits

App Plans में Poster downloads / Unlimited पहले की तरह हैं। Video/Combo में optional **Video editing credits** field है। खाली रखने पर video access validity-based रहता है; number देने पर वह initial video credit allowance है। Published limited Poster/Combo plan में positive poster credits या Unlimited जरूरी है, ताकि zero-benefit paid order न बने।

Balance source server-owned entitlement ledger है। Existing free poster export policy को इस update में paid-only नहीं बनाया है, और नया raw-video upload/delivery या credit-consumption workflow नहीं बनाया है। Existing/future trusted service backend को delivered work के अनुसार balance update करना है; client को balance लिखने की permission नहीं दी गई है। खरीद की रोक expiry और उपलब्ध trusted balance दोनों को मानती है।

## Razorpay interaction fix

App checkout sheet को Razorpay खोलने से पहले पूरी तरह unmount किया जाता है। उसके focus handlers और body scroll lock पहले हटते हैं; उसके बाद gateway iframe/native SDK खुलता है। `payment.failed` attempt event पर app sheet को खुले हुए gateway के ऊपर वापस नहीं लाया जाता। Cancel, debit uncertainty और verification errors success नहीं बनते।

## Customer invoice

Verified payment के बाद success screen, My plan और purchase history में **Download invoice** है। `paymentReceipt` callable signed-in owner और test/live mode verify करके stored purchase से data देता है। Pending/unpaid purchase के लिए invoice नहीं मिलता। Invoice में MLM LIVE name, customer/mobile, plan, payment date, amount, discount/GST breakdown, method, order/payment references और refund status हैं।

PDF लगभग 105 mm wide, one-page receipt है; लंबे names/references के लिए height बढ़ती है। Unicode/Hindi names device canvas font shaping से PDF में जाते हैं। यह payment acknowledgement है; seller GSTIN या legal tax-invoice details invent नहीं किए गए हैं। Browser PDF download करता है। Android updated native shell का existing DOWNLOAD_PDF handler और iOS existing share/save handler use होते हैं। इस update के लिए native source में बदलाव नहीं है।

## Deploy — existing configuration बचाएं

1. Latest Admin और Web App archives fresh download करें। Archives का filename 24Nov2026 वाला ही है; इस version के अंदर 25 November update मौजूद है। अपने actual origins, existing Firebase settings और other environment values preserve करें। Secret Manager values को rotate करने की जरूरत नहीं है।
2. Update के दौरान `functions/.env.mlmbooster-a4887` में `PAYMENTS_ENABLED=false` रखें और `RAZORPAY_MODE=test` ही रहने दें। नीचे का loop पहले order creation बंद करेगा और फिर बाकी updated functions एक-एक करके deploy करेगा।

Admin root में:

```bash
npm ci --legacy-peer-deps
npm --prefix functions ci
npm run test:payments
npm run build

for fn in \
  paymentCreateOrder \
  paymentVerify \
  paymentStatus \
  processRazorpayWebhook \
  reconcileRazorpayPayments \
  paymentCatalog \
  paymentQuote \
  paymentHistory \
  paymentLegacyHistory \
  paymentEntitlement \
  paymentReceipt \
  panelAppPlans \
  panelSaveAppPlans \
  panelSavePaymentCompany \
  panelPaymentOverview \
  panelReconcilePayment \
  panelCloseUncreatedPayment \
  panelAssignPaymentMarketingUsers \
  razorpayWebhook
do
  firebase deploy --project mlmbooster-a4887 --only "functions:$fn" || break
done
```

यह loop CPU-quota वाले bulk deployment की जगह sequential deployment करता है। किसी function पर error आए तो वहीं रुकता है। Success verify करके ही आगे जाएं। Existing auth/OTP functions को delete या deploy-all न करें।

3. Web App folder:

```bash
npm ci --legacy-peer-deps
npm run test:payments
npm run build
```

Corrected Admin और Web App दोनों अपने existing hosts पर deploy करें। Existing database rules/indexes इस update में नहीं बदले गए हैं। Fresh install हो तो included full `firestore.rules` और indexes पहले deploy करें; `firestore.payment.rules` snippet अकेले deploy नहीं करना है।

4. Admin → App Plans में service/amount/validity/credits verify करके Save करें। पुराने validity-only video plans को कोई guessed credit limit नहीं दी गई है।
5. जब सभी functions और दोनों frontends updated हों, `.env.mlmbooster-a4887` में `PAYMENTS_ENABLED=true` करके केवल यह redeploy करें:

```bash
firebase deploy --project mlmbooster-a4887 --only functions:paymentCreateOrder
```

TEST keys/mode और matching webhook secret रखें। Website को hard-refresh करें। Verify करें: Plans tab; only eligible service visible; gateway bank/continue clicks; cancel pending; one verified success; PDF invoice; duplicate purchase blocked; refresh/restart same order। Real device पर UPI switching, native PDF save/share और refund भी validate करें। उसके बाद ही live mode rollout करें।

## Validation

- Admin + Web production builds passed.
- Backend domain/HTTP/rules/UUID checks: 24 passed.
- Firestore payment integration: 38 passed, provider API mocked.
- Web client/eligibility/invoice checks: 18 passed.
- Actual React DOM scenarios: 8 passed — actual Plans tab navigation; gateway interaction/focus/no overlay; cancel/restart; rejected signature; verified success with PDF bridge; Poster/Video/Combo filtering; unsupported old shell; terminal failure without invoice or unverified debit promises.
- Full production rules are unchanged from the previously verified merged rules. No complete unrelated-feature regression suite or dependency audit was rerun.

Physical device, real Razorpay iframe/bank transaction and pixel-level browser QA were not executed here. The local browser binary was unavailable and its download was blocked; DOM tests exercise actual components with a mock gateway. Production deployment has not been performed from this workspace.
