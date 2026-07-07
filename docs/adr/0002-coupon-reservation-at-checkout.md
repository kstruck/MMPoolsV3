# ADR 0002: Coupon uses are reserved at checkout, confirmed at payment completion

Date: 2026-07-06
Status: Accepted

## Context

Coupon enforcement is split across two moments today:

- `createCheckoutSession` (functions/src/stripe.ts) validates `usesCount < maxUses` but does not increment anything.
- The Stripe webhook (`checkout.session.completed`) increments `usesCount` and appends to `usageLog`.

Consequences of that split:

- **Race:** two concurrent checkouts against a coupon with one use left both pass validation; both webhooks later increment, exceeding `maxUses`.
- **Per-user limit bypass:** `perUserLimit` is enforced in `redeemCoupon` but not in `createCheckoutSession`, so parallel checkouts bypass it.
- **Free pools uncounted:** the 100%-discount path skips Stripe entirely, so no webhook fires and the use is never recorded.
- **Non-atomic recording:** the webhook's `usesCount` increment and `usageLog` append are separate field operations outside a transaction.

## Decision

A coupon use is a two-phase record inside `usageLog`, written transactionally and keyed by a **server-generated `reservationId`** (Stripe's `session.id` does not exist until after the external API call, so it cannot key the reservation):

1. **Reserve (checkout time).** `createCheckoutSession` generates `reservationId`, then runs a Firestore transaction that re-validates every rule (`isActive`, `expiresAt`, `maxUses`, `perUserLimit`, `allowedPoolTypes`) against current state, increments `usesCount`, and appends `{ reservationId, userId, poolId, status: "pending", reservedAt }`. If validation fails inside the transaction, the checkout is rejected — no Stripe session is created.
2. **Create session.** The Stripe session is created with `reservationId` in its metadata. If session creation fails, the reservation is released immediately (best effort) — otherwise the expiry sweep (step 4) reclaims it.
3. **Confirm (webhook).** `checkout.session.completed` reads `reservationId` from session metadata and flips the matching `usageLog` entry to `status: "confirmed"` (stamping `sessionId`) in the same transaction that updates pool billing.
4. **Release (expiry).** `checkout.session.expired` (matched via metadata) releases immediately; a scheduled sweep releases any reservation still `pending` after the Stripe session lifetime (24h): decrements `usesCount`, marks the entry `status: "released"`.
5. **Free pools.** The 100%-discount path (no Stripe session) writes the reservation directly as `status: "confirmed"` in the same transaction that activates the pool.

`maxUses` and `perUserLimit` are therefore enforced against `usesCount` including live reservations: a coupon can never be over-redeemed, at the cost of an abandoned checkout holding a use for up to 24h.

## Alternatives considered

- **Count only in the webhook (accept overshoot):** simpler, but `maxUses` becomes advisory under concurrency and the free-pool path still needs a separate mechanism. Rejected because the product requirement is that max uses are hard limits.
- **Distributed lock / Stripe-side promotion codes:** Stripe promotion codes would outsource counting but cannot express `allowedPoolTypes` or integrate with the free-pool path and Firestore-side auditing.

## Consequences

- An abandoned checkout temporarily consumes a use (released ≤24h). Acceptable; surfaced in the Monetization tab as "pending" uses.
- `usageLog` becomes the single audit trail for coupon usage (pending/confirmed/released), powering the accounting dashboard and abuse alerts. Because it now contains per-user activity, the `coupons` collection moves to admin-only client reads; buyer-side validation goes through a sanitized callable.
- The client-side coupon pre-check (BillingInvoiceCard Firestore query) is removed in favor of the callable; the transaction is authoritative.
