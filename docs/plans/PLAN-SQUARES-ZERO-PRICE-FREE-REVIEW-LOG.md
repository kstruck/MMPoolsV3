# PLAN-SQUARES-ZERO-PRICE-FREE — review log

Sweeps: `PLAN-SQUARES-ZERO-PRICE-FREE-SWEEPS.md`.

## Review rounds

### Round X1 — codex (`gpt-5.6-terra`), on `7623bff7`

| # | Finding | Verdict |
|---|---|---|
| X1.1 [P2] | An add-on selected but priced $0 by config adds no quote line, so the quote said free; `createPool` still launched a trial (`payloadHasPaidAddon` reads the selection). The wizard and the stored pool disagreed. | **Valid — fixed** in the direction of the existing rule (D5): the zero-priced test now reads the add-on *selection*, exactly as `createPool` does (`selectsPaidAddon`), so the quote says trial too. The other direction (launch free) was rejected: the free path never switches a selected add-on on (`billingForLaunch`), so the commissioner would get a "free" pool without the feature they ticked. Tests: a selected $0 add-on is not free-tier; an included add-on (`customBranding`) still is. |

**Not changed, recorded:** the same selection/price mismatch already exists on `main` for pools AT or below the threshold. `freeTierEligible` uses `total === 0` there, which a selected-but-$0 add-on satisfies, and `createPool` launches a trial. It predates this plan, it is every pool type, and it is reachable only if Super-Admin prices a premium add-on at $0. It is out of scope.

### Round X2 — codex, on `dd734008`

Clean.

### Round Q1 — qodo, on `dd734008` (1 bug, 2 skill insights)

| # | Finding | Verdict |
|---|---|---|
| Q1.1 (High, security) | `createCheckoutSession` prices the CALLER's `poolType`, so a non-squares owner can send `"SQUARES"` in a $0 band and be activated free. | **Valid — fixed (D6).** Verified in code: the destructured `poolType` fed `computeQuote`, the coupon scope, the session record and the Stripe line, while only the purchasability check read the stored type. Checkout now prices `checkoutPricingType(poolData.type)`. Tests: unit tests plus a source pin (`checkoutPricingType.test.ts`), and the emulator test `checkoutPricingType.emulator.test.ts`. That test sends an NFL pool as `"SQUARES"`; it is charged as NFL ($29, one session record, not `free_tier`). It **fails against the old code**, which took the free path with no session record. Sweep ZS3 found no other callable that prices or activates a pool from a caller-sent type. |
| Q1.2 | CONTEXT.md's billing vocabulary does not say when a pool is free versus on trial. | **Valid — fixed**: the Billing entry now states the rule, the squares exception and D6. |
| Q1.3 | The sweeps were inside the review log, not in a `-SWEEPS.md` file. | **Valid — fixed**: moved to `PLAN-SQUARES-ZERO-PRICE-FREE-SWEEPS.md`, which adds ZS3. |
