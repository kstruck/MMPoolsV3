# Phase 0 — Deploy Checklist (action required by Kevin)

Branch: `fix/superadmin-phase0-control` (commit `42c7c57`). Code is written, typechecked, and tested locally (functions build + root build: 0 errors; 203/203 root + 96/96 functions tests). **Nothing has been deployed to prod.** Do these in order.

## 1. Review + merge the branch
- `git checkout fix/superadmin-phase0-control` and skim the diff, or open a PR to `main`.
- CI (ci.yml) will re-run build + tests + nginx validate.

## 2. Deploy Cloud Functions (needed BEFORE the rules, or client error logging breaks)
The new `logClientError` callable must exist before `system_logs` create is locked, else front-end error telemetry silently drops. The new `scheduledHealthCheck` (hourly) + updated `getAdminHealthSnapshot` persist to `health/latest`.
```
npm --prefix functions install     # only if deps changed
npx firebase deploy --only functions:logClientError,functions:getAdminHealthSnapshot,functions:scheduledHealthCheck,functions:adminInitTournament,functions:syncBracketTournament --project gridiron-gamble-uzuqo
```
(Or deploy all functions if easier.) Verify `logClientError` + `scheduledHealthCheck` show in the Firebase console functions list. `scheduledHealthCheck` will also create a Cloud Scheduler job (approve any prompt). Note: Phase 1.2 also added a `computeAdminHealthSnapshot` helper — no separate deploy, it ships inside adminHealth.

## 3. Deploy Firestore rules (AFTER functions are live)
```
npx firebase deploy --only firestore:rules --project gridiron-gamble-uzuqo
```
Changed rules: `pools` create `sim-*` now SUPER_ADMIN-only; `pools/*/entries` write now SUPER_ADMIN-only for the sim path; `system_logs` create now functions-only; new `health/{doc}` collection (functions-write, SUPER_ADMIN-read).

## 4. Deploy the frontend (nginx/Coolify — per your normal www deploy)
The client changes (crash fix, per-tab ErrorBoundary, formatPoolMatchup, errorHandler repoint, TournamentSimulator status fix) ship with the normal www build/deploy. firebase.json rewrites do NOT apply to www (nginx/Coolify) — deploy through your usual Coolify path.

## 5. Post-deploy smoke tests (2 min, as SUPER_ADMIN)
- [ ] Test Suite → **Open Simulation Dashboard** no longer white-screens the app.
- [ ] Test Suite → **Run All (15)** still completes (confirms admin sim writes still pass the tightened rules).
- [ ] Tournament Simulator (header button) still creates a sim pool (confirms `sim-*` create works for admin).
- [ ] Trigger any client error (or check Firebase logs) → confirm a `system_logs` doc is still written via `logClientError` (App Check must be configured for the web app, else these drop — see item 7).
- [ ] Pools tab rows for NFL/PROPS pools show a real matchup label, not "undefined @undefined".

## 6. Rotate the plaintext Stripe test secret (I could NOT do this — your action)
`functions/.env` lines 1-2 contain a commented-out but real-format Stripe TEST secret key + webhook secret in cleartext. Even commented + gitignored, delete them from the file and rotate in the Stripe dashboard (test mode). Prod secrets are already in Secret Manager and are fine.

## 7. Confirm App Check is enforced for the web app
`logClientError` sets `enforceAppCheck: true`. The web app already initializes App Check (ReCaptcha Enterprise, `src/firebase.ts:26`). Verify the App Check provider is registered/enforcing in the Firebase console so legit client errors aren't rejected. If App Check is NOT fully configured in prod, either finish that config or temporarily set `enforceAppCheck: false` in `functions/src/logClientError.ts` and redeploy (tracked as a follow-up).

## Rollback
- Rules/functions: redeploy previous versions (`git revert 42c7c57` then deploy), or roll back functions in the console.
- Frontend: redeploy prior Coolify build.
