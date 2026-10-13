# MLM LIVE — Admin R2/CDN optimization (preview release, 12 Oct 2026)

## Scope and baseline

Base: `MLM_ADMIN_R2_READY(2).zip`. Changes are intentionally limited and reversible. No live service or Firestore data has been changed by generating this ZIP.

### Implemented

1. **New template R2 media uses `https://cdn.mlmposter.com`:** both Functions default and `functions/.env.mlmbooster-a4887` updated.
2. **Legacy R2 media support:** deletion/reference checking still accepts the exact old template and profile `pub-*.r2.dev` origins. Arbitrary or mismatched origins are rejected.
3. **Catalog media normalization:** publishing the R2 template catalog converts *known legacy R2 template media* URLs to the equivalent custom CDN domain, without changing Firestore documents. Firebase Storage URLs are left unchanged. Run a manual **Sync CDN** after deploying and checking the domain so existing catalog content is republished.
4. **Heavy Admin reads gated:** Templates, Template Data Report, Companies, and User Leads do not automatically run full collection scans on opening their tabs. Explicit Fetch/Refresh retains the existing data and UI behavior. User Leads still performs four full collection reads once clicked.
5. **Template catalog trigger lock:** lease extended to 6 minutes (trigger timeout is 5 minutes) to reduce lock expiry during an in-flight publish.
6. **Regression tests:** 63/63 tests passed (`npm test`); TypeScript parser used to check JS/JSX syntax and Node syntax checks passed for Functions.

### Not yet claimed or solved

- 100,000-user load-test certification: **NOT DONE**. Need load tests, traffic profiles, performance budgets, monitoring and capacity tests.
- Admin Leads server-side pagination / denormalized index: **NOT IMPLEMENTED**. At 100k users, clicking Fetch User Leads still reads all users, profiles, subscriptions and lead management documents and could be slow/expensive. Limit Admin access to this bulk fetch until index and server-side pagination are built.
- Migrating legacy *Firebase Storage* files to R2: **NOT DONE**. Cloudflare cache rules alone do not reduce reads/bandwidth of existing Firebase Storage URLs. Requires separately verified copy, checksum/URL update, rollback and staged deletion.
- Old R2 media remains on old origin in Firestore, but newly published template catalog serves those known old R2 images from custom CDN. Existing profiles may still have old saved URLs; already-saved URLs must be handled separately in the App display path if complete profile CDN migration is desired.
- No secrets were rotated, Firestore records changed, Cache Rules installed, Vercel settings changed, or Firebase functions deployed from this sandbox.
- Actual production build/deployment and live R2 upload/delete/caching tests are **NOT RUN**. The Admin root had no `node_modules` available for a local Vite build.

## Required Cloudflare rules BEFORE using production

For `cdn.mlmposter.com`:
- `hostname=cdn.mlmposter.com AND path=/catalog/v1/version.json`: **Bypass cache** (or honor origin no-store), never forced 7-day TTL. Confirm this rule takes precedence over any broad CDN rule.
- `hostname=cdn.mlmposter.com AND path starts /catalog/v1/` (excluding version manifest): honor origin Cache-Control (`max-age=300`) or use small TTL. Do not force 7 days for changing catalog JSON.
- `/templates/` images: long Edge TTL (7–30 days) acceptable because uploads have unique names and immutable Cache-Control.
For `profile.mlmposter.com`: 7-day Edge TTL for unique-named images, but verify old URL behavior and account privacy requirements. Never cache authenticated personal JSON.
For `models.mlmposter.com`: up to 1 year immutable cache for verified static/versioned model assets.

Note: Browser and Edge caches are independent. Recheck origin response headers and `CF-Cache-Status` for actual media URLs; first request is not guaranteed to HIT, and POP-specific caches may vary.

## Beginner-friendly safe deploy and rollback

1. Save backups of current Admin, Web App, Functions, R2 bucket and Cloudflare rules. Confirm the **three custom domains** serve real objects with HTTP 200.
2. Configure above cache rules. In particular, fix `/catalog/v1/version.json` before enabling CDN JSON traffic.
3. Run from Admin project directory: `npm ci`, then `npm test`, then `npm run build`. Fix or stop on errors.
4. Ensure `functions/.env.mlmbooster-a4887` has `R2_BUCKET=mlmlive-media`, `R2_PUBLIC_BASE_URL=https://cdn.mlmposter.com`, `R2_PROFILE_BUCKET=mlmlive-storage-private`, `R2_PROFILE_PUBLIC_BASE_URL=https://profile.mlmposter.com`. Confirm matching R2 bucket/custom-domain mappings in Cloudflare.
5. Check Firebase project: `firebase use mlmbooster-a4887`. From Admin root deploy only changed R2 functions first (do **not** deploy all functions by default):
   `firebase deploy --only functions:panelCreateR2TemplateUpload,functions:createR2ProfileUpload,functions:deleteR2ProfileObject,functions:panelRebuildTemplateCatalog,functions:publishTemplateCatalogOnWrite`
   Changes affect future invocations; do this during a quiet Admin edit window.
6. Smoke test `createR2ProfileUpload`, `deleteR2ProfileObject`, new Template image upload and update. Verify returned `publicUrl` uses custom CDN hostname. Verify existing R2 photo remains visible.
7. Deploy Admin UI after preview/build test (`firebase deploy --only hosting` **only if** Admin is still hosted in this Firebase project; otherwise use its actual hosting provider). Admin data no longer auto-fetches; click Fetch/Refresh to load.
8. Click **Sync CDN** once (intentionally reads full template collection; do off-peak). Check `https://cdn.mlmposter.com/catalog/v1/version.json` returns updated data, and template catalog images use custom domain. Watch function logs/Cloudflare metrics.
9. Use the previously prepared **Web App preview ZIP** separately in Vercel Preview; test Home, Festival, Editor, profile photo upload/delete and RemoveBG models before a production promotion.
10. Monitor Firebase reads, Storage egress, R2 Class B/A operations, Cloudflare cache ratio, 4xx/5xx errors and Function timeouts for 24–48h. Stop promotion if regression appears.

**Rollback:** Redeploy the backed-up Admin/Functions version and previous env values, and restore previous CDN rule settings if required. Never delete old R2 or Firebase Storage media during rollback. Existing Firestore records are not migrated by this patch.

## Future phase for 100k users

- Denormalized `leads_index` materialized on user/profile/subscription updates with server-side, cursor-based pagination, composite indexes and filtered export jobs.
- Per-company and per-type Admin lists paginated; no 100k-row browser joins.
- Admin permission enforcement server-side (security rules/Functions) verified, with quotas, audit logs and App Check where appropriate.
- Versioned immutable CDN media with smaller responsive thumbnails; verified media migration from Firebase Storage to R2.
- Scheduled cost dashboard + alerts; measure p50/p95 latency and billing during staged traffic load tests (1k → 10k → 100k concurrency patterns based on actual usage, not assumed concurrent users).
