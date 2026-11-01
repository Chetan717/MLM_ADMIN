# Admin template update — 1 November 2026

यह पूरा updated Admin source है। पिछले read fixes, सभी dropdowns का Search/A–Z और tab बदलने पर loaded data बनाए रखने के बदलाव इसमें शामिल हैं।

## Recently Added / Recently Updated

- सफल Add या Copy के बाद उसी template पर **Recently Added** दिखता है। पहले से मौजूद template का सफल Edit होने पर **Recently Updated** दिखता है। Failed save/copy पर flag नहीं लगता।
- Flags Table, Horizontal और Vertical तीनों views में दिखते हैं। नया template इसी session में फिर edit होने पर उसका Recently Added flag बना रहता है।
- लंबी list में **Show recent changes** दबाएँ। यह पुराने search/company/type filters हटाकर हाल में बदले templates दिखाता है और सबसे नए बदलाव वाला MLM/General tab खोलता है। **Show all templates** से पूरी list पर लौट सकते हैं।
- Flags सामान्य tab switch और Add/Edit/Copy page से लौटने पर बने रहते हैं। सफल **Refresh**, browser page reload, app बंद करके दोबारा खोलने या logout पर हट जाते हैं। Failed Refresh पर flags बने रहते हैं। Refresh के दौरान कोई नया save पूरा हो जाए तो उसका नया flag नहीं मिटता।
- Flags session memory में हैं। इनके लिए कोई Firestore field, query, listener या fetch नहीं जोड़ा गया है।

## Save के बाद extra fetch नहीं

पहले saved template/quality data के notification पर retained list फिर fetch कर सकती थी। अब सफल save से मिला record सीधे पहले से loaded Templates और Template Data lists में जोड़ा/बदला/हटाया जाता है। Quality save के बाद popup बंद करने पर भी quality list दोबारा fetch नहीं होती। पुराना in-flight request नए saved data को overwrite नहीं करता।

Flags, view switch, arranging और company checkbox/search में **0 अतिरिक्त Firestore reads** हैं। Initial Load/Refresh और Copy की पहले से मौजूद fresh duplicate verification queries अपना सामान्य काम करती हैं। Add/Edit/Copy के वास्तविक saves और उनके existing backend triggers भी चलते हैं।

## Horizontal / Vertical और Arrange

1. Templates में **Table**, **Horizontal** या **Vertical** चुनें। Horizontal में cards पास-पास और Vertical में एक के नीचे एक दिखते हैं।
2. **Arrange** दबाएँ। Handle पकड़कर template को आगे/पीछे drag करें। Touch drag और arrow buttons भी हैं। Arrows से page की सीमा पार भी template move कर सकते हैं।
3. **Done arranging** दबाएँ। View और क्रम इसी browser में उस Admin की पहचान के अनुसार save होते हैं। MLM और General का क्रम अलग रखा जाता है।
4. **Reset order** उस tab का custom arrangement हटाता है। Search/filter/pagination में छिपे records drag के कारण गायब नहीं होते; उनका आपसी क्रम सुरक्षित रहता है।

यह Admin list का स्थानीय display order है। दूसरे Admin/device और public app के catalog/serial order पर इसका प्रभाव नहीं पड़ता। Arrangement के लिए Firestore write/fetch नहीं होता। Browser storage में केवल template IDs का क्रम और view preference रहता है। Storage बंद/full होने पर list काम करती है और preference उसी open page तक रहती है।

## Copy to All Companies में multiple selection

1. **Copy to All Companies** खोलकर source company, design type और subtypes चुनें।
2. सभी eligible destination companies शुरू में selected होती हैं। Source company destination list में नहीं आती।
3. Search करके कोई भी कंपनी checkbox से deselect/reselect करें। **Select All Companies** और **Deselect All Companies** shortcuts भी हैं। List company name के अनुसार A–Z है।
4. Selected count देखकर Copy दबाएँ। केवल checked companies में copies बनेंगी। कोई company selected न हो तो Copy disabled रहता है और duplicate query/write नहीं चलती।

Search केवल loaded company list पर होता है। Search से hidden कंपनियों की selection नहीं बदलती। Copy के दौरान destination selection locked रहती है। Existing exact duplicates skip होते हैं; केवल सफल copies पर Recently Added flags लगते हैं। Single-company copy भी उपलब्ध है।

## Deploy

Existing Admin project के environment variables रखें। Project root से:

```powershell
npm ci --legacy-peer-deps
npm test
npm run build
```

फिर अपने existing Admin Vercel project में frontend redeploy करें। इस update में नया backend function, index, rule या dependency नहीं है। पिछले read-fix backend को पहले deploy कर चुके हैं तो इस feature के लिए उसे फिर deploy करने की जरूरत नहीं। अगर वह पहले deploy नहीं हुआ है तो `SEARCH_AZ_UPDATE_HINDI.md` में उसके commands हैं। ZIP में node_modules/dist नहीं हैं; build नया dist बनाएगा।

## Validation

- 128 Node tests पास।
- 21 DOM UI checks पास: Search/A–Z, tab retention, तीनों template views, badge lifecycle, drag/drop, touch, pagination, scoped local order, checkbox selection, excluded destinations, cancelled copy, duplicates और failed writes।
- Production build और Add Form prebuild checks पास।
- बदले गए template modules और नए helpers/components के targeted lint checks पास। Existing effect-based state synchronization rule उस command में disabled थी।
- Backend/functions, Firestore indexes/rules, Firebase config और package/lock files पिछले tab-retention version से unchanged हैं।

Live database पर कोई operation या deployment इस validation में नहीं किया गया।
