# CDN Sync deadline fix

This build fixes the Admin **Sync CDN** `deadline-exceeded` problem on large template collections.

Changes:
- Admin callable timeout is 15 minutes instead of the Firebase client default.
- Initial catalog rebuild no longer writes one `catalog/v1/template/<id>.json` object for every template.
- It bootstraps individual detail JSON only for Festival templates (the current web app's direct per-template CDN use).
- Normal Add/Edit/Delete continues to update affected catalog JSON incrementally via `publishTemplateCatalogOnWrite`.

Deploy after replacing your current Admin project with this build:

```bash
firebase deploy --only functions:panelRebuildTemplateCatalog,functions:publishTemplateCatalogOnWrite
```

Then rebuild/deploy the Admin frontend as usual, open Templates, and click **Sync CDN** once.

If an older failed sync left the Firestore lock document `_systemLocks/templateCatalogR2`, do not delete it while an old function is still running. It expires automatically after its lease. If more than 10 minutes have passed since the failed sync and no old function is running, the new sync can take the expired lock automatically.
