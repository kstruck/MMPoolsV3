# Plan: Buy-flow overhaul — pricing UX, bundles, coupons, monetization accounting

_Locked via grill-with-docs — by Claude + Kevin Struck, 2026-07-06. Terms per CONTEXT.md (Bundle, Pool Credit, Unlimited Pass, Coupon, Coupon Template, Billing Charge). See ADR-0002 (coupon reservation). Rev 6 after Codex rounds 1-5._

## Goal

Make the Commissioner buy flow bulletproof for every visitor type — anonymous, account-with-no-pools, account-with-trial-pools — by moving single-pool payment into the pool wizard's launch step and turning /pricing into an estimator + Bundle store + trial-activation surface. Harden the coupon engine (hard max-uses, per-user limits, expiry) via reservation-at-checkout, make Bundles fully transparent to their owners and revocable by Super Admin, handle refunds/disputes, and build a ledger-driven accounting view in the Monetization tab with coupon-abuse alerts and Coupon Templates.

## Approach

### Phase 1 — Pricing page fixes (small, shippable first)

1. **Tooltip fix** ([PricingPage.tsx:279](src/components/PricingPage.tsx:279)): the estimator card's `group` class makes every `UpgradeTooltip` (`group-hover:opacity-100`, lines 17-28) fire on any card hover. Replace `UpgradeTooltip` with a click-toggled popover on the `?` icon (open on click, close on outside-click/Escape, `aria-expanded`); remove reliance on ancestor `group`. Remove `group` from the card div.
2. **Zero-pool / anonymous state**: replace the dead "select a pool above to pay" quote-mode card. State machine:
   - Anonymous → hero CTA "Build your pool — free to start" → wizard (no login wall).
   - Logged in, no trial pools → estimator + primary CTA "Create your pool" (no pay button at all).
   - Logged in, trial pools → current "activate a trial pool" list + checkout card.
3. **Billing config schema + completeness**: move `BillingConfig` to a shared zod schema (`shared/`, packaged into functions per ADR-0001's copy mechanism); `adminSaveBillingConfig` validates against it before persisting (today it writes arbitrary blobs and client/server types already disagree — `src/types/index.ts:968-988` vs `functions/src/types.ts:701-715`). Schema includes: explicit format→tier mapping (`NFL_PICKEM|NFL_SURVIVOR|NFL_MARGIN → pricing.season`, etc., no implicit fallback), `trialDays` (replacing hardcoded 14), and the hero promo (backed by a real Coupon doc so counters are real; delete hardcoded `EARLYBIRD30`). Includes the read-audit finishing the `config/billing_config` → `settings/billing_config` consolidation.
4. **Coupon input normalization**: uppercase/trim server-side and client-side before lookup.

### Phase 2 — Payment in the wizard

5. Add a **launch/payment step** to the unified pool wizard (wizard stays pure UI per ADR-0001; the step calls server callables). It shows the **server-computed quote** via a single authoritative `getPoolQuote` callable: format, player estimate, add-on flags, **optional couponCode** → validated coupon state + itemized line items + discounted total, all from billing config. There is no separate coupon-validation callable and no client price math anywhere in the flow.

   **Launch state machine (single source of truth for wizard, webhook, scheduler):** launching a Pool Draft ALWAYS creates the pool doc first, in exactly one of two server-validated billing modes:
   - `free` — auto-selected when player estimate ≤ `freePlayerThreshold` AND the server quote total is $0 (any paid add-on disqualifies free).
   - `trial` — every other launch; server stamps `billing.status:"trial"`, `trialEndsAt = now + trialDays`.
   Payment is always an operation ON an existing trial pool, never part of pool creation:
   - (a) **Start Trial** — stop after launch.
   - (b) **Activate now** — launch as `trial`, then immediately open Stripe checkout (or 100%-coupon / Pool Credit / Unlimited Pass redemption) for that pool; the webhook/redemption transaction flips `trial → active`. Cancel/decline/abandon simply leaves the pool in `trial` with its full trial window — no cleanup path, no orphan states.
   - (c) **Redeem entitlement** — shown only if the user owns a matching Pool Credit / active Unlimited Pass.
   This **amends ADR-0001 point 5**: unified `createPool`/`publishPool` accept a server-validated launch billing mode (`free` | `trial`) instead of always stamping `free`; `enforceBillingStatus` semantics for `free` pools unchanged. PropsWizard's dead client-side trial payload (PropsWizard.tsx:152-168) is deleted.
6. **Checkout contract hardening**: `createCheckoutSession` gains validated add-on booleans (server prices them; today add-ons are client-priced only and ignored server-side — stripe.ts:86-133 vs BillingInvoiceCard.tsx:223-229). `successUrl`/`cancelUrl` are no longer client-supplied: server derives them from an allowlisted app origin + known route templates (open-redirect fix for stripe.ts:66-67).
6b. **Paid-ceiling enforcement (anti-undercharge)**: checkout stores a **pending billable snapshot** (`{ maxPlayersAllowed, addons[], tier }`) on the reservation/session record — NOT on the live pool doc (an unpaid tentative snapshot on the pool would confuse edit/join enforcement and readers like `billing.featuresUnlocked`, billing.ts:176-179). On successful payment/redemption the webhook/redemption transaction copies it to `billing.paid` + `billing.featuresUnlocked`; cancel/decline leaves the pool's billing untouched. Enforcement in three places: (i) activation stamps the snapshot; (ii) `updatePoolSettings` (ADR-0001) rejects raising player cap or enabling a paid add-on beyond `billing.paid` unless the pool is re-quoted and the delta paid (existing additive `pricePaid` supports upgrade charges); (iii) the join path blocks entries beyond `billing.paid.maxPlayersAllowed` (today the field is stamped at payment — stripe.ts:617 — but nothing enforces it in billing.ts:160-184 or the update path). Free-tier and trial pools get the same treatment with their tier ceilings.
6c. **Deny-by-default paid features**: `checkBillingAccess` today denies a premium feature only when its `billing.featuresUnlocked` key exists and is explicitly `false` (billing.ts:175-180) — a missing flag is treated as allowed. Change to deny-when-missing for all paid features, AND stamp explicit `featuresUnlocked: { …: false }` on every free/trial launch (belt and suspenders; the stamp also makes state inspectable).
6d. **Pool-level checkout idempotency**: at most one live checkout session per payable pool — `createCheckoutSession` transactionally sets `billing.pendingSessionId` (rejects if one is live and unexpired; cleared by webhook completion/expiry). The completion webhook additionally no-ops (and flags for admin refund via the alert center) any session arriving for a pool already `active`, so a race can never double-charge or double-count `pricePaid`/ledger.
7. Anonymous users reach the launch step with a device-local Pool Draft; the step requires inline sign-in/sign-up before launch (draft survives the auth round-trip).
8. /pricing keeps: estimator (quote-only, labeled), Bundle store, trial-pools-awaiting-activation list. Checkout from /pricing remains for trial activation only.

### Phase 3 — Coupon engine hardening (ADR-0002)

9. Implement reserve→confirm→release keyed by server-generated `reservationId` (NOT Stripe session id, which doesn't exist until after the API call): transaction reserves (increments `usesCount`, appends pending `usageLog` entry) → Stripe session created with `reservationId` in metadata → webhook confirms via metadata → `checkout.session.expired` handler + scheduled sweep release stale reservations (≤24h hold). Session-creation failure releases immediately. Enforce `perUserLimit` at reservation. Free-pool (100% off) path writes a confirmed use atomically with activation.
10. **Coupon privacy**: `usageLog` now contains user/pool activity → firestore.rules changes `coupons` to admin-only client reads; buyer-side validation happens only inside `getPoolQuote` (returns sanitized coupon state + discounted total — see Phase 2). BillingInvoiceCard's direct Firestore query is removed.
11. Webhook wraps coupon confirm + pool-billing update + ledger write in one transaction.
12. Unit tests for every rule (see Test plan).

### Phase 4 — Entitlements: one canonical model + transparency

13. **Unify products**: fold hardcoded `buy_3` / `unlimited_1yr` into `packagesList` with an explicit `kind: "CREDIT_BUNDLE" | "UNLIMITED_PASS"` field (killing the `poolsIncluded >= 9999` magic-number inference and hardcoded ids). Credit bundles have no term; passes get `termDays` (replacing `durationDays`). Pool Credits never expire (glossary); Unlimited Pass keeps its term.
14. **One canonical entitlement model** (replaces today's four parallel fields: `users.freePoolsAvailable`, `activeBundleType`, `bundleExpiresAt`, `poolCredits[]`): `bundles/{bundleId}` with TWO orthogonal type fields — `productKind: "CREDIT_BUNDLE" | "UNLIMITED_PASS"` (what it is) and `source: "PURCHASE" | "ADMIN_GRANT" | "REFERRAL" | "MIGRATION"` (where it came from) — plus owner, product snapshot, creditsTotal, creditsUsed, termEndsAt (passes only), status: active|revoked|exhausted|expired, stripeSessionId/paymentIntentId (source PURCHASE only). Per-credit docs in `bundles/{id}/credits/{creditId}` (constraints, status: available|used|revoked, usedByPoolId). **Bundle size cap**: `creditsTotal ≤ 100` enforced at EVERY entitlement-creation entrypoint — BillingConfig schema (products), webhook grant path, AND `adminGrantEntitlement` (keeps grant + credit-doc creation + ledger write inside Firestore's 500-write transaction limit with wide margin); anything larger is a product smell, not a need.

    **Migration cutover sequence** (prod-data mutation — change-control rules apply: dry-run, kill switch, census before/after): (1) stop creating new entitlement-related checkout sessions (flag), then **drain in-flight sessions**: expire outstanding bundle checkout sessions via the Stripe API (or wait out the 24h session lifetime) so no late webhook lands mid-backfill; (1b) short entitlement-write freeze (same flag family pauses grants and credit redemptions — trials/free launches unaffected); (2) chunked backfill converts legacy fields (incl. referral- and admin-granted credits) into `CREDIT_BUNDLE` docs with the appropriate `source`; (3) census verify old-vs-new counts per user; (4) flip readers (BillingInvoiceCard.tsx:231-267, stripe.ts:157-197,533-573, adminBillingOps.ts:127-152) to the new model; (5) unfreeze; (6) delete legacy fields in a later cleanup once a full billing cycle passes clean.
15. **User transparency**: "My Bundles & Credits" card on the Commissioner dashboard (credits remaining, per-credit constraints, pass expiry countdown, purchase history, revocation notices) + the wizard payment step surfaces redeemable entitlements.
16. **Admin control**: `adminGrantEntitlement` / `adminRevokeEntitlement` callables (replacing raw `adminAdjustUserCredits` counter pokes) — grant bundle/credits, revoke bundle (voids unused credits), revoke single credit, expire pass early; reason string required; written to `admin_audit`; visible to the owner.
17. **Redemption hardening**: server-side transaction (credit `available`, constraints satisfied, bundle `active` → mark used + increment `creditsUsed` + stamp pool billing `status:"active", paidVia:"credit"` + set `exhausted` when creditsUsed = creditsTotal).

### Phase 5 — Refunds & disputes

18. **Ledger schema extension first**: `billingCharges` gains `paymentIntentId`, `chargeId`, `relatedChargeId`, and `kind` widens to `pool|bundle|refund|dispute` (refund/dispute events key off charge/payment-intent, not checkout session). Checkout webhook stamps `paymentIntentId` on every new charge row.
19. Webhook handlers for `charge.refunded` and `charge.dispute.created`: write a negative adjustment Billing Charge linked via `relatedChargeId`, mark the original, flag pool/bundle in the Monetization alert center. No automated pool locking — Super Admin decides (one-click lock / revoke from the alert).
20. **Ledger reliability**: `recordBillingCharge` stops being best-effort — the ledger row is written in the same idempotent transaction/batch as the pool/bundle mutation; a failure fails the webhook (Stripe retries).

### Phase 6 — Monetization tab: accounting dashboard, alerts, templates

21. **Accounting view** (ledger-driven from `billingCharges` + `coupons` + `bundles`; each row deep-links to the Stripe dashboard):
    - Revenue: by period (day/week/month), by kind (pool vs bundle), by format, gross vs discounts given, refunds/disputes netted.
    - Coupons: per-coupon usage timeline, who/when/which pool (from `usageLog`), uses remaining, pending reservations, expiring-soon list.
    - Bundles: outstanding liability (unredeemed credits × per-pool value), per-user drill-down, revoked history.
    - **User money profile** (troubleshooting): search a user → their charges, coupons used, entitlements owned/used, pools with billing state, one screen.
22. **Alert center**: velocity spike (coupon > X uses/24h, configurable, default 10), new-account cluster (redemptions from accounts < 48h old), ≥80% of maxUses, expiring < 7 days, refund/dispute flags. Dashboard banner + email (existing `mail` collection) for the two abuse alerts only. One-click deactivate coupon (in-flight reservations still honored; new checkouts rejected). Computed by a scheduled job writing `monetization_alerts/{id}` (status: open|acked).
23. **Coupon Templates**: `couponTemplates` collection (coupon shape minus code/counters + name/notes); Monetization tab CRUD; "mint from template" prefills the create form; "save as template" from any coupon.
24. **Firestore rules matrix for new collections** (default-deny would break the dashboards): `bundles` — owner read own + SUPER_ADMIN read all, writes functions-only; `bundles/*/credits` same; `couponTemplates` — SUPER_ADMIN direct client read (powers the tab list), all writes via callable/functions only; `monetization_alerts` — SUPER_ADMIN read, writes functions-only; `coupons` — SUPER_ADMIN client read only (Phase 3). Positive AND negative rules tests for each.

### Phase 7 — Test suite (below) + docs (ARCHITECTURE/CONTEXT sweep, ADR-0001 amendment note)

## Key decisions & tradeoffs

- **Keep the engine, rebuild the UX**: stripe.ts checkout/webhook/ledger/audit core is sound; a from-scratch rewrite would re-risk working money code.
- **Payment lives in the wizard** (trial-or-activate at launch); /pricing is estimator + store + trial activation. Kills the "select a pool above" dead end at the root. ADR-0001 point 5 amended: launch billing mode (`free`|`trial`) is server-validated input, not always-`free`.
- **Anonymous wizard**: Pool Draft is device-local (CONTEXT.md), signup happens at the launch step.
- **Pool Credits never expire; Unlimited Pass keeps its term** — Super Admin can revoke either (audited). One canonical entitlement model in `bundles/`, legacy counter fields migrated and retired.
- **Coupon uses reserved at checkout (server `reservationId`), confirmed at webhook, released on expiry** — ADR-0002. Hard limits, no overshoot; abandoned checkout can hold a use ≤24h. `coupons` becomes admin-read-only; buyers validate via sanitized callable.
- **Server is the only price authority**: quotes, add-ons, free-tier qualification, redirect URLs all server-computed; client math is display-only.
- **Refunds flag, never auto-lock** — admin decides; ledger gets a linked negative adjustment row so accounting stays truthful, written transactionally with the money event.
- **Accounting is Firestore-ledger-driven with Stripe deep-links**; full Stripe API reconciliation deliberately deferred.
- **Test strategy**: unit + emulator-integration automated; Stripe-hosted checkout page covered by a manual sandbox UAT checklist (browser automation against Stripe UI is flaky).

## Test plan

### Layer 1 — Unit (vitest, `functions/`)
- Coupon math: percentage, flat, clamp at $0, stacking guard.
- Reservation transaction: maxUses boundary (last use), concurrent reservation contention (transaction retry), perUserLimit boundary, expired/inactive/wrong-format rejection, release decrements, confirm flips status via reservationId, session-creation-failure release, free-pool path writes confirmed.
- Quote engine: every pool format resolves a tier (unmapped format fails); add-on pricing; coupon-inclusive quote (getPoolQuote with couponCode); free-tier disqualified by paid add-ons; trialDays from config.
- Paid ceilings: `updatePoolSettings` rejects player-cap raise / paid add-on enable beyond `billing.paid` snapshot; join blocked beyond paid maxPlayersAllowed; upgrade re-quote charges only the delta.
- Feature gating: missing `featuresUnlocked` key denies paid feature; free/trial launch stamps explicit false flags.
- Checkout idempotency: second createCheckoutSession on a pool with live pendingSessionId rejected; webhook for already-active pool no-ops and writes refund-review alert.
- Bundle size cap: BillingConfig schema rejects `creditsTotal > 100`.
- Entitlements: redemption of used/revoked/constraint-violating credit rejected; success marks used + counter; exhausted transition; pass term expiry; revoke voids only unused credits; migration converts each legacy field shape correctly.
- BillingConfig schema: valid config accepted; malformed config (missing tier, negative price, unknown format) rejected by `adminSaveBillingConfig`.

### Layer 2 — Emulator integration (Firestore emulator + stripe CLI fixtures)
- `checkout.session.completed`: pool activation, bundle grant, coupon confirm, ledger write — one transaction; replayed twice → idempotent (single effect).
- `checkout.session.expired`: reservation released via metadata match.
- `charge.refunded` / `charge.dispute.created`: linked adjustment ledger row + alert doc; original charge marked.
- Ledger-write failure fails the webhook (no silent drop); Stripe retry then succeeds idempotently.
- Scheduled sweep: stale pending (>24h) released; fresh pending untouched.
- Rules tests — negative: client cannot write `coupons`, `billingCharges`, `bundles`, `pools.billing`, `monetization_alerts`, `couponTemplates`; cannot read others' bundles; non-admin cannot read `coupons`. Positive: owner reads own `bundles`+credits; SUPER_ADMIN reads all new collections.

### Layer 3 — Manual UAT checklist (Stripe sandbox, run before enabling live billing)
Each item records evidence: screenshot + `billingCharges` row + Stripe dashboard link.
1. Anonymous → build draft → sign up at launch → trial start (no charge; `billing.status:"trial"`, correct `trialEndsAt`).
2. Anonymous → build draft → sign up → activate now → 4242 card → pool active, ledger row with paymentIntentId.
3. Logged-in, no pools → /pricing shows "Create your pool" (no dead pay button) → wizard.
4. Trial pool → /pricing → select → pay → active; second pay attempt → blocked, no double charge; two tabs racing checkout on the same pool → second session rejected (pendingSessionId), completed-pool webhook no-ops + flags.
5. Card declined (4000…0002) → pool stays trial, no ledger row, reservation released after expiry.
6. 3DS card (4000…3155) → challenge completes → active.
7. Each format (Bracket, Squares, Props, Pick'em, Survivor, Margin) × player counts at every tier boundary (10/11, 25/26, 50/51, 100/101) → server quote matches config table; free tier at ≤10 with no add-ons.
8. Free-tier pool + paid add-on → payment required (no free bypass); quote itemizes add-on.
8b. Pay for 25-player tier → attempt to raise cap to 60 in pool settings → blocked with upgrade prompt; pay delta → allowed. 26th join attempt on a 25-player-paid pool → blocked.
9. Redirect tampering: crafted successUrl/cancelUrl in the callable payload is ignored (server-derived URLs used).
10. Coupons: percentage, flat, 100% (free pool — use recorded as confirmed), expired, inactive, wrong format, lowercase entry works, maxUses race (two browsers on the last use → exactly one succeeds), perUserLimit hit, abandoned checkout releases within 24h (or on session expiry).
11. Bundles: buy credit bundle → dashboard card shows credits; create pool via credit (format/size constraints honored, oversize blocked); exhaust → status exhausted; buy Unlimited Pass → unlimited creates during term; blocked after term / after admin early-expire.
12. Migration spot-check: user with legacy `freePoolsAvailable`/`poolCredits` sees equivalent entitlements post-migration and can redeem them.
13. Admin: grant entitlement, revoke bundle (owner sees revocation, credit unusable), expire pass — all in `admin_audit` with reason.
14. Refund in Stripe sandbox → alert appears, ledger shows linked negative row; dispute fixture likewise; one-click lock from alert works.
15. Coupon templates: save, mint, minted coupon works.
16. Alerts: drive a coupon past velocity threshold → dashboard banner + email received; one-click deactivate rejects new checkouts while honoring in-flight reservation.
17. Non-admin account cannot read `coupons`/`billingCharges`/others' `bundles` (console probe).

## Risks / open questions

- `usageLog` array growth on hot coupons (~2k+ uses risks the 1 MiB doc limit) — if expected volume exceeds that, move usageLog to a subcollection during Phase 3; counting logic unaffected.
- Wizard payment step lands on the unified wizard shell (worktree D:\mmp-wizard, feat/wizard-unification Phase A) — coordinate to avoid clobber; ADR-0001 amendment must merge with that work.
- Entitlement migration (Phase 4) is a prod-data mutation → per change-control rules: dry-run mode + kill switch + census before/after; cutover uses a short entitlement-write freeze (sequence in Phase 4).
- Anonymous-draft → auth round-trip must preserve the draft on mobile browsers (localStorage survival in UAT).
- Alert email volume during legitimate promo pushes — thresholds configurable; start conservative.

## Out of scope

- Entry Fees / P2P participant money (platform never touches it — settled decision).
- Full Stripe API reconciliation job (deferred; ledger + deep-links this round).
- Browser automation through Stripe-hosted checkout UI.
- Subscription/recurring billing; everything stays one-time payments.
- Referral system changes beyond migrating referral-granted credits into the canonical entitlement model.
