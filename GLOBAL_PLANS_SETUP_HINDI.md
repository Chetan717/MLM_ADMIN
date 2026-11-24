# MLM LIVE — Global App Plans correction (24 November 2026)

## Plans कहाँ add होंगे

**Admin sidebar → App Plans → Add Plan → Save App Plans**

Company के Add/Edit forms में plans नहीं हैं। पूरे MLM LIVE app के लिए एक central catalog है। किसी भी company का user वही published plans देखेगा। Subscription page खोलने या plan खरीदने के लिए company/profile चुनना जरूरी नहीं है; login जरूरी है। खरीदे हुए नए plans की service validity पूरे app के लिए है।

1. Plan name, amount और duration (days) भरें।
2. Service चुनें: Poster Design, Video Editing Service या Poster + Video Editing Combo।
3. Poster downloads या Unlimited चुनें, description/image चाहें तो जोड़ें।
4. **Published** tick करके **Save App Plans** दबाएं। Unpublished plan users को नहीं दिखता।

Prices hardcode नहीं हैं। Checkout में existing 18% GST server जोड़ता है; discount/commission भी server calculate करता है। User का selected company price या validity नहीं बदलता। Save के बाद users का cached catalog अधिकतम 5 मिनट तक पुराना दिख सकता है; बदली हुई price पर पुराना quote checkout नहीं बना सकता। Reload/refresh से नया catalog लिया जा सकता है।

Master Admin और मौजूदा Companies permission वाले Admin इस page को manage कर सकते हैं। App Plans की अलग tab permission इस release में नहीं बनाई गई है।

## कौन-से corrected files लगेंगे

- `MLM_ADMIN_Global_Plans_24Nov2026.zip`: corrected Admin UI, payment Functions, indexes, full merged `firestore.rules`, tests और setup।
- `MLMLIVE_WEBAPP_Global_Plans_24Nov2026.zip`: corrected Web App checkout और app-wide recovery/history।
- `firestore.rules`: आपके दिए हुए full production rules में payment और central-catalog protections merge हैं। वही file Admin archive के root में है।

इन दोनों corrected archives को पुराने company-wise plan archives की जगह use करें। Dependencies/build output included नहीं हैं; existing environment configuration के साथ fresh build करें।

## Deploy order

### 1. Backend settings और secrets

शुरुआत में `functions/.env.YOUR_PROJECT_ID` में `RAZORPAY_MODE=test` और `PAYMENTS_ENABLED=false` रखें। Included project settings में भी यही flags हैं। अपने existing Firebase project/auth/hosting settings रखें।

Secret Manager में `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` configure करें। `PAYMENT_ALLOWED_ORIGINS` में exact HTTPS App और Admin origins रखें। Frontend में gateway secret नहीं डालना है। बाकी merchant/webhook instructions `RAZORPAY_SETUP_HINDI.md` में हैं।

### 2. Ready full rules और indexes

Admin folder में **`firestore.rules` पहले से मौजूद है**। इस release के लिए `current-production.rules` या rules-installer command चलाने की जरूरत नहीं है। अगर आपके production rules इसके बाद अलग से बदले हैं, deploy से पहले उन बाद के बदलावों को इस full file में preserve करें। `firestore.payment.rules` केवल snippet है; उसे अकेला full replacement न बनाएं।

```bash
firebase deploy --config firebase.payment.deploy.json --only firestore:rules,firestore:indexes
```

Indexes ready होने दें। `appPlans/main` पर client और signed-in Master Admin के direct Firestore reads/writes denied हैं; authorized server callables ही catalog पढ़ते/लिखते हैं।

### 3. Admin dependencies, checks और Functions

```bash
npm ci --legacy-peer-deps
npm --prefix functions ci
npm run test:payments
npm run build
```

Payment API अब company selector स्वीकार नहीं करती। इसलिए नीचे दिए updated payment endpoints और Admin functions साथ redeploy करें, फिर updated frontends release करें। Existing auth/OTP functions हटाने या redeploy-all करने की जरूरत नहीं है।

```bash
firebase deploy --only functions:paymentCatalog,functions:paymentQuote,functions:paymentCreateOrder,functions:paymentVerify,functions:paymentStatus,functions:paymentHistory,functions:paymentLegacyHistory,functions:paymentEntitlement,functions:panelAppPlans,functions:panelSaveAppPlans,functions:panelSavePaymentCompany,functions:panelPaymentOverview,functions:panelReconcilePayment,functions:panelCloseUncreatedPayment,functions:panelAssignPaymentMarketingUsers,functions:panelUpsertMarketingMember,functions:panelUpsertMarketingCoupon,functions:panelDeleteMarketingMember,functions:panelDeleteMarketingCoupon,functions:razorpayWebhook,functions:processRazorpayWebhook,functions:reconcileRazorpayPayments
```

Razorpay test webhook + matching secret, automatic capture, background webhook worker और scheduled reconciliation configure करें। केवल SDK callback/authorized payment से plan activate नहीं होता; server-confirmed captured `paid` जरूरी है।

### 4. App Plans और frontend release

Corrected Admin build को अपने existing Admin host पर deploy करें। **App Plans** में central plans add और publish करें। Catalog empty होने पर users को plans नहीं दिखेंगे; पुराने company plans अपने-आप central catalog में copy नहीं होते।

Web App folder में:

```bash
npm ci --legacy-peer-deps
npm run test:payments
npm run build
```

Fresh `dist` अपने existing Web host पर deploy करें। Region `asia-south1` है। Checkout enable करने के लिए test setup के बाद `PAYMENTS_ENABLED=true` करके payment Functions redeploy करें। वास्तविक devices पर test पूरा होने पर ही live keys/mode/webhook configure करें।

## React Native पर असर

**इस central-plans correction के लिए React Native code में नया बदलाव नहीं है।** Payment Web App शुरू करता है; पहले दिया updated native bridge केवल server-created order को Razorpay SDK में खोलता है। वही bridge इस release के साथ काम करता है। Browser में web checkout चलता है।

अगर अभी भी SDK bridge से पहले वाला पुराना native shell लगा है, पहले दिए `expomlm_Plan_Integration_24Nov2026.zip` का native build जरूरी है। `react-native-razorpay` native dependency के लिए Expo Go/केवल OTA पर्याप्त नहीं है। Native package में `npm ci`, `npm run test:payments`, `npx expo prebuild` और फिर existing EAS/local release workflow use करें; store version/build numbers बढ़ाएं। इस correction में native source/archive दुबारा नहीं बदला गया है।

## पुराने payments और benefits

- पुराने company catalog records सुरक्षित रहते हैं, पर नए quotes/prices उनके आधार पर नहीं बनते।
- पहले secure Razorpay integration से paid purchases के trusted grants पहली जरूरत पर app-wide ledger में एक बार migrate होते हैं। बची हुई allowance, original dates और revoked flags preserve होते हैं; test/live अलग हैं। नई renewal उसी service के valid paid period के बाद queue होती है।
- यह automatic migration केवल verified paid purchase + उसके trusted ledger पर लागू है। पुराने PSERVER/manual/client-written subscription rows history में दिखते हैं; उनके benefits के लिए payment proof देखकर controlled migration जरूरी है।
- One-time paid-purchase scan 100 records तक bounded है; उससे ज्यादा पुराने records हों तो support-assisted migration मांगी जाती है।
- पुराना unresolved checkout नए app-wide order को रोकता है। उसी payment को **Check payment** से recover करें; cancel/pending/verification failure success नहीं बनते। App restart पर saved checkout भी recover होता है।
- Poster, Video और Combo grants अलग services हैं। Video-only plan poster downloads नहीं देता। Raw-video upload/editor/service delivery इस correction में नहीं बनाया गया है।
- Existing free-export editor policy को इस correction में paid-only नहीं बनाया गया है। Central plan purchase/access ledger तैयार है; future protected operations server-side entitlement check use कर सकते हैं।

## इस correction की validation

- Admin और Web production builds: passed।
- Backend payment/domain/HTTP/rules-installer/UUID checks: 22 passed।
- Admin navigation checks: 4 passed।
- Firestore payment integration: 31 passed; provider API mocked थी।
- Web client payment checks: 13 passed।
- Actual Admin App Plans DOM add/save/remove checks: passed; `randomUUID` unavailable case भी passed।
- Actual Web checkout DOM checks: cancel/pending, restart recovery, verification failure, verified success और unsupported old shell handling passed; provider responses mocked थीं।
- Full merged production Firestore rules regression: 15 passed।

Production deploy, real merchant transaction या physical-device/APK/IPA test इस workspace से नहीं किया गया है।
