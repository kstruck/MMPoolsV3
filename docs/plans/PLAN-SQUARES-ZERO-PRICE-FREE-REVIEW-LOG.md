# PLAN-SQUARES-ZERO-PRICE-FREE — review log and sweeps

## Sweeps (run 2026-11-17 on the branch)

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

## Review rounds

(Filled in as codex and qodo report.)
