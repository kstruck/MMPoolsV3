# Plan Review Log: Buy-flow overhaul

Act 1 (grill-with-docs) complete — plan locked in PLAN-BUYFLOW-OVERHAUL.md, CONTEXT.md updated (Bundle, Pool Credit, Unlimited Pass, Coupon, Coupon Template, Billing Charge), ADR-0002 created (coupon reservation at checkout). MAX_ROUNDS=5.

## Round 1 — Codex

1. Reservation transaction assumes Stripe `session.id` exists before the session is created — reserve-then-create is not atomic; orphaned reservations or sessions without reservations. Fix: server-generated `reservationId` first, carried in Stripe metadata; patch in session id or release on failure.
2. `createCheckoutSession` trusts arbitrary client `successUrl`/`cancelUrl` (stripe.ts:66-67,149,227-228,433-434) — open-redirect surface. Fix: derive redirect URLs server-side from allowlisted origin + known routes.
3. Plan puts pending reservations + user/pool activity into `usageLog` while `coupons` is readable by any signed-in user and BillingInvoiceCard queries it directly. Fix: admin-only reads on `coupons`; client validation via sanitized callable.
4. Add-on prices computed client-side only; server checkout ignores add-ons; free-tier pool with paid add-ons bypasses payment. Fix: validated add-on booleans in server quote/checkout contract; paid add-on disqualifies free bypass unless server quote is $0.
5. "Start 14-day Trial" contradicts ADR-0001/current code: unified create stamps `billing.status:"free"` and strips client billing; PropsWizard carries dead trial payload. Fix: amend ADR-0001 semantics explicitly or drop trial-at-launch.
6. `billingCharges` writes are best-effort (failures swallowed) and outside the activation flow — money can succeed while ledger drops the row, yet plan calls it source of truth. Fix: ledger row in same idempotent transaction/batch as pool/bundle mutation (or retryable outbox).
7. `bundles/{id}` adds a second entitlement source without retiring `freePoolsAvailable` / `activeBundleType` / `bundleExpiresAt` / `poolCredits`, all still read by UI/server. Fix: one canonical entitlement model + migration; replace `adminAdjustUserCredits` with audited grant/revoke APIs.
8. Ledger models only `kind: pool|bundle` keyed by `stripeSessionId`; refund/dispute events key off charge/payment-intent. Fix: extend ledger with `paymentIntentId`, `chargeId`, `relatedChargeId`, adjustment subtype before adding handlers.
9. `CREDIT_BUNDLE`/`UNLIMITED_PASS` split conflicts with current magic-number inference (`poolsIncluded >= 9999`) and `durationDays` rendered/created everywhere. Fix: explicit `kind` field + `termDays` for passes; migrate UI/admin/checkout off magic numbers.
10. New client surfaces (`bundles`, `couponTemplates`, `monetization_alerts`) have no firestore.rules access model — default deny breaks the dashboards. Fix: define owner/admin read rules or callables now + positive rules tests.
11. `adminSaveBillingConfig` writes arbitrary config blobs unvalidated; client/server `BillingConfig` types already disagree — one bad save bricks checkout. Fix: shared schema validated server-side on every save.

VERDICT: REVISE

### Claude's response (round 1)

All 11 findings accepted — no rejections. Plan revised:
- (1) ADR-0002 amended: reservation keyed by server-generated `reservationId`, carried in Stripe metadata; failure-path release; `checkout.session.expired` matches on metadata.
- (2) New Phase 3 item: server-derived success/cancel URLs from allowlisted origin.
- (3) Coupons collection goes admin-read-only; new `validateCouponForQuote` callable returns sanitized result for client UX.
- (4) Server quote/checkout contract gains add-on flags; free-tier bypass allowed only when the server-computed total is $0.
- (5) Plan explicitly amends ADR-0001 point 5: launch step selects billing mode server-side (`free` when ≤ threshold and no paid add-ons, `trial` otherwise unless paying/redeeming now); enforceBillingStatus semantics unchanged for `free`. PropsWizard dead trial payload deleted in Phase 2.
- (6) Ledger write moves inside the same transaction as activation/credit-grant; webhook fails loudly if ledger write fails.
- (7) Phase 4 now includes entitlement consolidation: `bundles` + per-credit docs become canonical; one-time migration of legacy fields; `adminAdjustUserCredits` replaced by `adminGrantEntitlement`/`adminRevokeEntitlement` (audited).
- (8) Ledger schema extended (`paymentIntentId`, `chargeId`, `relatedChargeId`, `kind: pool|bundle|refund|dispute`).
- (9) Explicit `kind` on bundle products, `termDays` only for passes, migration off `>=9999` magic number and hardcoded ids.
- (10) Firestore rules matrix for `bundles`, `couponTemplates`, `monetization_alerts` specified in plan + positive rules tests added to test plan.
- (11) `BillingConfig` moves to shared zod schema (shared/ folder per ADR-0001 mechanism); `adminSaveBillingConfig` validates before persisting.

## Round 2 — Codex

Prior 11: all addressed (10 fully, #10 "mostly" — couponTemplates contradiction below). New findings:

1. No single authoritative discounted quote: `getPoolQuote` prices format/players/add-ons but `validateCouponForQuote` returns only valid/invalid + description — coupon-adjusted totals drift back into client math. Fix: `getPoolQuote` accepts optional couponCode, returns validated coupon state + discounted line items/total.
2. "Activate now" pre-payment state underspecified: UAT says declined card leaves pool in `trial`, but plan only stamps `trial` for the Start-Trial option. Fix: define exactly when the pool doc is created and its billing state on checkout init/cancel/decline — one state machine for wizard, webhook, scheduler.
3. Entitlement schema internally inconsistent: products typed `CREDIT_BUNDLE|UNLIMITED_PASS` but migrated legacy entitlements become kind `GRANT`. Fix: split productKind from source/grantType.
4. `couponTemplates` access described two contradictory ways ("read/write via callable only" and "client read for the tab"). Fix: pick one model, align rules/UI/tests.

VERDICT: REVISE

### Claude's response (round 2)

All 4 accepted — no rejections. Plan revised (Rev 3):
- (1) `validateCouponForQuote` eliminated; `getPoolQuote` is the single quote authority (format, players, add-ons, optional couponCode → sanitized coupon state + itemized discounted total). Phase 3 item 10 updated to match.
- (2) Launch state machine specified: launch ALWAYS creates the pool doc first (`free` when ≤ threshold and $0 quote, else `trial`); payment is always an operation on an existing trial pool; "Activate now" = launch-as-trial + immediate checkout; webhook/redemption flips trial→active; cancel/decline/abandon leaves plain trial — no orphan states.
- (3) Split into `productKind: CREDIT_BUNDLE|UNLIMITED_PASS` + `source: PURCHASE|ADMIN_GRANT|REFERRAL|MIGRATION`; migration mints CREDIT_BUNDLE docs with appropriate source.
- (4) couponTemplates: SUPER_ADMIN direct client read; all writes via callable/functions only.

## Round 3 — Codex

Round-2 findings all addressed. New:

1. Undercharge path: payment on an existing trial pool, but nothing freezes/revalidates billable settings between quote, checkout, activation, and later edits — user pays for one player/add-on profile then expands the pool. `billing.maxPlayersAllowed` is stamped at payment (stripe.ts:617) but never enforced in access checks (billing.ts:160-184) or updatePoolSettings. Fix: billable snapshot at checkout; activation + updatePoolSettings + join path enforce paid ceilings unless re-quoted and re-paid.
2. Firestore transaction limits: bundle grant + per-credit docs + ledger in one transaction with uncapped creditsTotal (or big migrated grants) can exceed batch/transaction write limits. Fix: cap credit-bundle size or chunk async.
3. Migration window: no dual-write or freeze defined — live purchase/referral/grant traffic during backfill diverges old/new entitlements. Fix: explicit cutover sequence (freeze or dual-write → backfill → verify → flip readers → delete legacy).

VERDICT: REVISE

### Claude's response (round 3)

All 3 accepted — no rejections. Plan revised (Rev 4):
- (1) New Phase 2 item 6b: `billing.paid` snapshot (maxPlayersAllowed, addons, tier) stamped at checkout/activation; `updatePoolSettings` rejects exceeding it without delta re-quote/payment; join path enforces paid player cap; unit + UAT cases added (8b).
- (2) `creditsTotal ≤ 100` enforced by BillingConfig schema (500-write transaction limit with margin); migration backfill chunked.
- (3) Explicit cutover sequence added to Phase 4: entitlement-write freeze (flag) → chunked backfill → census verify → flip readers → unfreeze → delete legacy after one clean billing cycle. Change-control (dry-run/kill-switch/census) noted in Risks.

## Round 4 — Codex

Round-3 findings all addressed. New:

1. `billing.paid` persisted at checkout contradicts "cancel/decline leaves plain trial" — unpaid tentative snapshot on the live pool doc confuses edit/join enforcement and `billing.featuresUnlocked` readers (billing.ts:176-179). Fix: pending snapshot lives on the reservation/session record; copied to pool billing only on successful payment/redemption.
2. `creditsTotal ≤ 100` capped only in BillingConfig products; `adminGrantEntitlement` is a separate creation surface that can still blow transaction write limits. Fix: enforce cap (or chunked path) at every entitlement-creation entrypoint.
3. Migration freeze ignores already-open Stripe checkout sessions — their webhooks can land mid-backfill and invalidate the census. Fix: stop new entitlement checkouts first, expire/drain outstanding sessions before backfill.

VERDICT: REVISE

### Claude's response (round 4)

All 3 accepted — no rejections. Plan revised (Rev 5):
- (1) 6b reworded: pending billable snapshot stored on reservation/session record; webhook/redemption transaction copies to `billing.paid` + `billing.featuresUnlocked` on success; cancel/decline leaves pool billing untouched.
- (2) Cap enforced at every entitlement-creation entrypoint (config schema, webhook grant, adminGrantEntitlement).
- (3) Cutover step (1) now: flag off new entitlement checkouts → expire in-flight sessions via Stripe API (or wait out 24h lifetime) → then freeze grants/redemptions → backfill.

## Round 5 — Codex (final round; MAX_ROUNDS=5 reached)

Round-4 findings all addressed. Remaining material:

1. `checkBillingAccess` denies a premium feature only when `billing.featuresUnlocked[key]` exists and is explicitly false (billing.ts:175-180); plan copies flags only on successful activation, so free/trial pools with missing flags are treated as allowed. Fix: deny-when-missing and/or stamp explicit false flags at free/trial launch.
2. No pool-level checkout idempotency: two concurrent "Activate now" sessions on one trial pool can both complete before the first webhook flips it active → double charge, doubled pricePaid/ledger. Fix: at most one live session per payable pool; webhook no-ops/auto-flags later sessions on an already-active pool.

VERDICT: REVISE

### Claude's response (round 5)

Both accepted — no rejections. Plan revised (Rev 6):
- (1) New item 6c: `checkBillingAccess` becomes deny-when-missing for paid features; free/trial launches stamp explicit `featuresUnlocked:false` flags. Unit test added.
- (2) New item 6d: transactional `billing.pendingSessionId` (one live checkout per payable pool; cleared on completion/expiry); completion webhook no-ops sessions for already-active pools and writes a refund-review alert. Unit + UAT (item 4) coverage added.

## Resolution

Cap reached at 5 rounds without a formal APPROVED line. Substantive state: findings per round 11 → 4 → 3 → 3 → 2, every finding in all five rounds was accepted and folded into the plan (zero rejected, zero disputed — no Claude counter-positions outstanding). Round-5's two findings are incorporated in Rev 6; no unresolved disagreement exists, but Rev 6 has not itself been re-reviewed by Codex. Deliverables: PLAN-BUYFLOW-OVERHAUL.md (Rev 6), CONTEXT.md glossary additions, ADR-0002, this log.
