# Admin tab data retention — 1 November 2026

यह पूरा updated Admin source है। Previous Search/A–Z और Admin read fixes इसमें शामिल हैं।

- Sidebar के 16 main pages में पहली visit पर ही page mount/load होता है। खोले नहीं गए pages के data को पहले से fetch नहीं किया जाता।
- Tab बदलकर लौटने पर loaded records, fetched status, search, filters और pagination की state रहती है। केवल tab switch होने से वही fetch फिर शुरू नहीं होता।
- Marketing Team/Coupon Manager और Graphics/Music के अंदर के data-owning tabs भी अपनी state रखते हैं।
- Refresh/Fetch के existing buttons latest data लाते हैं। Task Management का existing live-update behavior जारी रहता है।
- Company, Graphics और Template Add/Edit/Delete के बाद पहले से loaded संबंधित list को लौटने पर एक बार update किया जाता है। सामान्य tab switch पर यह update नहीं चलता।
- Inactive pages के dropdown/dialog portals दूसरे page को नहीं ढकते। Sidebar/header direct navigation और browser Back/Forward के साथ सही tab दिखाते हैं।
- State केवल इस open Admin session की browser memory में रहती है। Logout, account/role/permission change या full browser page reload के बाद इसे फिर load करना होगा। Loaded data को localStorage में नहीं रखा गया है।
- Add/Edit forms के existing unsaved-change guards और normal route behavior रखे गए हैं; अलग-अलग record edit forms को background में cache नहीं किया जाता।

## Deploy

इस source को अपने existing Admin project में उपयोग करें और उसी project के environment variables रखें। Root से:

```powershell
npm ci --legacy-peer-deps
npm test
npm run build
```

फिर **Admin frontend को Vercel पर redeploy करें**। इस tab-retention update में backend functions, indexes और package/lock files previous Search/A–Z ZIP से unchanged हैं। कोई नया Cloud Function या dependency नहीं जोड़ी गई। अगर previous read-fix backend पहले से deployed है, उसे इस update के लिए redeploy नहीं करना है। Previous backend setup की जरूरत हो तो `SEARCH_AZ_UPDATE_HINDI.md` में commands हैं।

## Verification

- 121 Node tests pass.
- 12 DOM UI tests pass, including existing searchable selects and new navigation/state-retention cases.
- Production build और Add Form prebuild checks pass.
- New retention utilities/components के targeted lint checks pass; effect-based state synchronization rule इस targeted command में disabled थी।

Live database operations/deployment यहाँ से नहीं किया गया।
