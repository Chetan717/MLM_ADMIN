# MLMLive — Single Video Panel + New Request Email (V6)

## Apply to Admin project only
This is based on the updated Admin Video Team UI ZIP plus V5's five-request customer pagination backend. Back up your current Admin source. Extract the `admin/` folder contents into the root of your Admin project, preserving paths. If your local index.js or paymentFunctions.js contains independent newer edits, merge the mail parameter wiring rather than overwriting those unrelated changes. No Web App files are replaced. V4 UI and V5 customer pagination are preserved (5 customer rows, 10 admin/panel rows).

## What changed
- One shared Video Panel login managed by Master Admin. All non-archived requests appear in the shared view directly, including existing assigned requests. Archived requests remain Master Admin-only as before. New requests no longer require an editor assignment. Download confirmation and Start editing are allowed from Submitted or legacy Assigned. Existing history, credits, review, corrections, storage and customer approval rules remain intact.
- No role selection, editor assignment/bulk assignment, editor filter, or team member list. Admin can create/reuse, edit email/display name, set a replacement password, send a standard Firebase password reset email, activate/deactivate, or delete the single login. Account deletion does not delete requests or raw/final video records. Master Admin still sees all active requests even before the panel account is set up.
- Previous editor/manager logins are denied at the backend unless explicitly adopted as the single panel login. Their old Firebase Auth accounts are not automatically deleted. If needed, disable obsolete Auth accounts after confirming their use. Existing assigned status/history is preserved for compatibility; legacy editor view entries are removed on subsequent request updates.
- Notification outbox is written atomically with each newly submitted request. The Firestore create event sends a short email (request ID/category and panel link) to the current active panel account email. Uses existing EMAIL_NODEMAILER and EMAIL_PASS, Gmail SMTP via existing Nodemailer. No new SMTP credential. No attachments, customer mobile or raw video links in mail. Test-mode emails are marked [TEST]. No email on draft uploads or repeated idempotent submit. If not configured, disabled, or SMTP fails, job remains queued; retry every five minutes with capped backoff. Sending does not block request creation or credit reservation. Lease prevents concurrent duplicate sends; SMTP acknowledgement followed by a crash before marking sent can rarely produce a duplicate. Jobs created before a panel is configured can notify later once it is active. Only new submissions after this update are queued.
- Existing default deny Firestore rules already cover `videoService/**` and `_videoEditingTeam/**`. New outbox has a single-field time query, so no new composite index needed under normal automatic indexing. New account state is stored under `_videoEditingTeam/_panel`, no plaintext password stored in Firestore.

## Deploy
1. Check your Firebase CLI active project (`firebase use`); confirm it is the intended MLMLive project. Ensure Email/Password provider is enabled and existing sender config/EMAIL_PASS secret is valid. Do not expose secrets or reset them unnecessarily. New Firestore trigger may require Eventarc permissions at deployment.
2. In Admin project root run:

```bash
npm ci
cd functions
npm ci
cd ..
firebase deploy --only "functions:videoEditing,functions:videoEditingMedia,functions:videoEditingDraftCleanup,functions:videoNewRequestEmail,functions:videoNewRequestEmailRetry"
npm run build
```

3. Redeploy Admin frontend on Vercel. Backend and frontend should be released together: older team UI calls (`members`, `manage`, `assign`) are now blocked. There is no need to redeploy the customer Web App if V5 is already installed. If it is not installed, apply V5 customer files separately, **do not overwrite the V6 backend with V5**.
4. Login as Master Admin -> Video Editing Service -> Panel account. Enter the existing video panel account email (or new email) and set a password (8+ characters with uppercase/lowercase and a digit). Save/Create panel login. Reusing an existing editor login is allowed only when its Firebase claims and legacy backend record match. Old accounts stop accessing video APIs immediately after V6 deploy until one is selected. If creating/editing fails mid-operation, the account remains blocked; refresh, correct the inputs and save or activate again. In case of interrupted operation, retry after three minutes.
5. Sign out of the former panel session and sign in again at `/video-team`. Any old sessions invalidated by account changes must sign in again. No manual request assignment is required.
6. Test with one genuine test request: it appears in both dashboards without assignment; verify the panel email gets a [TEST] notification if test mode; start editing, submit review, approve from customer. Verify one credit settled and 5-item customer paging. Check function logs for `Video notification deferred` if no email is received; verify recipient, active account, Gmail credentials and spam folder. Test edit/reset/delete with a staging account. Do not delete a production login while testing.

## Tests
- 5 new mocked backend tests (single panel permissions, direct state transition, account lifecycle, safe legacy migration, email delivery/duplicate guards and retry).
- 16 existing dependency-free video tests passed.
- 2 existing R2 SDK tests cannot run in this environment (AWS SDK absent). Firebase emulator integration updated for new shared panel, mail queue and 5-row customer paging, not run (Firebase dependencies/emulator absent). JS syntax and JSX transpilation checks passed. Production build, Firebase deployment, real mail delivery, and browser behavior are not verified here. SMTP duplicate delivery after a crash remains theoretically possible; it does not affect credits or request records.
