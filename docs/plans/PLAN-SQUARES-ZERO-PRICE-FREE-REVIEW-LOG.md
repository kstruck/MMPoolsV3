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

### Round X1 — codex (`gpt-5.6-terra`), on `7623bff7`

| # | Finding | Verdict |
|---|---|---|
| X1.1 [P2] | An add-on selected but priced $0 by config adds no quote line, so the quote said free; `createPool` still launched a trial (`payloadHasPaidAddon` reads the selection). The wizard and the stored pool disagreed. | **Valid — fixed** in the direction of the existing rule (D5): the zero-priced test now reads the add-on *selection*, exactly as `createPool` does (`selectsPaidAddon`), so the quote says trial too. The other direction (launch free) was rejected: the free path never switches a selected add-on on (`billingForLaunch`), so the commissioner would get a "free" pool without the feature they ticked. Tests: a selected $0 add-on is not free-tier; an included add-on (`customBranding`) still is. |

**Not changed, recorded:** the same selection/price mismatch already exists on `main` for pools AT or below the threshold. `freeTierEligible` uses `total === 0` there, which a selected-but-$0 add-on satisfies, and `createPool` launches a trial. It predates this plan, it is every pool type, and it is reachable only if Super-Admin prices a premium add-on at $0. It is out of scope.
