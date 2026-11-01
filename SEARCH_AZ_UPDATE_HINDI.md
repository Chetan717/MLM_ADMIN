# Admin Search + A–Z update — 1 November 2026

यह पूरा updated Admin project है। इसमें पिछले Admin Firestore read fixes भी शामिल हैं।

## क्या बदला

- 22 source files के सभी 52 native dropdowns में search और displayed name के अनुसार A–Z order जोड़ा गया।
- Company, template type, graphics options, coupon/member, role/status, Leads filters, User Dashboard, Expense forms और Popup selects एक ही searchable component इस्तेमाल करते हैं।
- Profile का custom Rank picker भी searchable और A–Z है। Company/expense suggestion lists alphabetical हैं। Existing company-list search और default A–Z sorting कायम हैं।
- All/Select/None जैसे shortcuts ऊपर रहते हैं। Month/year, plan duration और Small/Medium/Big का meaningful order रखा गया है। Numeric options natural order में हैं, जैसे 2 फिर 10।
- Enter, arrows, Escape, बाहर click, disabled options, required validation, multiple values और form reset support हैं। Dropdown में search करने से current selection अपने-आप नहीं बदलता।
- Search पहले से loaded options पर browser में होता है। इस feature में नई Firestore queries/API requests या production dependencies नहीं जोड़ी गई हैं। Selected record की original ID/value ही save होती है।

## चलाना / deploy

अपने Admin project में यह updated source उपयोग करें। Existing environment variables उसी project के रखें। Project root से:

```powershell
npm ci --legacy-peer-deps
npm test
npm run build
```

फिर existing Admin Vercel project में frontend redeploy करें। Search/A–Z feature के लिए कोई नया Cloud Function नहीं है। अगर पिछला read-fix backend deploy हो चुका है तो उसे दोबारा deploy करना जरूरी नहीं। `node_modules` और stale `dist` ZIP में नहीं हैं; build से नए assets बनेंगे।

## अगर पिछला Admin read-fix deploy नहीं हुआ है

उसका updated backend इसी source में है। पहले merged indexes deploy करें और READY होने दें:

```powershell
firebase deploy --only "firestore:indexes" --project mlmbooster-a4887
cd functions
npm ci
cd ..
firebase deploy --only "functions:cleanupQueuedTemplateAssets" --project mlmbooster-a4887
```

Worker के successful deploy के बाद:

```powershell
firebase deploy --only "functions:publishTemplateCatalogOnWrite,functions:cleanupTemplateStorageOnWrite,functions:panelCreateSessionFromTwoFactor,functions:panelListSessions" --project mlmbooster-a4887
```

यह previous read fix unused template media को 03:15 AM India time पर daily batch में साफ करता है; template list changes तुरंत दिखते हैं। Existing R2 secrets और Cloud Scheduler setup उपयोग होता है। Unrelated functions/indexes को delete न करें; पूरे shared Firebase project पर unfiltered deploy न चलाएँ। Marketing का पिछला patch अपने अलग project में रहेगा; यह ZIP Admin का है।

## Validation

- 121 Admin Node tests pass.
- 21 DOM UI tests pass, including tab retention and: search/sort, original ID change event, form data/validation/reset, multiple/disabled options, outside click/Escape, keyboard and dark mode.
- Production build और Add Form prebuild checks pass.
- New shared component/helper पर targeted ESLint checks pass; effect-based DOM synchronization check को इस targeted lint command में disable किया गया था।
- Backend functions, merged indexes और package/lock files पिछले read-fix version से byte-for-byte unchanged हैं।

Live account में deployment या real database writes यहाँ से नहीं किए गए। Login के बाद एक company selector, Add/Edit form, Leads filter और Expense employee selector check करें।
