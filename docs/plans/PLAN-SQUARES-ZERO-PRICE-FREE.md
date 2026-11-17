# PLAN — a squares pool priced at $0 launches free, at any size

> **STATUS: BUILT — one PR, not merged, not deployed.** Deploy is
> **functions only** (no frontend file changes; the wizard renders the server's
> quote). Review log: `PLAN-SQUARES-ZERO-PRICE-FREE-REVIEW-LOG.md`.

Kevin, 2026-11-17: *"Since the Squares pool are free until after thanksgiving,
when I try to create a pool with more than 11 players, it is free, but the
button says, 'Start 14-day trial' which is confusing language for the user."*

**Classification (`mmp-change-control` §1): PLAN-GATED — money.** It changes
which pools launch on a trial (and so can lock for non-payment) and which can
take the $0 activation path. No authorization, scoring or production-data change.

---

## 1. What is wrong — verified on `origin/main` @ `2e3e59ba`

The squares tiers are one band, 11–9999 at $0 (Kevin, 2026-11-17, plan K10
"free for Thanksgiving").

1. **The pool is launched as a trial.** `computeLaunchMode`
   (`functions/src/poolOps.ts`) returns `trial` for any estimate above
   `freePlayerThreshold` (10). It never looks at the price.
2. **The wizard says so.** `computeQuote` (`functions/src/lib/quoteEngine.ts`)
   sets `freeTierEligible` only when `players ≤ freePlayerThreshold`, so the
   launch step's primary button is "Start 14-day trial", and the line above it
   promises a grace period "to pay" (`LaunchStep.tsx`).
3. **And the trial cannot be paid off.** `createCheckoutSession`
   (`functions/src/stripe.ts`) takes a $0 activation only for a credit, the
   free tier or a full-discount coupon, and refuses otherwise with "No valid
   free-activation reason provided". `launchButtonsState.ts` already names
   this case in its header ("a tier the config happens to price at $0").
   So `enforceBillingStatus` moves the pool to grace and then locks it —
   14 + 7 days by the code defaults.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Squares only.** A pool type the free plan's participant cap does not apply to (`FREE_CAP_EXEMPT_POOL_TYPES = ['SQUARES']`, plan K2), priced at $0, launches free at any size. | On every other type `free` brings the 10-participant cap (`shared/freePlanCap.ts`): a $0 band for 11–50 would launch free and then refuse player 11. Squares has no cap, so `free` takes nothing away. |
| D2 | **The price decides, not the total.** Base price $0 and no paid add-on *selected* — read from the selection exactly as `createPool` reads it, whatever the config prices the add-on at (codex X1.1). A coupon that discounts a priced pool to $0 is unchanged: still a trial, still the coupon's own $0 path. | A coupon is a discount on a paid pool, and its reservation is redeemed at activation; launching such a pool free would skip that. |
| D3 | **A pool launched free stays free** after the prices change (plan K10 option B, after Thanksgiving). | It is what the commissioner was told at launch. `free` has no clock; nothing re-prices a pool after creation. |
| D4 | **No migration of pools already created as trials.** They now get a working $0 activation: their quote is `free_tier`, so the pricing page offers it and `createCheckoutSession`'s $0 path accepts it — unless the owner already has an active free pool (the existing one-free-pool rule). Otherwise Super-Admin → Extend Trial, as before. | A production write is its own gate, and the pools are few and days old. |
| D6 | **A hosting checkout is priced as the pool's STORED type**, never the `poolType` the caller sends (`checkoutPricingType`). A pool with no stored type is a legacy squares pool. | qodo #786, finding 1 (High, security). `createCheckoutSession` priced from the caller's `poolType`, so once a $0 squares band is quoted `free_tier`, the owner of an NFL pool could send `"SQUARES"` and take the $0 free path. The same hole let any owner price their pool as the cheapest format, which costs real money once squares has a price. Credit redemption already took the type from the pool. Honest clients are unaffected, except that the pricing page's format tab can no longer re-price a selected pool, which was wrong anyway. |
| D5 | **A paid add-on still forces a trial**, and the price is not consulted. | Unchanged rule (`payloadHasPaidAddon`): the trial is what unlocks a selected add-on. |

## 3. What changes

- `functions/src/lib/quoteEngine.ts`:
  - New `FREE_CAP_EXEMPT_POOL_TYPES` and `zeroPricedLaunchesFree(config, poolType, estimate, addons)`, which is pure and never throws (an unpriceable config is "not zero-priced").
  - `computeQuote` makes `freeTierEligible` true for a cap-exempt type with base price $0 and no paid add-on selected (one shared `selectsPaidAddon`), as long as the total is also $0.
- `functions/src/stripe.ts` (D6): `createCheckoutSession` takes its pricing type from the pool read (`checkoutPricingType`), not from the request.
- `functions/src/poolOps.ts`:
  - `computeLaunchMode` takes an optional `zeroPriced` check, consulted only above the threshold and only when there is no paid add-on.
  - `createPool` passes it for squares only. `createNFLPool` and `createBracketPool` do not pass it, so their rule is unchanged.

## 4. Evidence

- **Unit tests** (`quoteEngine.test.ts`, `poolOpsBilling.test.ts`):
  - $0 squares at 40 players is `free_tier`;
  - priced squares is not;
  - a $0 NFL band is not;
  - a priced add-on keeps it off;
  - a full-discount coupon is not free-tier;
  - an unpriceable config is false;
  - `computeLaunchMode` without the option is unchanged.
- **Emulator** (`squaresCreate.emulator.test.ts` Z):
  - `createPool` at $0 / 40 players stores `billing.status: 'free'` with no `trialEndsAt`;
  - at $9.99 it stores `trial`;
  - a paid add-on at $0 still gives `trial`.

  The first of these fails against `origin/main`'s rule.

## 5. Deploy and rollback

- **`.github/audit-allowlist.json`** (not part of the plan, ported here): a dated `picomatch` entry. `security-audit` went red on `main` on 2026-11-17 for an advisory with no patched release. See the PR.

- **Deploy:** `git pull` in `D:\march-melee-pools`, then `npm --prefix functions ci`, then `npx firebase deploy --only functions`. Nothing in `www` or rules changes.
- **Rollback:** revert the PR and redeploy functions. Pools created free in the meantime stay `free` (D3). To charge for squares again, price the band in Super-Admin; no code change is needed.
