# PLAN — the client quotes and sends the type checkout prices a pool as

> **STATUS: BUILT — one PR (#794), not merged, not deployed.** Deploy is
> **frontend only** (Coolify `www`). Review log: `PLAN-CHECKOUT-PRICING-TYPE-REVIEW-LOG.md`.
> Sweeps: `PLAN-CHECKOUT-PRICING-TYPE-SWEEPS.md`.

Kevin, 2026-11-19, on #786's side effect ("the pricing page's format tab can
no longer re-price a selected pool"): *"Lets fix that."*

**Classification (`mmp-change-control` §1): PLAN-GATED — money** (taken on
doubt, qodo #794). This changes what the pricing page QUOTES and the `poolType`
the add-on button SENDS. It does not change what is CHARGED: the server is
authoritative and is not touched. No authorization, scoring or production-data
change.

---

## 1. What is wrong — verified on `origin/main` @ `1e900fcb`

Since #786 (PLAN-SQUARES-ZERO-PRICE-FREE D6), `createCheckoutSession` prices a
pool by its STORED type through `checkoutPricingType` (`functions/src/stripe.ts`).
That function upper-cases the type, prices legacy `'playoff'` / `NFL_PLAYOFF` as
`NFL_PLAYOFFS`, and prices a pool with no type as `SQUARES`. The client used the
raw stored type:

1. **Legacy playoff pool.** The pricing page quoted it as `PLAYOFF`. The quote
   schema (`POOL_TYPES`) rejects that, so no price showed and the pay button
   never armed, although the server would have charged it as `NFL_PLAYOFFS`.
2. **Pool with no stored type.** `poolType.toUpperCase()` on `undefined`
   crashed the pricing page.
3. **Add-on button.** It sent `pool.type` raw. `checkoutPoolInputSchema`
   (`poolType: z.enum(POOL_TYPES)`) rejects the same legacy values before the
   server reads the pool.

The side effect named in #786 (switching the format tab re-prices a selected
pool) has no UI path. When a payable pool is selected, the estimator with the
tabs is hidden (`!selectedIsPayable`) and the type is synced from the pool.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| C1 | **The client uses the server's rule exactly**, through a client copy `src/utils/checkoutPricingType.ts`. | The page must quote what Stripe charges. |
| C2 | **A copy, not a shared module.** Parity is pinned by a test that imports the server function. | A shared module means changing and redeploying functions for a frontend-only fix. The parity test runs in the required `build-and-test` job on every PR, so drift cannot merge. qodo #794's own high-level assessment recommended this. |
| C3 | **No server change.** | The server was already right (D6). What a pool is charged is unchanged. |
| C4 | **Legacy pools become payable from the UI.** | They were always payable by the server's rule; the client blocked them by mistake. They are charged as their real format, `NFL_PLAYOFFS` or `SQUARES`. |

## 3. What changes

- `src/utils/checkoutPricingType.ts`: new; it is the client copy.
- `src/components/PricingPage.tsx`: the pool sync sets the calculator type with it.
- `src/components/billing/AddonUpgradeButton.tsx`: the add-on checkout sends it.

## 4. Evidence

`tests/checkout-pricing-type-parity.test.ts`:
- The client equals the server function over 23 stored values: legacy, current, lower-case, blank and non-string.
- Every current and legacy type maps into `POOL_TYPES`.
- Wiring pins on both callers.
- Mutation-checked: dropping the client's `PLAYOFF` alias fails 5 tests.

## 5. Deploy and rollback

- **Deploy:** Coolify `www` Redeploy. Nothing in functions or rules changes.
- **Rollback:** redeploy the previous Coolify deployment, or revert the PR. Nothing is stored, so nothing needs repair.
