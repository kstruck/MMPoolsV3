# Morning Checklist — Buy-Flow Overhaul

_Overnight run 2026-07-06 → 07-07. Branch `feat/buyflow-overhaul` in worktree D:\mmp-buyflow. Everything below is LOCAL ONLY — nothing deployed to prod, no prod data mutated. Your job in the morning is review → decisions → deploy, in the order given at the bottom._

---

## A. Decisions I need from you (blocked items, non-destructive to leave)

_These did not stop the build; I picked a safe default and flagged it here. Change if you disagree._

1. **Deep-link to `/pricing?poolId=X` for a NON-trial pool** — new visitor-state UX only renders the checkout card when the user has trial pools. Old page let you pay for any pool by ID. If any email/reminder links a non-trial pool to /pricing, that path now shows the estimator instead of a pay button. _Default: kept the new clean UX._ Action: confirm no transactional email deep-links non-trial pools to /pricing (grep the mail templates).

_(more will be appended as later waves run)_

---

## B. Things ONLY you can do (external systems — I have no access)

_Filled in as waves complete. Stripe dashboard, secret rotation, Coolify deploy, migration run all land here._

- **Stripe Dashboard — enable new webhook events** (Wave 2 adds handlers for them): `charge.refunded`, `charge.dispute.created`, `checkout.session.expired`. Without enabling these in the Stripe webhook endpoint config, refund/dispute accounting and reservation-release-on-expiry won't fire. (Exact steps finalized in section D once Wave 2 reports.)
- **Stripe TEST-key rotation still pending** (pre-existing, owner-attested 2026-07-06): while STRIPE_SECRET_KEY is a placeholder, checkout silently activates purchases for free (mock path). Must be a real test key before any UAT of the money path.

---

## C. Pre-existing issues found (not caused by this work; fix later unless noted)

- **SMS add-on never charged** (BillingInvoiceCard subtotal omits SMS; estimator advertises +$9). Being fixed inside Wave 2 server-side pricing since it's a money-correctness bug.
- Duplicate Firestore listeners on `settings/billing_config` (PricingPage + BillingInvoiceCard) — perf nit.
- PricingPage top-level bundle buttons lack loading/disabled state during checkout redirect — polish.

---

## D. Morning run order (do these top-to-bottom)

_Finalized in the last wave. Placeholder until then._
