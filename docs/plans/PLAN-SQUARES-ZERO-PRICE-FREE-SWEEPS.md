# PLAN-SQUARES-ZERO-PRICE-FREE — sweeps

These are deterministic greps, run 2026-11-17 on `claude/squares-zero-price-launches-free`. Each command is the source of truth: re-run it before relying on its table.

**ZS1 — every reader of `freeTierEligible`**

```
git grep -n "freeTierEligible" -- src functions/src shared ':!*.test.*' ':!**/__tests__/**' ':!functions/src/shared/**'
```

| Site | Classification |
|---|---|
| `launchButtonsState.ts` → `LaunchStep.tsx` primary button | **changed by the quote**: a $0 squares pool shows "Launch free pool" and "qualifies for the free plan"; creation is free (`createPool`). This is the reported bug. |
| `LaunchStep.tsx` `freeCapNotice` | consistent: returns null for SQUARES before it reads the flag. |
| `checkoutButtonState.ts`, `BillingInvoiceCard.tsx` (pricing page) | **changed by the quote**: for a squares pool created earlier as a $0 trial, the badge reads "Free Pool Exempt" and activation is offered. The one-free-pool limit still applies. This is plan D4. |
| `functions/src/stripe.ts` `createCheckoutSession` | consistent: `snapshot.tier === 'free_tier'` is now a valid $0 reason for those pools; the one-free-pool query is unchanged. |

**ZS2 — every caller of `computeLaunchMode`**

```
git grep -n "computeLaunchMode(" -- functions/src ':!**/__tests__/**'
```

| Site | Classification |
|---|---|
| `poolOps.ts` `createPool` | **changed**: passes `zeroPriced` for squares only. |
| `nflPools.ts` `createNFLPool` | unchanged: passes no option, so the rule is identical. |
| `bracketPools.ts` `createBracketPool` | unchanged: passes no option. |

**ZS3 — every callable that prices or activates a pool from a caller-sent pool type** (added after qodo #786 finding 1)

```
git grep -nE "input\.poolType|\{[^}]*\bpoolType\b[^}]*\} = (input|request\.data|data)" -- functions/src ':!**/__tests__/**'
git grep -n "computeQuote(" -- functions/src ':!**/__tests__/**'
```

| Site | Classification |
|---|---|
| `stripe.ts` `createCheckoutSession` | **changed — finding**: it priced from the caller's `poolType`. It now uses `checkoutPricingType(poolData.type)`, taken from the pool read, for the quote, the coupon scope, the session record and the Stripe line. |
| `entitlements.ts` `redeemPoolCredit` | consistent: it reads the pool in its own transaction and takes the type from it. |
| `entitlements.ts` `adminGrantEntitlement` | out of scope: SUPER_ADMIN only, and `poolType` there is the grant's constraint, not a price. |
| `billing.ts` `getPoolQuote` | consistent: display only, before a pool exists. It activates nothing, and checkout re-prices server-side. |
