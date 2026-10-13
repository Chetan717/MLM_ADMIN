# MLM LIVE — Complete Admin Functions, Node.js 24 + Migration Guard

इस ZIP में यूज़र द्वारा भेजे गए **पूरे Admin source** को रखा गया है; केवल `functions/package.json`, `functions/package-lock.json` और `firebase.json` की टूटी configuration ठीक की गई है। पहले से लगाए गए migration guard वाले `functions/index.js` और `functions/templateStorageCleanup.js` को सुरक्षित रखा है। कोई exported Admin Function हटाया नहीं गया।

## क्या ठीक हुआ
- `functions/package.json` में full dependencies (`firebase-admin`, `firebase-functions`, `nodemailer`) restore कीं, Node 24 runtime रखा।
- `functions/package-lock.json` की original resolved dependencies restore कीं और root engine Node 24 किया।
- `firebase.json` में runtime सिर्फ `functions.runtime: nodejs24` रखा; गलत top-level runtime हटाया।
- Firestore migration URL-only writes पर पुरानी Firebase file न मिटे—इसके लिए migration guard बरकरार। URL-only writes पर incremental CDN publisher skip करता है; migration **पूरा होने के बाद Admin → Templates → Sync CDN** जरूरी है।
- `functions/.env.mlmbooster-a4887` की user-supplied non-secret variables को ज्यों का त्यों रखा है। वास्तविक R2 keys Firebase Secret Manager में ही रखें।

## Windows पर Deploy करने का सुरक्षित तरीका
1. पूरी ZIP extract करें। बैकअप रखें। इसी folder में `firebase.json` और `functions/index.js` दोनों दिखने चाहिए।
2. Powershell को **इस project के root folder** में खोलें, किसी migration/backend_patch folder में नहीं।
3. Functions dependencies स्थापित करें:

```powershell
cd functions
npm ci
cd ..
```

4. Firebase source check करें:

```powershell
node --check .\functions\index.js
node --check .\functions\templateStorageCleanup.js
```

5. सिर्फ Migration guard से जुड़े 2 Functions deploy करें:

```powershell
firebase deploy --only functions:cleanupTemplateStorageOnWrite,functions:publishTemplateCatalogOnWrite --project mlmbooster-a4887
```

6. **दोनों सफल होने पर** ही Migration Tool में `BACKEND_GUARD_DEPLOYED=true` करें। उसके बाद पहले `1_DRY_RUN_ALL.bat`, फिर 10-doc pilot, फिर full apply। इस बीच Firebase Storage की files delete नहीं करनी हैं।

## IMPORTANT
- `firebase deploy --only functions` न चलाएँ; Marketing/Calling Team जैसे Functions दूसरी codebase में हो सकते हैं।
- Code/source syntax तथा local unit tests पास होने का मतलब cloud deploy success की guarantee नहीं है।
- Migration केवल approved/verified keys पर होनी चाहिए; 6 `ECONNABORTED` files और unknown keys leave unchanged रहेंगी।
- Admin Functions के अलावा Auth और Marketing Functions के source इसमें शामिल नहीं हैं; वे दूसरे codebases में हैं।
- `functions/node_modules` शामिल नहीं है ताकि ZIP छोटी रहे; `npm ci` से dependencies वापस आएँगी।
