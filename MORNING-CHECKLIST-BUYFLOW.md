# Morning Checklist — Buy-Flow Overhaul

_Overnight run 2026-07-06 → 07-07. Branch `feat/buyflow-overhaul` in worktree D:\mmp-buyflow. Everything below is LOCAL ONLY — nothing deployed to prod, no prod data mutated. Your job in the morning is review → decisions → deploy, in the order given at the bottom._

---

## A. Decisions I need from you (blocked items, non-destructive to leave)

_These did not stop the build; I picked a safe default and flagged it here. Change if you disagree._

1. **Deep-link to `/pricing?poolId=X` for a NON-trial pool** — new visitor-state UX only renders the checkout card when the user has trial pools. Old page let you pay for any pool by ID. If any email/reminder links a non-trial pool to /pricing, that path now shows the estimator instead of a pay button. _Default: kept the new clean UX._ Action: confirm no transactional email deep-links non-trial pools to /pricing (grep the mail templates).

2. **NFL & Squares pools launch `free` (not `trial`) at creation** — their create payloads carry no player-count field, so the free/trial rule can't see a size and defaults to `free`. This is behavior-equivalent to today and NOT a money hole: the existing join-time 10-player free lock forces payment at the 11th participant, and paid-ceiling enforcement kicks in once paid. _Default: kept._ Action: confirm you're OK gating NFL/Squares at join (11th player) rather than at creation. If you want NFL pools to estimate size at creation, the wizard launch step (Wave 4) can pass an estimate.

_(more will be appended as later waves run)_

---

## B. Things ONLY you can do (external systems — I have no access)

_Filled in as waves complete. Stripe dashboard, secret rotation, Coolify deploy, migration run all land here._

- **Stripe Dashboard — enable 3 new webhook events** on the endpoint that hits `handleStripeWebhook` (Developers → Webhooks → your endpoint → "Select events"): `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`. `checkout.session.completed` is already on. Until enabled: refund/dispute ledger rows and reservation-release-on-expiry do not fire.
- **Stripe TEST-key rotation still pending** (pre-existing, owner-attested 2026-07-06): while STRIPE_SECRET_KEY is a placeholder, checkout silently activates purchases for FREE via the mock path (functions/src/stripe.ts). Rotate to a real Stripe TEST secret key (Firebase Secret Manager: `firebase functions:secrets:set STRIPE_SECRET_KEY`) before ANY money-path UAT, or every test "purchase" is fake-free.
- **Verify redirect host**: Wave 2 changed the checkout redirect fallback origin from `https://marchmelee.com` to `https://www.marchmeleepools.com`. Confirm that is your live host. If the app is served from another origin, set Functions env `BUYFLOW_ALLOWED_ORIGINS` (comma-separated) — no secret needed.
- **(Optional, after dry-run review) enable coupon-reservation sweep**: set `system/config.couponSweep = { enabled: true, dryRun: false }` in Firestore. Safe to leave off — reservations still release on `checkout.session.expired`; the sweep only reclaims sessions that never emit expiry. Review a few dry-run log lines first.
- **Entitlement migration (`scripts/migrate-entitlements.mjs`)** — converts legacy `freePoolsAvailable`/`poolCredits`/`activeBundleType` into the new `bundles/` model. DRY-RUN by default, NOT yet executed. Run ONLY during the Phase-4 cutover freeze, in order: (1) flag off new bundle checkouts + drain in-flight bundle sessions; (2) freeze grants/redemptions; (3) `node scripts/migrate-entitlements.mjs` (dry-run) → review per-user census; (4) `node scripts/migrate-entitlements.mjs --commit` inside freeze; (5) verify census parity; (6) flip legacy readers + unfreeze. Needs `./serviceAccountKey.json`. Kill switch: `MIGRATION_ABORT=1`. _If you have no real bundle owners in prod yet, this migration is a no-op and can be skipped._
- **Deploy `firestore.indexes.json`** — Wave 5 adds a `bundles` composite index (ownerId+productKind+status) needed by credit redemption. Deploy indexes with rules/functions (`npx firebase deploy --only firestore:indexes`).

---

## C. Pre-existing issues found (not caused by this work; fix later unless noted)

- **SMS add-on never charged** (BillingInvoiceCard subtotal omits SMS; estimator advertises +$9). Being fixed inside Wave 2 server-side pricing since it's a money-correctness bug.
- Duplicate Firestore listeners on `settings/billing_config` (PricingPage + BillingInvoiceCard) — perf nit.
- PricingPage top-level bundle buttons lack loading/disabled state during checkout redirect — polish.

---

## D. Morning run order (do these top-to-bottom)

_Finalized in the last wave. Placeholder until then._
