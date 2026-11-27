# MLMLive — Video Editing workspace redesign

Base: MLM_ADMIN_COMPLETE_UPDATED.zip (the earlier video-service implementation).

Changed source files only:
- src/Pages/Video/VideoTeam.jsx
- src/Pages/Video/Video.css

Both `/video-editing` (inside existing Admin shell) and `/video-team` (separate login and workspace) use the same updated component. Features: blue top bar, responsive navigation, live dashboard counters, filtered/paginated request list, raw thumbnail and duration where available, request timeline, customer information, editing instructions, role-gated actions, on-demand Google Drive preview, WhatsApp support from existing service configuration, team accounts and settings. Request history remains in the detail screen. No fabricated counts or thumbnails; use existing backend fields. The exact mockup was adapted to existing fields and permissions. Editors only submit for customer review; no new editor approval action. No Firebase function, rules, indexes, environment variables, payment or R2 changes.

## Install
Back up the existing project. Copy both files from the patch into the same `src/Pages/Video/` path in your current Admin project. Keep `.env` and the existing lockfile. If necessary install dependencies with `npm ci`, then `npm run build`. Deploy your Admin frontend to Vercel normally. No new dependencies and no Firebase redeployment required for this UI-only update. Existing Firebase email/password sign-in must already be enabled for the separate team panel.

## Verification
- TypeScript JSX syntax and transpilation: passed.
- PostCSS parse: passed.
- Existing add-form source verification: passed.
- Existing video domain tests: 16 passed, 2 R2 SDK tests blocked by missing @aws-sdk/client-s3 in this environment.
- Full Vite build blocked: vite is not installed in this runtime. Browser, authenticated Firebase and Drive preview tests were not performed.

Before production: verify login/reset, admin/manager/editor roles, dashboard counts, filter and page navigation, request details, preview access, edit/review submission, archive/restore, raw deletion and mobile widths. Test using existing authorized accounts and non-production requests. Google Drive iframe requires valid sharing permissions; Open edited version remains available.
