# MLM LIVE Admin — Safe R2-only uploads + permissions

Changes: all ImageUploadInput and VideoUploadInput uploads (templates, companies, graphics, music) use a new signed R2 uploader callable `panelCreateR2AdminMediaUpload`. Existing Cloud Functions remain untouched; add/deploy only new callable plus assigned permissions functions. Never deploy all Functions.

Remove and Replace: confirmation popup; only the form field changes. File is **NOT** physically removed from R2 because the same URL can be referenced by multiple records. Canceling form does not remove old reference. A brand-new R2 upload abandoned before saving may remain orphaned; periodic reference-aware cleanup with an audit index would be a separate safe project.

Deploy sequence: `cd functions && npm ci && cd ..` then `firebase deploy --only functions:panelCreateR2AdminMediaUpload,functions:panelPushOverview,functions:panelSendPushNotification,functions:panelCreateDeleteRequest --project mlmbooster-a4887`. Verify Cloud Functions deployment before deploying Admin Vercel preview. Backend changes may rely on already configured R2 secrets and R2 CORS allowing PUT, GET, HEAD.

Important: This handles the shared Admin upload components, not arbitrary manually-written Firebase Storage uploads outside them. Check Firebase Storage usage logs and remaining direct SDK calls before declaring universal R2-only. Keep the original storage and all deployed Functions.

Safety checks: Company logo, top-upline, template showcase and video, graphics, music audio upload; cancel Replace; cancel Remove; save Remove; shared image remains available in other document; non-master assigned notification sending and template-delete request.
