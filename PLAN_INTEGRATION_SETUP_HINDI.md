# MLMLIVE Plan Integration — 24 November 2026

तीनों source projects में पहले तय किया हुआ plan integration किया गया है। Existing company plans के दाम, duration, download allowance और commission percentages को hardcode या बदलकर नया price नहीं बनाया गया है। Admin में जो plans और rates configure होंगे, backend उन्हीं से checkout calculate करेगा।

## क्या जोड़ा / ठीक किया गया

| हिस्सा | व्यवहार |
| --- | --- |
| Web App | पुराने PSERVER checkout की जगह authenticated Firebase payment callables, asia-south1 |
| रकम | Server quote; discount और मौजूदा GST calculation integer paise में; browser amount/mobile/commission स्वीकार नहीं होते |
| Success | सिर्फ server-confirmed `paid`; valid signature + matching order/amount/currency + captured provider payment |
| Cancel / bank pending / verification error | Success नहीं; pending message, order reference, Check payment और उसी checkout को resume करने का विकल्प |
| App बंद / response lost | UID/company scoped durable request ID; वही request/order recover; दूसरी purchase बनाकर retry नहीं |
| React Native | Trusted app origin से native Razorpay SDK bridge; native callback के बाद भी server verification अनिवार्य |
| Plans | Poster Design, Video Editing Service और Poster + Video Editing Combo |
| Renewals | हर service की validity अलग; उसी service का अगला grant उसकी पिछली expiry के बाद शुरू होता है |
| Video-only | Poster downloads नहीं देता; live video record `paymentVideoSubscriptions` में; service access `paymentEntitlements.services.video` में |
| Combo | एक payment, दो service grants; दोनों की स्वतंत्र renewal dates; refund/dispute दोनों grants revoke करता है |
| Reads | Catalog 5 मिनट memory cache, concurrent requests coalesce, history pagination, कोई subscription snapshot listener नहीं; resume checks throttle |

Video editing का actual raw-video upload/editor/service-delivery module इस change में नहीं बनाया गया है। उसका future server-side access check `paymentEntitlement` के `services.video` से जोड़ा जा सकता है।

Existing template/editor/profile/download/other feature files इस काम में नहीं बदले गए हैं। पुराने subscription records server से bounded legacy history के रूप में दिखते हैं; client expiry flags या subscription/payment logs नहीं लिखता। Existing legacy subscriptions का entitlement migration इस release में नहीं किया गया है; नए secure-payment grants अपने service ledger में renew होते हैं।

## Files

- `MLM_ADMIN_Plan_Integration_24Nov2026.zip`: Admin UI + Firebase payment backend + rules snippet/indexes + tests.
- `MLMLIVE_WEBAPP_Plan_Integration_24Nov2026.zip`: Web App source + integrated checkout + recovery/cache tests.
- `expomlm_Plan_Integration_24Nov2026.zip`: React Native source + native SDK bridge + updated package lock + bridge tests.

हर ZIP में `PLAN_INTEGRATION_SETUP_HINDI.md` और `PLAN_CHANGE_MANIFEST.json` हैं। `node_modules`, generated build folders और emulator logs नहीं हैं। अपने existing production environment values इस्तेमाल करके fresh build बनाएं। मूल uploads सुरक्षित रखे गए हैं।

## Setup / deploy order

1. Admin के `functions/.env.YOUR_PROJECT_ID` में पहले `RAZORPAY_MODE=test` और `PAYMENTS_ENABLED=false` रखें। Included project config में भी payments disabled रखा गया है, ताकि setup पूरा होने से पहले checkout enable न हो। App और Admin उसी existing Firebase project को use करें।
2. Firebase Secret Manager में `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` configure करें। `PAYMENT_ALLOWED_ORIGINS` में अपने exact HTTPS App/Admin origins रखें। Frontend में Razorpay key secret या PSERVER API key की जरूरत नहीं है।
3. Existing FULL production Firestore rules export करें। `firestore.payment.rules` को अकेला full replacement बनाकर deploy न करें। Admin folder में merge करें:

```bash
node tools/install-payment-rules.mjs current-production.rules firestore.rules
firebase deploy --config firebase.payment.deploy.json --only firestore:rules,firestore:indexes
```

Generated merged rules review करें। New `paymentVideoSubscriptions` server-only boundary भी merge होती है। Indexes ready होने दें।

4. Admin folder में dependencies और builds:

```bash
npm ci --legacy-peer-deps
npm --prefix functions ci
npm run test:payments
npm run build
```

केवल payment functions redeploy करें; existing auth/OTP और दूसरे modules को redeploy-all करके replace न करें:

```bash
firebase deploy --only functions:paymentCatalog,functions:paymentQuote,functions:paymentCreateOrder,functions:paymentVerify,functions:paymentStatus,functions:paymentHistory,functions:paymentLegacyHistory,functions:paymentEntitlement,functions:panelSavePaymentCompany,functions:panelPaymentOverview,functions:panelReconcilePayment,functions:panelCloseUncreatedPayment,functions:panelAssignPaymentMarketingUsers,functions:razorpayWebhook,functions:processRazorpayWebhook,functions:reconcileRazorpayPayments
```

5. Razorpay TEST Dashboard में webhook URL `https://asia-south1-YOUR_PROJECT_ID.cloudfunctions.net/razorpayWebhook` और matching webhook secret configure करें। Events/capture/reconciliation की बाकी existing instructions Admin के `RAZORPAY_SETUP_HINDI.md` में हैं। Automatic capture और webhook worker दोनों जरूरी हैं। केवल authorized payment पर access नहीं मिलेगा।
6. Web App folder:

```bash
npm ci
npm run test:payments
npm run build
```

अपने existing Web App host पर fresh `dist` deploy करें। Payment functions की region code में asia-south1 है; कोई नया browser payment secret नहीं जोड़ना है। Old PSERVER frontend variables अब checkout use नहीं करता। पुराने payment backend को retire करना हो तो अपने existing hosting/service configuration से करें; उसका server source इन uploads में नहीं है।

7. React Native folder:

```bash
npm ci
npm run test:payments
npx expo prebuild
```

फिर अपने existing EAS/local release build workflow से नया Android/iOS native build बनाएं। SDK `react-native-razorpay` 3.0.0 lock किया गया है। iOS UPI query schemes और Android release ProGuard rules config में हैं। यह native module है: Expo Go या केवल OTA JavaScript update से जोड़ना पर्याप्त नहीं है। Store release से पहले अपने वर्तमान release के हिसाब से `expo.version`, Android `versionCode` और iOS `buildNumber` बढ़ाएं। पुराने shell में checkout से पहले साफ app-update message आता है; बाकी app flow चलता रहता है।
8. Admin > Company > Plans में service चुनें; मौजूदा plans default Poster हैं। Video/Combo price और duration आप Admin में सेट करें। Test setup पूरा होने पर `PAYMENTS_ENABLED=true` करके payment functions redeploy करें। Device पर cancel, UPI app switch, debit-but-pending, app restart, success और refund test करें। उसके बाद LIVE keys, LIVE webhook और mode configure करके fresh payment deployment करें।

## Validation

- Web App और Admin production builds passed.
- Backend domain/HTTP/rules-installer unit tests passed.
- Firestore emulator integration tests passed: identity, tampering, signature, amount/currency, concurrent order, duplicate webhook, refunds, renewals, test/live isolation, Video/Combo, pending-bank timeout.
- Web payment client tests passed: cache/coalescing, double submit, lost response/restart, verification failure, account switch, pending throttle, explicit stale-quote refusal.
- वास्तविक React checkout components की isolated DOM simulation passed: cancel pending, restart recovery, failed verification stays failed, verified success reuses same order, old-shell update handling. Provider responses इस simulation में test doubles थे।
- Android और iOS JavaScript/Hermes export passed; native bridge tests और existing push tests passed.
- Full native TypeScript check में original ZIP जैसे ही 4 pre-existing diagnostic categories रहती हैं: animation-loop option और WebView dependency typings। Baseline और updated diagnostics मिलाए गए; नए diagnostics नहीं जोड़े गए।

इस workspace से production deploy, APK/IPA compilation, physical-device payment या real merchant transaction नहीं किया गया है। Live keys, production full rules और actual device/payment validation आपके deployment पर complete करने हैं।

## Reference

- Razorpay web flow: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- Razorpay React Native setup: https://razorpay.com/docs/payments/payment-gateway/react-native-integration/standard/integration-steps-android/
