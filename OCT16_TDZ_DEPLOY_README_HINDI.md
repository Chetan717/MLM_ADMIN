# 16 Oct 2026 — Admin crash deployment verification (Hindi)

## Why the same error appeared twice
Original 15 Oct Add forms called `useUnsavedFormGuard({ saving: loading, saved: success })` before `loading` and `success` were declared. React render threw `Cannot access 'a' before initialization`. The 16 Oct corrected forms initialize those states first. If error stays after a changed JS bundle hash, check that the correct source is actually in the Vercel root/branch, not only that a deployment completed.

## Changed from uploaded source
- AddTemplate.jsx, AddCompanies.jsx, AddGraphics.jsx: state before unsaved guard (same safe fixes as the prior patch)
- `tools/verify-add-forms.mjs`: verifies these three state ordering fixes, zero npm deps
- `package.json`: `prebuild` check before every Vite build
- `public/MLMLIVE_ADMIN_TDZ_FIX_20261016_VERIFIED.txt`: identifiable deployment marker
- No Firebase Functions, Firestore rules, media URLs, Cloudflare R2 objects, template data, or user data changed.

## On your actual Vercel-linked project
1. BACKUP original source. Extract full ZIP as project source, or merge patch into the exact Vercel-linked repo/branch and selected Root Directory.
2. In the project root, run:
   `npm run verify:add-forms`
   `npm run build`
   First must show PASS three times. The actual build must finish without errors.
3. Deploy Preview with fresh source (NOT an older copy); open:
   `https://YOUR-ADMIN-DOMAIN/MLMLIVE_ADMIN_TDZ_FIX_20261016_VERIFIED.txt?test=20261016`
   The text `OCT16-TDZ-SAFE-V2` must be visible. Missing/404 means wrong deployment/source/root.
4. Test in Preview: `/templates/add`, `/companies/add`, `/graphics/add`. Then upload a tiny file and check save, edit and discard. Only then promote to production.
5. If live error remains, send browser Console error + DevTools Network -> failing `401` request host and PATH only (no credentials, no auth token), screenshot of Vercel deploy settings Root Directory and verified marker result.
6. Test in private/incognito window and do hard reload (Ctrl+Shift+R) to rule out stale cached bundles.

## 401 is a separate issue
A 401 HTTP response is not the same as the TDZ rendering crash. Without the failing request URL/path one cannot determine whether Vercel authentication, Firebase Auth session, Callable function, or a media/CDN endpoint rejected it. Do not change production Auth or Firestore Rules blindly. Redact query parameters and secrets from logs before sharing.

## Caveat
This check verifies the specific confirmed crash in SOURCE only. A valid local check does not prove Vercel deployed the right revision, that the production build passed, or that live uploads and Firebase credentials work. No Firebase Functions need to be redeployed for this fix.
