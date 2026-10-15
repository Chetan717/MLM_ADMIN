# Admin Save / Discard / Continue Editing Guard

Covered forms: Templates Add/Edit, Companies Add/Edit, Graphics Add/Edit.

- Changing a form then pressing in-form Back/Cancel, Sidebar navigation, Header Login Activity, or browser/mobile Back opens an unsaved changes popup.
- **Save** triggers the existing form's `requestSubmit()`. Navigation proceeds only after the existing Firestore save reports success. Validation/save failures remain on the form.
- **Discard** leaves without saving form edits. It **does not delete R2 objects**, including any newly uploaded media. Already-referenced/shared media remains safe.
- **Continue Editing** closes the popup and stays in the form.
- Reload/tab close triggers the browser's standard unsaved-changes prompt; browsers do not permit a customized 3-button modal here.
- Other workflows/modal-based forms are not included in this patch.

## Deployment

Copy the matching `src/` files over your latest R2-enabled Admin source, then test in Vercel Preview. No Firebase Functions or Firestore rules deployment needed.

## Required Preview tests

1. Open Add Template; change title; Back -> popup. Continue Editing -> remains.
2. Add an R2 image; Cancel -> popup. Discard -> no Firestore document created; do not assume new R2 object deleted.
3. Edit Company; change logo; Sidebar -> popup; Save -> updated Firestore, then navigates.
4. Edit Graphics; browser Back -> popup; Continue Editing stays.
5. Form validation failure -> Save must not navigate.
6. Hard browser reload -> native browser confirmation (not custom popup).

## Limitation

Only these 6 forms are guarded. Other Admin forms, e.g. music modal, task modal and inline list editors, need separate integrations if required. Orphan R2 garbage-collection is a separate project needing proven reference tracking and an aging/retention window.
