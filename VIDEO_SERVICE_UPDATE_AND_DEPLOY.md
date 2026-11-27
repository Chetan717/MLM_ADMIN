# MLMLive — Video Editing Service update

## Release status
Source changes applied to both ZIPs supplied in this conversation. This is a source release, not a verified production build or deployment. The existing payment/plan entitlement implementation, approval credit accounting, and Remove Background code were not changed. Back up both projects and deploy to staging first.

## Changes
- Customer: blue #2f80ea mobile-first video service home, credit card, Video Service bottom tab with NEW badge, compact request cards, detail sections, status timeline, WhatsApp support, and on-demand Drive preview/download. No fabricated video thumbnails: new local clips can generate a bounded JPEG raw preview; older requests and requests whose raw media were removed display an icon. Edited files remain Drive links, not R2 objects. Embedded Drive playback depends on file permissions and WebView behavior.
- Upload: a compact local clip preview, percentage per file, overall progress only for multiple clips, retry-aware byte calculation, 100% only after successful R2 finalization. Existing multipart, draft and retry logic retained. Frequent progress updates remain local.
- Pagination: ten request rows per query across customer, Admin and Team. Admin/Team use cached previous/next pages; user uses Load More and de-duplicates IDs. No extra look-ahead document read: exactly full last page may require one additional empty query. Existing filters and authorization scopes remain in effect.
- Team accounts: name/email/mobile, password and confirmation, role and active status, show/hide, reset email. Passwords go to Firebase Admin SDK only and are not stored in Firestore. Existing separate team authentication app remains intact. Password policy: 8–128 characters, upper/lowercase and a digit. Email is the login identifier.
- Cancellation: release existing reservation in a transaction, then remove only associated raw objects, clear object keys and thumbnail, and record cleanup; scheduled job retries pending cancellation cleanup. Request and credit history retained. Completed requests allow authorized manual raw cleanup only after approval; edited Drive link retained.
- Archive: Master Admin only, terminal requests only (Completed/Cancelled/Rejected), registered mobile confirmation. Preserve files. Archive removes request from active Admin/Team lists, but keeps the customer's own request history and delivery available. Restore returns to previous status. In the Archived requests screen, use **Index older archived requests** / **Index next 10 old archives** until the scan is complete, once in each payment mode, to migrate old records and reconcile their projections/counters.
- Permanent deletion: Master Admin only, terminal archived requests, registered mobile and explicit confirmation. Remove R2 raw objects if present, request subcollections, record and projections; retain separate deletion audit and existing entitlement ledger. Retry the action if interrupted; the request stays archived until completion. External Google Drive files are not automatically deleted: no ownership/deletion credentials are present. Delete only verified request-owned external files separately if policy requires it.
- Rules: explicit client deny for video-service and editing-team documents; access remains through backend. Thumbnail fields exempted from indexing in drafts/requests/entries/updates; existing indexes retained. No new composite index expected because queries reuse existing collection-scoped tag/document-ID access and single-field indexes.

## Changed files
Customer: `src/App.jsx`, `src/components/TabBar.jsx`, `src/pages/Video/{VideoService.jsx,NewRequest.jsx,Video.css,uploads.js,uploadProgress.js}`, `tests/videoServiceProgress.test.mjs`.
Admin: `src/Pages/Video/{VideoTeam.jsx,Video.css}`, `functions/video/{functions.js,domain.js}`, `firestore.rules`, `firestore.payment.rules`, `firestore.indexes.json`, `tests/videoEditing.test.mjs`, `tests/videoEditing.integration.mjs`.
Both: `VIDEO_EDITING_SETUP.md`, this guide. No dependency additions.

## Testing performed
- 18 video backend unit tests PASS (including thumbnail validation, non-destructive archive and restore).
- 24 Admin payment/regression tests PASS.
- 17 Web payment + upload progress tests PASS.
- 9 changed JavaScript/JSX files syntax parsed successfully; Node backend syntax checks PASS.
- Two failures observed in additional Web tests also reproduced on the original ZIP: legacy editor video-tab static assertion and missing jspdf package in planExperience test. No unrelated editor logic was changed.
- Both frontend dependency installs failed in the offline environment due to unavailable npm cache packages. Full production builds, browser visual checks, Firebase Auth/Firestore emulator integration, live R2 and Drive checks, and end-to-end deployment have NOT been verified. Updated integration test file is included but was not executed here.

## Deploy on your Windows machine
Use the existing project settings. Source ZIPs exclude stale `dist`, installed `node_modules`, real `.env` files and old deployment logs. Restore your own existing environment files from the original folders, not from chat. Keep secrets in Firebase Secret Manager. Do not overwrite an independently newer production Firestore rules file without reviewing/merging changes.

1. Extract both ZIPs separately. Install Node.js 24 and use your existing Firebase CLI login and Vercel projects.
2. In the Admin root:

```powershell
npm ci
cd functions
npm ci
cd ..
node --test tests/videoEditing.test.mjs tests/paymentDomain.test.mjs tests/paymentHttp.test.mjs tests/paymentRulesInstall.test.mjs tests/createPlanId.test.mjs
npm run build
```

3. In the Web App root:

```powershell
npm ci
node --test tests/videoServiceProgress.test.mjs tests/payments.test.mjs
npm run build
```

4. Before deploying the backend, verify that the dedicated raw-video R2 bucket and secrets are configured as described in `VIDEO_EDITING_SETUP.md`. `VIDEO_R2_ACCOUNT_ID`, `VIDEO_R2_ACCESS_KEY_ID`, `VIDEO_R2_SECRET_ACCESS_KEY` are existing Firebase Secret Manager values. `VIDEO_R2_BUCKET` is an existing function environment variable. Existing support number, upload concurrency/retry configuration and draft TTL remain unchanged. No new secrets are introduced. The main `videoEditing` function now also binds the R2 secrets for cancellation/permanent cleanup.
5. Test with the emulator before production, using the Admin root and the installed Firebase CLI:

```powershell
firebase emulators:exec --only firestore --project demo-mlmlive-video --config firebase.production-rules-test.json "node --test --test-concurrency=1 tests/videoEditing.integration.mjs tests/videoEditing.rules.integration.mjs"
```

6. After staging approval and confirming project ID/merged production rules, deploy only the intended backend and rule/index targets. Example existing project ID from the supplied guide:

```powershell
firebase deploy --only "functions:videoEditing,functions:videoEditingMedia,functions:videoEditingDraftCleanup" --project mlmbooster-a4887
firebase deploy --only "firestore:rules,firestore:indexes" --config firebase.payment.deploy.json --project mlmbooster-a4887
```

7. Publish the newly built Admin and Web `dist` folders to their own existing hosting/Vercel projects. Do not publish a stale original dist folder. Keep existing routing configuration, including `/video-team` and `/video-editing` SPA routes.
8. In Admin → Video Editing Service → Service settings, configure the actual WhatsApp number with country code and verify three free corrections. Test with both video and combo plans, plus poster-only access denial.

## Staging acceptance checklist
- Mobile WebView at small screen width: tab badge, forms, credit screen, request detail tabs, no horizontal overflow.
- Real team account creation and sign-in, password reset, deactivation, unrelated Admin access denied, existing Admin stays logged in.
- New request with 1 and 5 clips; pause/offline/retry/reload and finalization; verify actual bytes and credit reservation. Try correcting 3 times and verify no extra debit.
- List with >10 requests, forward/back and filter changes; verify Firestore read counts and no duplicates.
- Cancel only eligible request; verify R2 object removal, idempotent credit release and cleanup retry on temporary R2 failure.
- Complete/approve, confirm final Drive access, manually delete raw video and confirm final file unaffected.
- Archive terminal request before raw deletion, restore, then archive and permanently delete a disposable staging request; confirm independent credit ledger/audit retained and unrelated R2 objects unchanged. Do not test irreversible actions on actual customer data.
- Preview in actual Android/iOS WebView and confirm Drive resource permissions. Actual edited thumbnails/duration cannot be generated reliably from external Drive links in this implementation; raw thumbnail is labelled as such, otherwise fallback icon.
