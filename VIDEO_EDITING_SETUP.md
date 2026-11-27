# MLMLive Video Editing Service

The customer opens **Video Editing Service** from the app menu or an active video plan card. The Master Admin opens **Video Editing Service** in Admin. Editors and managers use **/video-team** on the Admin website. Use the updated Admin and Web App projects together.

## 1. Prepare the projects

Extract each archive into its own folder. Use Node.js 24 and the Firebase CLI. Run the following commands from the extracted **Admin** root in Git Bash or PowerShell. Restore the existing frontend environment settings from your current deployment before rebuilding either frontend.

```sh
node --version
firebase --version
npm ci
npm ci --prefix functions
node --test tests/videoEditing.test.mjs
npm run build
```

If the Firebase CLI is missing, install it with `npm install -g firebase-tools`. A prebuilt Admin `dist/` is also included. From the separate **Web App** root run:

```sh
npm ci
npm run build
```

## 2. Configure private raw video storage

Create a dedicated **private R2 bucket**. Keep public development URLs and public custom domains disabled for it. Create an R2 access key scoped to object read and write on that bucket. Its operations include initiating, listing, completing and aborting multipart uploads, reading object metadata and deleting objects. Keep the existing poster and profile bucket settings as they are.

From the Admin root, enter each value when the Firebase CLI prompts:

```sh
firebase login
firebase functions:secrets:set VIDEO_R2_ACCOUNT_ID --project mlmbooster-a4887
firebase functions:secrets:set VIDEO_R2_ACCESS_KEY_ID --project mlmbooster-a4887
firebase functions:secrets:set VIDEO_R2_SECRET_ACCESS_KEY --project mlmbooster-a4887
```

Add the following lines to the existing `functions/.env.mlmbooster-a4887`. Replace the bucket placeholder with your real private bucket name. Keep the existing payment mode and payment configuration. The video ledger and requests follow the configured `RAZORPAY_MODE`.

```dotenv
VIDEO_R2_BUCKET=YOUR_PRIVATE_VIDEO_BUCKET
MAX_VIDEO_CORRECTIONS=3
VIDEO_DRAFT_DAYS=3
VIDEO_DAILY_DRAFT_LIMIT=30
VIDEO_SUPPORT_WHATSAPP=
```

The support number may stay blank until you have it. Enter country code and number as digits. The Master Admin can later update the support number, categories and correction limit under **Service settings**. Saved settings override environment defaults within that payment mode. A request keeps the limit it received at submission.

Add CORS to the private bucket. This example uses the existing customer and Admin domains. Substitute the exact origins you use, including a preview origin when testing.

```json
[
  {
    "AllowedOrigins": ["https://app.mlmlive.in", "https://admin.mlmlive.in"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep an R2 lifecycle rule that aborts incomplete multipart uploads. Set that rule later than the configured draft retention, for example 7 days for 3-day drafts. The scheduled function cleans expired drafts and unsubmitted files. Completed, submitted raw objects have a separate manual deletion workflow. Avoid a bucket-wide object-expiration rule on these objects.

Each clip uses 8 MiB parts. The app retries failed parts and pauses while offline. Optional **Web App** build settings are `VITE_VIDEO_UPLOAD_CONCURRENCY` (default 1 file, range 1–3) and `VITE_VIDEO_UPLOAD_ATTEMPTS` (default 5 per operation, range 1–10). The service accepts MP4, MOV and WebM, up to 200,000,000 bytes each and 1,000,000,000 bytes across five clips.

## 3. Deploy the backend in small groups

Use the existing Firebase project with Functions, Firestore, Secret Manager and Cloud Scheduler available. In Firebase Authentication, enable Email/Password for team accounts and add your Admin domain to authorized domains. Keep customer sign-in on its existing flow.

First, update the **five existing payment settlement entry points** below. They preserve original video grants that still have reservations when the normal renewal logic prunes old expired grants. Deploy each group successfully before enabling new requests.

```sh
firebase deploy --only "functions:paymentVerify,functions:paymentStatus" --project mlmbooster-a4887
firebase deploy --only "functions:processRazorpayWebhook,functions:reconcileRazorpayPayments" --project mlmbooster-a4887
firebase deploy --only "functions:panelReconcilePayment" --project mlmbooster-a4887
```

Deploy the three new functions in `asia-south1`:

```sh
firebase deploy --only "functions:videoEditing" --project mlmbooster-a4887
firebase deploy --only "functions:videoEditingMedia" --project mlmbooster-a4887
firebase deploy --only "functions:videoEditingDraftCleanup" --project mlmbooster-a4887
firebase functions:list --project mlmbooster-a4887
```

The earlier mixed deployment log contains successful updates and failed updates. If a named target fails again, retry that single target with `--debug` and inspect the first API error and HTTP status in the local debug log. A successful update of a different function does not confirm this target. Keep raw debug logs private.

## 4. Publish the frontends and configure the service

1. Publish the Admin and customer production builds to their respective existing hosting sites. Keep the customer and Admin host mappings separate. Keep the Admin website's SPA rewrite to `index.html` so a direct visit to `/video-team` works.
2. In **Admin → App Plans**, set numeric video credits on each Video Editing Service or Combo plan you intend to sell. The existing payment system produces a distinct video grant for these purchases. Poster-only, generic premium status, scheduled or expired grants, and legacy grants with no numeric allowance cannot authorize a new request.
3. In **Admin → Video Editing Service → Team accounts**, create a manager or editor with an unused email address. The team member opens the team login page and chooses **Reset password** to set a private password through Firebase email. A Master Admin may manage managers and editors. A manager may manage editors. Deactivation blocks subsequent service requests.
4. Configure the real support number. Verify that the team login and the customer app point to the same Firebase project, payment mode and Functions region.

## 5. Acceptance check with a staging account

Use a video or combo grant with one available credit. Try a poster-only account separately and confirm the locked screen.

1. Select one to five clips, add instructions and start uploading. Interrupt the connection, reconnect and reload the app while a draft exists. Resume the draft. The app should preserve successful parts and show progress for each clip.
2. Submit. Available credits should fall by one, reserved should rise by one and used should stay the same. Refreshing or resubmitting should return the same request.
3. Assign an editor. Check that another editor cannot retrieve the request or request a raw file URL. Download the clips and confirm the download manually. Start editing and submit a Drive file link shared with the intended customer.
4. Open the review link and confirm review of that version. Submit a correction. Repeat until the third free correction. The app should disable further correction requests, keep the request open and offer support once configured.
5. Approve the latest reviewed edit. Verify exactly one consumed credit and zero remaining reserved for this request. Refresh and repeat approval to verify the balance stays stable. Open the final video and test a WhatsApp link on mobile and desktop. The sender must press Send.
6. After approval, delete the raw clips manually. Verify the final Drive link, correction history, credit history and analytics. Archive a terminal request only after typing the customer's exact registered mobile number.

## Data, access and retention

| Location | Purpose |
| --- | --- |
| `paymentEntitlements/{existing app ledger}` | Existing per-service grants. Video reservations increase `reservedVideoCredits`. Final approval reduces both that count and `remainingCredits` in one transaction. |
| `videoService/{test or live}/drafts` and `draftLimits` | One open draft per customer and rate limiting for newly created drafts. The default limit is 30 new drafts per day. |
| `videoService/{mode}/requests/{id}` | Customer snapshot, verified raw clip metadata, assignment, review version, correction limit, original purchase ID and credit state. History and command receipts are subcollections. |
| `videoService/{mode}/views` | Customer, team and assigned-editor lists, searchable prefixes, day summaries and all-time counters. The daily overview uses India dates and the request's creation date. |
| `videoService/{mode}/settings/service` | Service settings with audited changes. |
| `_videoEditingTeam/{uid}` | Team role, activation state and contact information. Firebase Authentication handles passwords. |

All service reads and writes use backend authorization. The supplied production Firestore rules already deny direct client access to these paths and the payment ledger. The service uses built-in single-field and document-name indexes. A database migration or new composite index is unnecessary with the supplied rules and standard automatic indexing. If your deployed rules differ from the supplied copy, verify direct access is denied before enabling the feature.

Part upload URLs expire after ten minutes. Raw read URLs expire after five minutes. Reassignment or deactivation stops new authorizations immediately. Previously issued links can remain valid until expiry. A customer can finish reviewing a legitimately submitted request after its plan expires. Cancellation or rejection releases its reservation against the original grant. Completed financial and review history is retained. Archiving hides a request from normal lists and preserves historical analytics. Submitted raw clips on cancelled or rejected requests remain stored under the approval-only deletion policy.

## Verification and limits

- Both production builds passed. All 16 focused unit and storage-adapter tests passed. The local callable workflow and database-rules tests passed against a Firestore-compatible emulator. Coverage includes ownership, editor reassignment, deactivation, blocked poster-only plans, duplicate submits, repeated corrections, stale reviews, simultaneous approvals, cancellation, cleanup and cursor pagination.
- Browser checks passed in headless Chromium at phone and desktop viewport sizes with test endpoints. They covered upload retries, pause, browser reload with IndexedDB recovery, offline/online resume, the three-round limit, the final download link and WhatsApp message contents.
- Full regression suites matched the previous failure set. Admin had 167 passing tests and one existing failure. The customer app had 204 passing tests and 35 existing failures.
- The staging walkthrough still requires your actual R2 credentials and bucket CORS, Firebase Auth email delivery, a shared Drive file and WhatsApp support number. Production deployment, physical-device testing and external message delivery were not performed in this workspace.
- Device storage and OS suspension affect recovery. When IndexedDB cannot hold the file, the app restores available metadata and asks for the original file. The editor must check the customer's Drive sharing permissions. The customer confirms review of each version. Opening WhatsApp records no delivery event.

Run the local integration checks from the Admin root with a Firebase CLI and an appropriate Java runtime installed:

```sh
firebase emulators:exec --only firestore --project demo-mlmlive-video --config firebase.production-rules-test.json "node --test --test-concurrency=1 tests/videoEditing.integration.mjs tests/videoEditing.rules.integration.mjs"
```

## Files in this release

| Project | Added | Modified |
| --- | --- | --- |
| Admin backend | `functions/video/domain.js`, `functions/video/storage.js`, `functions/video/functions.js` | `functions/paymentDomain.js`, `functions/paymentService.js`, `functions/paymentFunctions.js`, `functions/package.json`, `functions/package-lock.json` |
| Admin frontend and tests | `src/Pages/Video/VideoTeam.jsx`, `src/Pages/Video/Video.css`, `tests/videoEditing.test.mjs`, `tests/videoEditing.integration.mjs`, `tests/videoEditing.rules.integration.mjs` | `src/App.jsx`, `src/components/Sidebar.jsx`, `src/Utils/adminPageState.js`, `tests/adminPageState.test.mjs` |
| Customer web app | `src/pages/Video/VideoService.jsx`, `src/pages/Video/NewRequest.jsx`, `src/pages/Video/uploads.js`, `src/pages/Video/Video.css` | `src/App.jsx`, `src/components/Sidebar.jsx`, `src/pages/Subscription/MainSubscription.jsx` |

Both ZIPs include this guide. The Admin archive also includes the rebuilt Admin frontend and new backend SDK dependencies. The customer archive retains its existing source-build packaging.

[Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [Cloudflare multipart uploads](https://developers.cloudflare.com/r2/objects/upload-objects/) · [Firebase targeted deployment](https://firebase.google.com/docs/functions/manage-functions)
