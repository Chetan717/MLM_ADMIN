# MLM LIVE Admin — Add Form Startup Crash Fix (2026-10-16)

## What was wrong
In AddTemplate, AddCompanies and AddGraphics the useUnsavedFormGuard call read `loading` and `success` BEFORE their useState initialization. React threw a Temporal Dead Zone ReferenceError, minified as `Cannot access 'a' before initialization`.

## What changed
Moved the guard hook below the relevant useState declarations in 3 files. All save, Firestore, upload, permissions and backend code are otherwise unchanged.

## Deploy / safety
Preferred: build and deploy FULL ZIP to Vercel Preview, test Add Template, Add Company, Add Graphics, their save/discard controls and editing, then promote. Patch zip can instead be copied over existing source. No Firebase Functions deployment needed. No Storage deletions.

## Checks
All three files parsed successfully with TypeScript JSX transpiler; guard initialization order verified. npm ci could not finish in this environment, so full npm run build and live tests MUST still be run.
