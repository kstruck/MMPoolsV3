# Morning Checklist — Buy-Flow Overhaul

_Overnight run 2026-07-06 → 07-07. Branch `feat/buyflow-overhaul` in worktree D:\mmp-buyflow. Everything below is LOCAL ONLY — nothing deployed to prod, no prod data mutated. Your job in the morning is review → decisions → deploy, in the order given at the bottom._

---

## A. Decisions I need from you (blocked items, non-destructive to leave)

_These did not stop the build; I picked a safe default and flagged it here. Change if you disagree._

1. **Deep-link to `/pricing?poolId=X` for a NON-trial pool** — new visitor-state UX only renders the checkout card when the user has trial pools. Old page let you pay for any pool by ID. If any email/reminder links a non-trial pool to /pricing, that path now shows the estimator instead of a pay button. _Default: kept the new clean UX._ Action: confirm no transactional email deep-links non-trial pools to /pricing (grep the mail templates).

2. **NFL & Squares pools launch `free` (not `trial`) at creation** — their create payloads carry no player-count field, so the free/trial rule can't see a size and defaults to `free`. This is behavior-equivalent to today and NOT a money hole: the existing join-time 10-player free lock forces payment at the 11th participant, and paid-ceiling enforcement kicks in once paid. _Default: kept._ Action: confirm you're OK gating NFL/Squares at join (11th player) rather than at creation. If you want NFL pools to estimate size at creation, the wizard launch step (Wave 4) can pass an estimate.

3. **Anonymous (logged-out) users still cannot enter the wizard** — the plan's target was try-before-signup (build a device-local draft, sign in at the launch step). The launch step itself is built and takes a uid, but the wizard routes are still behind the existing auth gate (that's an upstream `App.tsx` routing change, outside the wave's scope). _Default: kept the auth gate._ Action: decide if you want anon wizard entry now; it's a follow-up routing task, not a buy-flow blocker. Everything else in the flow works for logged-in users.

4. **"Redeem a Pool Credit" in the wizard needs the bundles rules deployed** — the launch step only shows the Redeem option when it can read the user's bundles, which requires the Wave-5 `bundles` read rule (in this branch, deploys with the rest). Until rules deploy, the option just stays hidden (no crash). No action beyond deploying rules; noted so it's not mistaken for a bug during UAT before deploy.

5. **[OPEN — you asked me to remind you] Should NFL Playoff pools offer the What-If Simulator add-on?** Today the What-If Simulator (+$9) is gated to `BRACKET` format only, in both the estimator and the checkout ([BillingInvoiceCard.tsx:556](src/components/billing/BillingInvoiceCard.tsx), [PricingPage.tsx:450](src/components/PricingPage.tsx)). NFL Playoff pools are bracket-style but currently excluded. _Default: Bracket-only (unchanged)._ Decision: add `PLAYOFF` to the gate too? It's a one-line change in both files. **Kevin: decide this.**

_(complete — see sections B–D)_

---

## B. Things ONLY you can do (external systems — I have no access)

_Filled in as waves complete. Stripe dashboard, secret rotation, Coolify deploy, migration run all land here._

- **Stripe Dashboard — enable 3 new webhook events** on the endpoint that hits `handleStripeWebhook` (Developers → Webhooks → your endpoint → "Select events"): `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`. `checkout.session.completed` is already on. Until enabled: refund/dispute ledger rows and reservation-release-on-expiry do not fire.
- **Stripe TEST-key rotation still pending** (pre-existing, owner-attested 2026-07-06): while STRIPE_SECRET_KEY is a placeholder, checkout silently activates purchases for FREE via the mock path (functions/src/stripe.ts). Rotate to a real Stripe TEST secret key (Firebase Secret Manager: `firebase functions:secrets:set STRIPE_SECRET_KEY`) before ANY money-path UAT, or every test "purchase" is fake-free.
- **Verify redirect host**: Wave 2 changed the checkout redirect fallback origin from `https://marchmelee.com` to `https://www.marchmeleepools.com`. Confirm that is your live host. If the app is served from another origin, set Functions env `BUYFLOW_ALLOWED_ORIGINS` (comma-separated) — no secret needed.
- **(Optional, after dry-run review) enable coupon-reservation sweep**: set `system/config.couponSweep = { enabled: true, dryRun: false }` in Firestore. Safe to leave off — reservations still release on `checkout.session.expired`; the sweep only reclaims sessions that never emit expiry. Review a few dry-run log lines first.
- **Entitlement migration (`scripts/migrate-entitlements.mjs`)** — converts legacy `freePoolsAvailable`/`poolCredits`/`activeBundleType` into the new `bundles/` model. DRY-RUN by default, NOT yet executed. Run ONLY during the Phase-4 cutover freeze, in order: (1) flag off new bundle checkouts + drain in-flight bundle sessions; (2) freeze grants/redemptions; (3) `node scripts/migrate-entitlements.mjs` (dry-run) → review per-user census; (4) `node scripts/migrate-entitlements.mjs --commit` inside freeze; (5) verify census parity; (6) flip legacy readers + unfreeze. Needs `./serviceAccountKey.json`. Kill switch: `MIGRATION_ABORT=1`. _If you have no real bundle owners in prod yet, this migration is a no-op and can be skipped._
- **Deploy `firestore.indexes.json`** — Wave 5 adds a `bundles` composite index (ownerId+productKind+status) needed by credit redemption. Deploy indexes with rules/functions (`npx firebase deploy --only firestore:indexes`).
- **Rules were NOT emulator-tested overnight** — this machine has no Java, so the Firestore emulator (and the rules unit tests) could not run here. The rules are hand-reviewed and mirror the repo's existing patterns exactly. They are validated at DEPLOY: `npx firebase deploy --only firestore:rules` compiles them server-side and rejects any syntax error BEFORE applying (a bad rule blocks the deploy, it does not corrupt prod). A runnable rules-test file is provided (see section D) for you to run in your Java-enabled env if you want belt-and-suspenders before deploying.
- **(Optional, after dry-run review) enable coupon-abuse alerts**: set `system/config.monetizationAlerts = { enabled: true, dryRun: false, velocityThreshold: 10, notifyEmail: "kstruck@gmail.com" }`. Same rollout pattern as autoClose: leave `dryRun:true` first, review a run's audit output, then flip. Abuse alerts (velocity spike, new-account cluster) email you; near-max/expiring are dashboard-only. Accounting dashboard works without this job (it reads the ledger live) — the job only powers the alert center + emails.

---

## C. Pre-existing issues found (not caused by this work; fix later unless noted)

- **SMS add-on never charged** — ✅ FIXED in Wave 2 (server prices all add-ons incl. SMS in getPoolQuote; BillingInvoiceCard now shows it).
- Duplicate Firestore listeners on `settings/billing_config` (PricingPage + BillingInvoiceCard) — perf nit, not addressed.
- PricingPage top-level bundle buttons lack loading/disabled state during checkout redirect — polish, not addressed.
- `PropsWizard/PropsWizard.tsx` is a legacy separate wizard (the live Props flow is `wizard/create/CreatePropsPool.tsx`). Left untouched; candidate for deletion in a later cleanup.

---

## C2. Fixes made DURING live UAT (2026-07-07) — verified locally, some need a redeploy

_Found by Kevin while testing the deployed sandbox. All committed on the branch._

1. **Prod `settings/billing_config` predated the new schema → getPoolQuote returned $0 everywhere.** Fixed at runtime by deleting the doc and letting the Super-Admin Billing panel re-seed the canonical config (real prices). If you ever see FREE/$0 pricing again, re-save the config from Super-Admin → Billing.
2. **`loadBillingConfig` hardening (you approved this):** `computeBasePrice` now THROWS `PRICING_NOT_CONFIGURED` when a paid-size pool hits empty pricing tiers, instead of silently pricing $0. getPoolQuote surfaces "pricing unavailable"; a broken config can no longer let a pool activate free. **Needs a functions redeploy** (`npx firebase deploy --only functions`).
3. **Checkout crashed with "couponCode — expected string, received null."** The Firebase callable SDK encodes `undefined` → `null`, failing the server's `.optional()` string schema. Fixed in `dbService.createCheckoutSession` by stripping undefined/null keys before the call (client-side; no redeploy).
4. **Phantom "+$29 Custom Branding" auto-added at checkout** (BillingInvoiceCard defaulted `hasCustomBranding=true`, and pricing-page add-on toggles were wizard-only). Fixed: add-ons default OFF (opt-in), and the add-on toggles now render on the pricing-page checkout too (with paid copy) so a commissioner can opt in.
5. **Checkout used the estimator's player count (40), not the pool's.** Fixed: selecting a pool now shows an adjustable "Adjust Participant Estimate" slider defaulting to the pool's `estimatedPlayers`. NOTE: pools created BEFORE this work don't store `estimatedPlayers` (they fall back to 30); newly-created pools carry the real estimate. The estimator's editable format selector is hidden when a specific pool is selected (format is fixed to the pool).

**Action:** redeploy functions once more to pick up fix #2 (`npx firebase deploy --only functions`), and note the client fixes (#3–5) only reach users after the Coolify frontend deploy.

---

## D. Morning run order (do these top-to-bottom)

All work is on branch `feat/buyflow-overhaul` (worktree `D:\mmp-buyflow`), committed, not pushed unless the final summary says otherwise. Firebase project: `gridiron-gamble-uzuqo`. Use `npx firebase` (no global CLI).

### Step 1 — Review the branch (~15 min)
1. Read this whole file, then skim `PLAN-BUYFLOW-OVERHAUL.md` and the per-wave `NOTES-WAVE*.md` at the worktree root.
2. Look at the diff: `cd D:\mmp-buyflow && git log --oneline main..feat/buyflow-overhaul` then `git diff main...feat/buyflow-overhaul --stat`. (If a PR was opened, review it there instead.)

### Step 2 — Local verification (prove it's green on your machine, ~5 min)
```
cd D:\mmp-buyflow
npm install
npm --prefix functions ci        # ci, NOT install (install rewrites the lockfile)
npm --prefix functions run build      # expect exit 0
npm --prefix functions run test       # expect 288 passing
npx tsc --noEmit -p tsconfig.app.json # expect 0 errors
npx vitest run                        # expect 226 passing
```
Optional (needs Java): validate rules in the emulator —
```
npx firebase emulators:exec --only firestore "node functions/scripts/monetization.rules.test.mjs && node functions/scripts/squarePrivate.rules.test.mjs"
```

### Step 3 — Merge to main
3. Merge `feat/buyflow-overhaul` → `main` (via the PR, or `git checkout main && git merge feat/buyflow-overhaul`).

### Step 4 — Deploy (functions BEFORE rules — repo ritual)
4. `npm --prefix functions ci` (avoids the stripe/fft TS2307 on deploy). **`ci`,
   not `install`** — `install` rewrites `functions/package-lock.json` and dirties
   the tree `firebase deploy` packages.
5. `npx firebase deploy --only functions` — this creates two NEW scheduled jobs (`releaseStaleCouponReservations`, `monetizationAlerts`), both OFF/dry-run by default, and the new callables (`getPoolQuote`, `adminGrantEntitlement`, `adminRevokeEntitlement`, `redeemPoolCredit`, coupon-template + alert callables). Confirm Cloud Scheduler is enabled for the project if prompted.
6. `npx firebase deploy --only firestore:rules,firestore:indexes` — **this is where the new rules get compiled + validated.** A syntax error blocks the deploy (it will NOT corrupt prod); if it complains, tell me and I'll fix. The `bundles` composite index may take a few minutes to build.
7. Trigger the **www frontend deploy in Coolify** (pushing to main does NOT deploy the frontend — nginx serves it). This ships the pricing-page + wizard + admin dashboard changes.

### Step 5 — Stripe configuration (external, required before money-path UAT)
8. Stripe Dashboard → Developers → Webhooks → your `handleStripeWebhook` endpoint → enable events: `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` (see §B).
9. Rotate `STRIPE_SECRET_KEY` to a real Stripe TEST key: `npx firebase functions:secrets:set STRIPE_SECRET_KEY` then re-deploy functions. **Until this is done, checkout is mock-free — every "purchase" activates for $0** (§B).
10. Confirm the redirect host is `https://www.marchmeleepools.com`, or set `BUYFLOW_ALLOWED_ORIGINS` (§B).

### Step 6 — Smoke test (money path, Stripe sandbox)
11. Run the money-path UAT from `PLAN-BUYFLOW-OVERHAUL.md` → Test plan → Layer 3 (17-item checklist: each visitor type, each pool format across tier boundaries, coupons incl. the max-uses race and per-user limit, bundles + redemption, refund, alerts). Record evidence (screenshot + `billingCharges` row + Stripe dashboard link) per the plan.
12. Verify the **Accounting** tab (Super-Admin → Billing → Accounting): revenue cards populate from the ledger, coupon usage timeline, bundle liability, user money profile search.

### Step 7 — Optional enables (after a dry-run review each)
13. Coupon-reservation sweep: `system/config.couponSweep = { enabled: true, dryRun: false }` (§B). Safe to leave off.
14. Coupon-abuse alerts: `system/config.monetizationAlerts = { enabled: true, dryRun: false, velocityThreshold: 10, notifyEmail: "kstruck@gmail.com" }` (§B).

### Step 8 — Entitlement migration (ONLY if real bundle owners already exist in prod)
15. If nobody has purchased a bundle under the OLD system yet, **skip** — the new model starts clean. Otherwise run the freeze→dry-run→commit→verify→unfreeze sequence in §B. Check first: any `users/*` docs with a non-zero `freePoolsAvailable` / non-empty `poolCredits` / an `activeBundleType`? None → skip.

### Step 9 — Resolve the §A decisions
16. Answer the four decisions in section A (deep-link, NFL/Squares launch-free, anon wizard entry, redeem-needs-rules). All have safe defaults already in place; none block deploy.

---

### What's done vs. what needs you
**Done overnight (code complete, tests green, committed):** tooltip fix, visitor-state pricing page, server-authoritative quote engine, coupon reserve/confirm/release with hard limits, refund/dispute handling, transactional ledger, launch billing mode, paid-ceiling enforcement, canonical bundles/credits + admin grant/revoke + redemption, migration script (unrun), accounting dashboard + alert center + coupon templates, wizard launch step across all 7 flows, Firestore rules + index for every new collection, runnable rules test.

**Needs you (can't be automated / external):** deploy (functions/rules/indexes/Coolify), Stripe webhook events + test-key rotation, the money-path UAT in Stripe sandbox, the optional job enables, the migration (if applicable), and the four §A decisions.
