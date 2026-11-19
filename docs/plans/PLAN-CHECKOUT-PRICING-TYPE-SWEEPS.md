# PLAN-CHECKOUT-PRICING-TYPE — sweeps

## CPT1 — every client call that quotes or checks out a pool, and where its `poolType` comes from

`git grep -n "getPoolQuote(\|createCheckoutSession(\|redeemPoolCredit(" -- src ':!src/services' ':!**/__tests__/**'`

| Call site | `poolType` source | Legacy-safe? |
|---|---|---|
| `wizard/create/LaunchStep.tsx` quote and checkout | wizard prop, typed `PoolType` (a pool being created) | yes: always canonical |
| `billing/BillingInvoiceCard.tsx` quote and checkout | `poolType` prop | depends on caller, below |
| ↳ `PricingPage.tsx` | `calcPoolType`, now `checkoutPricingType(pool.type)` for a selected pool | **fixed in this PR** |
| ↳ `admin/WizardStepSummary.tsx` | literal `"SQUARES"` | yes |
| ↳ `PropsWizard/PropsWizard.tsx` | literal `"PROPS"` | yes |
| `BillingInvoiceCard.tsx` bundle buttons (×3) | none, `bundleType` only | n/a |
| `PricingPage.tsx` bundle buttons (×3) | `'BUNDLE'` | n/a |
| `billing/AddonUpgradeButton.tsx` | `checkoutPricingType(pool.type)` | **fixed in this PR** |
| `LaunchStep.tsx` `redeemPoolCredit` | none; the server reads the pool | n/a |

No other client path sends a stored pool type to the quote or checkout.

## CPT2 — server

`createCheckoutSession` prices `checkoutPricingType(poolData.type)` and reads the
request's `poolType` only for schema validation (#786, D6). `redeemPoolCredit`
reads the type from the pool. Unchanged by this PR.
