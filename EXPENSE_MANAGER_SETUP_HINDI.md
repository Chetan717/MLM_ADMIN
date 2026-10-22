# Expense Manager — setup aur deploy

Reference image ke layout ko existing admin panel ki violet light / dark theme mein implement kiya gaya hai. Sidebar ka **Expense Manager** tab aur URL **/expense** hai. Existing Master Admin login use hota hai. Koi naya login, Firebase Cloud Function, callable, scheduler ya backend package change nahi hai.

## 1. Firestore mein sirf ek document

Firebase Console → Firestore Database → Start collection:

- **Collection ID:** `expense`
- **Document ID:** `expense`
- **Path:** `expense/expense`
- Pehla field `schemaVersion` → type **number** → value **1** rakh sakte hain.

`employees`, `expenses`, `salaries`, `expenseNames` manually banana zaroori nahi hai. Pehli successful save mein app ye maps isi document mein bana deta hai. Agar aap pehle se banayein to inka type **map** rakhein; string / array nahi.

Expense Manager kholne se document mein sample employees, salary ya expenses save nahi hote. Default expense names milte hain; custom names bhi add kar sakte hain. Document na ho to bhi empty screen khulti hai, aur pehli save use create karti hai, agar Firestore rules permit karti hain.

Sirf isi document ko read / write kiya jata hai; employee, payroll ya expense ke liye subcollections aur alag documents nahi bante.

## 2. Firestore permission

ZIP mein full existing Firestore rules file available nahi thi. Isliye existing rules ko replace nahi kiya gaya hai, aur `firebase.json` mein koi rules file set nahi ki gayi hai.

`expense.firestore.rules.snippet` ka match block apni **existing published rules** ke `match /databases/{database}/documents { ... }` ke andar add karein. Firebase Console → Firestore Database → Rules → Publish.

Ye snippet existing login ke `panel: admin` aur `role: Master Admin` claims use karta hai. Read by exact document path aur create / update allow hain. Is feature ko collection listing ya poora document delete karne ki permission nahi chahiye. Employee / expense delete bhi isi document ke andar map entry remove karta hai.

Financial aur bank information ke liye tab **Master Admin only** rakha hai. Non-Master Admin ko sidebar item nahi dikhega aur direct URL bhi expense data fetch nahi karega. Backend ke existing allowed-tab list ko edit kiye bina kisi sub-admin ko nayi permission dene ka adhura option nahi joda gaya hai.

Apni rules mein agar pehle se broad wildcard `allow read, write: if true` ya sab signed-in users ko access dene wala rule hai, to us rule ko restrict karna hoga: Firestore kisi bhi matching allow condition ko accept karta hai. Naya restricted match akela broad existing allow ko cancel nahi karta.

## 3. Single-document indexing

`firestore.indexes.json` mein existing indexes ko preserve karke `expense` collection ke four map fields ke liye indexing exemptions jode gaye hain. Is feature ki filtering browser mein hoti hai, isliye in maps par Firestore indexes ki zaroorat nahi.

Firebase Console → Firestore → Indexes → Single field → Add exemption se ye four fields exempt kar sakte hain:

| Collection | Field | Indexing |
| --- | --- | --- |
| expense | employees | Disable |
| expense | expenses | Disable |
| expense | salaries | Disable |
| expense | expenseNames | Disable |

Ya apne project ki current index configuration se included file ko reconcile karke `firebase deploy --only firestore:indexes` chalayein. Existing indexes delete karne ka prompt aaye to bina review accept na karein. Functions deploy ki zaroorat nahi hai.

## 4. Frontend deploy

Apne current production environment variables / Firebase project settings retain karein. Is feature ke liye koi new environment variable ya secret required nahi hai.

```bash
npm ci --legacy-peer-deps
npm run build
firebase deploy --only hosting
```

Agar aapka admin panel kisi aur hosting par hai, to wahi existing frontend deployment process use karein. Functions folder ko deploy karne ki zaroorat nahi.

## 5. Kaise use karein

1. **Employees:** Full name, employee code, mobile, email, DOB, gender, marital status, city, address, emergency contact, designation, department, employment type, joining / leaving date, monthly base salary, PAN, account holder, bank, branch, account number, IFSC, UPI, UAN / PF, ESI aur notes manage karein.
2. **Expense Names:** Name, custom category, default amount, vendor, payment mode, active / inactive status aur optional monthly due day set karein. Salary ko Salary tab se record karein.
3. **Expenses:** Date, name, employee / vendor, amount, payment mode, reference aur notes save karein. Paid / Pending status available hai. Paid bill ki payment date actual spending month decide karti hai.
4. **Monthly expenses:** Expense name mein monthly option aur default amount set karke selected month par **Add Monthly Expenses** click karein. Bills Pending bante hain. Same name + month ka bill repeat generate nahi hota. Payment hone par expense edit karke Paid aur payment date set karein.
5. **Salary:** Selected month ke liye **Prepare Monthly Salary** karein, ya ek employee ka salary record add karein. Base salary, bonus / allowances aur deductions set karein. **Pay** se partial ya full payment save karein. Har payment ki date aur reference alag rehti hai. Salary payments Expenses mein automatically aati hain; manually Team Salary expense dobara add na karein.
6. **Export Excel:** Summary, Expenses, Employees, Salary aur Expense Names ki five sheets download hoti hain. Expenses sheet current month / category / search filters follow karti hai. Employees aur Expense Names sheets full master lists hain; Salary selected payroll month ka hai. Account number text rehta hai, leading zeroes nahi hatte.

## 6. Totals aur payroll behavior

- Month Expense = selected payment month ki paid other expenses + salary payments.
- Salary Paid card = selected calendar month mein hui actual salary payments, chahe salary kisi purane payroll month ki ho.
- Other Expenses = selected payment month ki paid non-salary expenses.
- Pending Salary = selected payroll month ka net salary minus us payroll ke sab recorded payments. Eligible employees ke unprepared salary amounts bhi pending mein dikhte hain.
- Pending bills paid cards mein include nahi hote. Table footer aur Overview pending bills alag dikhate hain.
- Salary record employee + payroll month ke liye unique hai. Monthly preparation existing payroll ko duplicate / overwrite nahi karti.
- Joining month aur leaving month payroll mein eligible hote hain. Joining mid-month ho to automatic proration / statutory payroll calculation nahi hoti; amount aur deductions manually adjust karein.
- Inactive employee ke historical months ki eligibility retain karne ke liye leaving date set karein. Salary already prepared ho to employee ki later salary change purana payroll amount nahi badalti.
- Employee / expense name linked history ke saath delete nahi hota; use Inactive karein. Salary record delete karne se pehle uske payments remove karne honge.

## 7. Cache aur saves

- Expense route khulne par ek document fetch hota hai; fresh cache available ho to wahi reuse hota hai.
- Cache 5 minutes tak route wapas kholne par reuse hota hai. TTL expire hone ke baad next route entry fresh read karti hai. Background polling / realtime listeners nahi hain.
- Five inner tabs, search, category, month / year filters aur Excel export extra Firestore reads nahi karte.
- **Refresh** fresh server read karta hai. Doosre browser / device ki changes dekhne ke liye Refresh use karein; multi-device live sync nahi hai.
- Successful write cache ko confirmed result se update karti hai; uske baad alag read nahi hoti.
- Save ek direct client Firestore transaction hai: latest document read + one atomic document write. Contention par Firebase transaction retry ho sakti hai, isliye one save ko guaranteed zero reads na samjhein.
- Entity versions stale edit detect karti hain. Error aaye to Refresh karke record dobara kholein. Concurrent salary payments latest remaining balance ke against validate hote hain.
- Cached PAN / bank data sirf memory mein rehta hai, localStorage / sessionStorage mein nahi. Sign-out / auth-user change par cache clear hota hai. Page reload ke baad fresh read hoti hai.
- Offline ya permission error mein form editable rehta hai aur save-success nahi dikhaya jata. Failed refresh previous confirmed data ko clear nahi karti.

## 8. Ek document ki capacity

Firestore ek document ko maximum 1 MiB tak allow karta hai. User ke single-document design ke liye approximately 800 KiB JSON size par app growing writes ko rokta hai, taaki document encoding ke liye headroom rahe. Isliye ye unlimited historical ledger nahi hai. Limit ke paas aane par pehle Excel export karein aur old records manually remove karein; koi automatic deletion nahi hoti. Cleanup / shrinking operations allowed rehti hain.

Official references:

- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/security/rules-conditions

## Validation

- Production build aur existing Add Form crash verification.
- 93 automated tests passed, jinmein 24 Expense Manager business / caching tests hain. New module ka ESLint check bhi pass hai.
- 13 browser checks passed: reference layout, five sections, employee edits, monthly bills, paise totals, multiple salary payments, payment removal, Excel, dark theme, mobile forms, failed-save recovery, empty state aur restricted access.
- Browser checks local test data aur test-only adapter par kiye gaye; production database mein sample data write nahi kiya gaya. Test harness / screenshots final source ZIP mein nahi hain.
- Live Firebase rules aur actual production deployment user ke environment mein verify honge; is ZIP se live hosting ya Firestore modify nahi kiya gaya hai.

Modified integration files: `src/App.jsx`, `src/Layout.jsx`, `src/components/Sidebar.jsx`, `firestore.indexes.json`.
New module: `src/Pages/ExpenseManager/`.
New tests: `tests/expenseManager.test.mjs`.
Existing `functions/` aur login source files unchanged hain.
