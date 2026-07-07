# Phase 0–3 Deploy Runbook — current state + remaining steps

PR **#139** (Super-Admin control: Phase 0 + Phase 1/2/3) is **merged to `main`** (merge commit `53d9872`). Project: `gridiron-gamble-uzuqo`. This runbook reflects what's already done and exactly what's left.

---

## ✅ DONE
- [x] **#139 merged** to `main`.
- [x] **Cloud Functions deployed — all 8 changed:** `logClientError` (NEW), `scheduledHealthCheck` (NEW), `getAdminHealthSnapshot`, `adminInitTournament`, `syncBracketTournament`, `onUserCreated`, `syncAllUsers`, `searchUsersByEmail`. (`scheduledHealthCheck` also created its Cloud Scheduler job.)
- [x] **Firestore rules deployed:** `sim-*` pool/entry create → SUPER_ADMIN-only; `system_logs` create → functions-only; new `health/{doc}` (functions-write / SUPER_ADMIN-read).

> ⚠️ Because functions + rules are live but the **frontend** may still be old, prod can be briefly inconsistent: the new rules block the OLD frontend's direct `system_logs` writes, so **client error telemetry is broken until the new frontend is live** (Step 1). Not user-facing; just do Step 1 promptly.

---

## ▶️ REMAINING — do in this order

### Step 1 — Confirm the NEW frontend is deployed (Coolify)
Coolify auto-builds `main` on push. The earlier Coolify log built commit `8ad1da16` — that was **pre-#139** (old code, no crash fix). After the #139 merge (`53d9872`), Coolify should have triggered a fresh build.

- In Coolify, confirm the latest deployment's **commit SHA is `53d9872` (or later)**, not `8ad1da16`.
- If it did NOT auto-deploy the merge, **trigger a manual redeploy** of `main` in Coolify.
- Wait for the container healthcheck to pass.

Until this frontend is live, the crash fix + `logClientError` repoint aren't on prod.

### Step 2 — Post-deploy smoke tests (as SUPER_ADMIN, ~3 min)
Do these ONLY after Step 1 confirms the new frontend is serving. The earlier "Open Simulation Dashboard still crashes" test was against the OLD build — re-test now:
- [ ] Test Suite → **Open Simulation Dashboard** — no white-screen (this was the reported crash).
- [ ] Test Suite → **Run All (15)** — completes (confirms admin sim writes still pass the tightened `sim-*` rules).
- [ ] Test Suite → **Open Tournament Simulator** → it creates a sim pool (confirms `sim-*` create works for admin post-rule-change).
- [ ] Pools tab → NFL/PROPS pool rows show a real matchup label, **not "undefined @undefined"**, and show a lifecycle badge (open/locked/live/final/closed).
- [ ] Pools tab → the **Closed** status filter chip appears.
- [ ] Overview → API Status Center shows a "Last checked …" time (from `health/latest`; the hourly `scheduledHealthCheck` populates it — first run may take up to an hour, or click **Run Check**).
- [ ] Trigger any client error (or watch Firestore) → a `system_logs` doc still appears **via `logClientError`** (depends on Step 4 — App Check).

### Step 3 — Backfill `searchName` (server-side name search)
`onUserCreated`/`syncAllUsers` now write a `searchName` field; existing users don't have it yet.
- [ ] Dashboard → **Members → Force Sync** (runs `syncAllUsers`) once. Backfills `searchName` for all existing users.
- After this, server-side search matches **name OR email**. (The instant client-side Members filter already worked without this.)
- Firestore auto-creates the single-field index on `searchName` — no config needed.

### Step 4 — Confirm App Check is enforced (or client error logging drops)
`logClientError` sets `enforceAppCheck: true`. The web app initializes App Check (ReCaptcha Enterprise, `src/firebase.ts:26`).
- [ ] In Firebase console → App Check: confirm the **web app is registered and enforcing**.
- If App Check is NOT fully configured in prod, client errors will be **rejected** (silently lost). Fix: finish App Check config, **or** temporarily set `enforceAppCheck: false` in `functions/src/logClientError.ts` and redeploy that one function, then re-enable once App Check is set up.

### Step 5 — Rotate the plaintext Stripe TEST secret (your action — I can't)
`functions/.env` (lines 1–2) has a commented-but-real-format Stripe **test** secret key + webhook secret in cleartext. Even commented + gitignored:
- [ ] Delete those two lines from `functions/.env`.
- [ ] Rotate the key + webhook secret in the Stripe dashboard (test mode).
- Prod secrets are already in Secret Manager — fine, no action.

### Step 6 — Fix pre-existing Coolify env misconfig (not from this PR; do before adding Storage)
The build env in Coolify has two malformed values (harmless today — no Firebase Storage in use, auth still works — but wrong):
- [ ] `VITE_FIREBASE_STORAGE_BUCKET` is set to the literal string `"VITE_FIREBASE_MESSAGING_SENDER_ID=1042141442549"`. Set it to the real bucket, e.g. `gridiron-gamble-uzuqo.appspot.com`.
- [ ] `VITE_FIREBASE_AUTH_DOMAIN` is doubled (`…firebaseapp.com=…firebaseapp.com`). Set it to `gridiron-gamble-uzuqo.firebaseapp.com`.
- Fix these before you ever enable uploads/Storage.

---

## Dependabot PRs (separate from Phase 0 — do NOT batch, one at a time, verify build each)
- **#138** (typescript 6.0.3) — **fixed + green + MERGEABLE** (added `ignoreDeprecations: "6.0"`; verified TS6 build clean + 207 tests). Merge at will; dev-only.
- **#135** (@types/node 26) — safe standalone; merge next.
- **#130** (minor-patch group of 4) — CONFLICTING; needs rebase onto new `main`, then merge.
- **#133** (tailwindcss 4) — CONFLICTING + real v3→v4 breaking migration; **dedicated effort, later.**
- **#8** (@eslint/js 10) — stale + conflicting; **close it** (Dependabot re-raises if still needed).
- **#131, #134** (vite 8 / plugin-react 6) — **already closed** (paired-major deadlock; redo as one combined branch if ever wanted).

---

## Rollback (if a smoke test fails)
- **Frontend:** redeploy the prior Coolify build (or revert the merge and let Coolify rebuild).
- **Rules:** re-deploy the previous `firestore.rules` (from a pre-#139 commit) via `npx firebase deploy --only firestore:rules`.
- **Functions:** roll back individual functions in the Firebase console, or `git revert` + redeploy.
- **Fastest de-risk for the telemetry/rule interaction:** ensure Step 1 (new frontend) is live — that alone resolves the transient split-state.
