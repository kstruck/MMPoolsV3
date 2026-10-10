# NOTES-WAVE2 — buy-flow overhaul (Wave: money-core) hand-off

This wave implemented Phases 2/3/5 (+ launch-billing-mode of Phase 2) server-side
plus the BillingInvoiceCard checkout client. Everything below is work that lands
OUTSIDE this wave's owned files, or is a human/ops action, or something I could
not verify here.

--------------------------------------------------------------------------------
## (a) Cross-file integration points left for other waves
--------------------------------------------------------------------------------

### A1. Launch billing mode wiring in the create callables (Phase 2 / amends ADR-0001 pt 5)
`poolCreation.ts` now exports `billingForLaunch(mode:'free'|'trial', trialDays, nowMs)`
and `LOCKED_FEATURES`. `freeBilling()` still exists and now delegates to
`billingForLaunch('free')` (so nothing breaks), and it now ALSO stamps explicit
`featuresUnlocked` all-false (needed by the deny-by-default gate — see (b) note on
checkBillingAccess).

The three create callables still call `freeBilling()` and therefore ALWAYS launch
`free`. To honor the "free when players ≤ freePlayerThreshold AND no paid add-ons,
else trial" rule, the owning wave should compute the mode server-side and call
`billingForLaunch(mode, trialDays)` instead. Exact sites (NOT owned here):

- `functions/src/poolOps.ts:110`      → `billing: freeBilling(),`   (createPool)
- `functions/src/nflPools.ts:83`      → `billing: freeBilling(),`   (createNFLPool)
- `functions/src/bracketPools.ts:103` → `(newPool as any).billing = freeBilling();` (createBracketPool)

Suggested change at each site:
```ts
import { billingForLaunch } from './lib/poolCreation';           // already imports freeBilling
// trialDays: read settings/billing_config (billing.ts exports loadBillingConfig)
// estimatedPlayers/addons come from the create payload.
const mode = (estimatedPlayers <= freePlayerThreshold && noPaidAddons) ? 'free' : 'trial';
billing: billingForLaunch(mode, trialDays),
```
`billingForLaunch` is unit-safe (nowMs injectable). Until this lands, launches stay
`free` — behavior-equivalent to today, so this is non-blocking.

### A2. Paid-ceiling enforcement (anti-undercharge, Phase 2 #6b(iii))
`billing.paid.maxPlayersAllowed` IS now stamped at activation (webhook +
free-path, in stripe.ts — owned here). Nothing yet ENFORCES it on edit/join.
Two enforcement points to add (NOT owned here):

1. `updatePoolSettings` — `functions/src/poolOps.ts:179` (`export const updatePoolSettings`).
   Before persisting a settings change that raises the player cap or enables a paid
   add-on, reject if it exceeds `billing.paid` unless the pool is re-quoted and the
   delta paid. Needed check (pseudocode):
   ```ts
   const paid = pool.billing?.paid;
   if (paid && requestedMaxPlayers > paid.maxPlayersAllowed) {
     throw new HttpsError('failed-precondition',
       'Raising the player cap beyond the paid ceiling requires an upgrade payment.');
   }
   ```

2. Join / enter callables — enforce entries cannot exceed `billing.paid.maxPlayersAllowed`
   for a PAID pool (today only the 10-player FREE-plan lock exists). Exact sites:
   - `functions/src/bracketEntries.ts:43`  (createBracketEntry free-plan lock — add a paid-ceiling branch)
   - `functions/src/nflPools.ts:167`       (joinNFLPool free-plan lock)
   - `functions/src/playoffPools.ts:200-203` (managePlayoffEntry free-plan lock)
   - squares: check the reserve/claim path in `functions/src/squares.ts` (no existing
     free-plan lock string found; confirm whether squares needs a ceiling check).
   Needed check next to each existing free-plan lock:
   ```ts
   const paid = pool.billing?.paid;
   if (paid && currentParticipantCount >= paid.maxPlayersAllowed) {
     throw new HttpsError('failed-precondition',
       'This pool has reached its paid participant ceiling. Upgrade to add more.');
   }
   ```

### A3. Firestore rules for NEW collections (Wave 5 owns firestore.rules)
This wave writes to these NEW collections via the Admin SDK (rules NOT touched here):
- `checkoutSessions/{reservationId}` — pending billable snapshot + coupon linkage.
  Rules: functions-only writes; SUPER_ADMIN read (or no client read at all).
- `monetization_alerts/{id}` — DOUBLE_CHARGE_REVIEW / REFUND / DISPUTE docs.
  Rules: SUPER_ADMIN read, writes functions-only (per PLAN Phase 6 #24).
- `coupons` — now contains per-user usageLog with reservation state; per ADR-0002 it
  must become SUPER_ADMIN client-read-only (buyer validation goes through getPoolQuote).
  The client `coupons` query was removed here; the rules tightening is Wave 3/5's.
- `billingCharges` — unchanged (read SUPER_ADMIN, write:false) but now also holds
  refund/dispute rows (kind widened) and pending-snapshot-derived fields.

### A4. `PoolBilling` type additions (types.ts is shared/generated-ish; not owned here)
The webhook/checkout now write two NEW fields under `billing` that are not yet in the
`PoolBilling` interface (`functions/src/types.ts` ~line 678). They are written via the
Admin SDK with dotted paths / `as any`, so this is not a compile blocker, but the
interface should gain them for legibility:
- `pendingSessionId?: { reservationId: string; at: number }`
- `paid?: { tier: string; maxPlayersAllowed: number; addons: string[]; at: number }`

--------------------------------------------------------------------------------
## (b) Human / Stripe-dashboard / secret / env actions (REQUIRED before go-live)
--------------------------------------------------------------------------------

1. **Enable new Stripe webhook events** in the Stripe Dashboard (Developers → Webhooks
   → the endpoint that hits `handleStripeWebhook`). Newly handled event types that MUST
   be turned on (they are ignored today):
   - `checkout.session.expired`   (releases stale coupon reservations)
   - `charge.refunded`            (negative adjustment ledger row + alert)
   - `charge.dispute.created`     (negative adjustment ledger row + alert)
   `checkout.session.completed` is already enabled.

2. **Origin allowlist env (optional)** `BUYFLOW_ALLOWED_ORIGINS` — comma-separated extra
   origins appended to the built-in allowlist (prod `https://www.marchmeleepools.com`,
   marchmeleepools.com, marchmelee.com/www, localhost:5173/3000/5199). Set this as a
   Functions env var if the app is served from any other origin; otherwise redirect URLs
   fall back to the production origin. NO secret required.
   NOTE: the pre-overhaul fallback origin was `https://marchmelee.com`; it is now the
   canonical `https://www.marchmeleepools.com` (BASE_URL). Confirm that is the intended
   Stripe redirect host.

3. **Enable the scheduled sweep** `releaseStaleCouponReservations` (runs every 30 min,
   exported from index.ts). Like `autoClosePools`, it is OFF + dry-run by default. To
   activate after reviewing a few dry-run logs, set on `system/config`:
   ```json
   { "couponSweep": { "enabled": true, "dryRun": false } }
   ```
   Leaving it disabled is safe (reservations still release on `checkout.session.expired`);
   the sweep is the belt-and-suspenders reclaimer for sessions that never emit expiry.

4. **Deploy prerequisite**: run `npm --prefix functions install` before deploy (per repo
   convention) so stripe/zod type deps resolve, then `npx firebase deploy` (no global CLI).
   New scheduled function `releaseStaleCouponReservations` will be created on deploy —
   confirm Cloud Scheduler is enabled for the project.

--------------------------------------------------------------------------------
## (c) Things I could NOT verify here
--------------------------------------------------------------------------------

- **Live Stripe event field shapes.** The refund handler reads
  `charge.amount_refunded` (charge.refunded) and the dispute handler reads
  `dispute.charge` / `dispute.amount` (charge.dispute.created). These match the Stripe
  API docs but were not exercised against real events (no emulator/stripe-CLI run here).
  Covered by SCAFFOLD (describe.skip) in
  `functions/src/__tests__/emulator/buyflowWebhook.emulator.test.ts`; run
  `npm --prefix functions run test:emulator` with stripe-CLI fixtures to validate.
- **Transaction contention / retries** under real Firestore (the mocked unit tests can't
  reproduce a retry). The reservation math is proven pure-side; the transactional glue is
  scaffolded for emulator tests.
- **firestore.rules** for the new collections — not in this wave's ownership; the Admin
  SDK writes bypass rules, but client reads of `monetization_alerts`/`checkoutSessions`
  will fail until Wave 5 adds rules.
- **PricingPage.tsx / SuperAdminBillingPanel.tsx** were NOT touched (not owned). Note:
  `SuperAdminBillingPanel.tsx` has 7 PRE-EXISTING tsc errors (schema drift, unrelated to
  this wave) — left as-is per scope. The 3 pre-existing BillingInvoiceCard drift errors
  were fixed here.
- **Wizard payment step** (Phase 2 #5 "Start Trial / Activate now / Redeem" UI) — the
  server callables (getPoolQuote, hardened createCheckoutSession) and the
  BillingInvoiceCard checkout client are done; the wizard shell wiring is another wave.
