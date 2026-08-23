# PLAN-WIZARD-BUYFLOW-FIXES — Make the create-pool → launch → upgrade path seamless

**Status: DRAFT — awaiting Kevin's sign-off on D1–D5 below. No code written.**
**Author session: 2026-08-23 (cloud). Deadline context: invites go out Monday 2026-08-25.**

Plan-gated: this touches **money** (coupons, activation, trial entitlements) — the
`mmp-change-control` §1 MONEY trigger fires. This document is the gate.

## 0. Scope

Kevin's five reports (2026-08-23), verified against the code:

1. Branding page colors do nothing visible.
2. A coupon on Review & Launch can make "Activate now" disappear.
3. "Upgrade Now" from the pool home page loses the wizard's add-ons and coupon.
4. "Custom branding" add-on is charged but gates nothing; the branding questions
   are free-form for everyone.
5. Full E2E review of NFL pool creation — find all gaps.

Everything below carries file:line evidence. Fixes are grouped into tickets
T1–T7 with a recommended cut line for the weekend.

---

## 1. Verified root causes

### Issue 1 — Branding colors are collected but (almost) never rendered

- The wizard's shared branding step collects `branding.logoUrl`,
  `branding.primaryColor`, `branding.secondaryColor`
  (`src/components/wizard/steps/StepBranding.tsx:11-14`).
- The payload carries `branding` through to the pool doc untouched
  (`buildNFLPayload.ts:83`; `branding` is not in `PRIVILEGED_POOL_FIELDS`,
  `functions/src/poolOps.ts:101-113`), so the data IS stored.
- The NFL dashboard reads **different fields**
  (`src/components/NFLPoolDashboard/NFLPoolDashboard.tsx:603-633`):
  - page background ← `branding.bgColor` — **a field no wizard collects**;
  - `branding.secondaryColor` ← only the 2px active-tab underline
    (`accentHex`, lines 604, 724-806) — practically invisible;
  - `branding.primaryColor` ← **read nowhere in the app**;
  - `branding.logoUrl` ← works (header logo).
- So: logo works, colors appear to do nothing. Confirmed as designed-broken,
  not a data loss.

### Issue 2 — Coupon hides "Activate now"

- `LaunchStep.tsx:473`: the Activate button renders only when
  `quote && quote.total > 0`. A **100%-off coupon** drives the server quote's
  `total` to $0 (`functions/src/lib/quoteEngine.ts:117-129`), the button
  disappears, and only "Start 14-day trial" remains.
- The server explicitly SUPPORTS $0 activation via full-discount coupon —
  `createCheckoutSession`'s FREE PATH (`functions/src/stripe.ts:300-393`)
  activates the pool with no Stripe redirect when
  `couponIsFullDiscount`. The client gate is simply wrong.
- Same gate also hides Activate when the quote errors (`quote` null), leaving
  trial as the only path — acceptable fallback, but worth a retry control.

### Issue 3 — "Upgrade Now" forgets the wizard's choices

Four independent drops, all confirmed:

a. **The link carries no pool.** The trial banner's Upgrade Now is a bare
   `/pricing` anchor (`src/components/billing/BillingGate.tsx:469-496`) — the
   commissioner must re-find and re-select their pool
   (PricingPage supports `?poolId=`, `PricingPage.tsx:89-94`, it's just never used).
b. **Add-ons re-seed from the wrong field.** On pool selection the pricing page
   seeds toggles from `pool.billing.featuresUnlocked`
   (`PricingPage.tsx:162-164`) — which a trial launch stamps **all false**
   (`LOCKED_FEATURES`, `functions/src/lib/poolCreation.ts:62-67, 95`) —
   instead of from `pool.addons`, the wizard's actual selection, which IS
   stored top-level on the pool doc (spread via `readLaunchFields`,
   `buildNFLPayload.ts:71`). `calcBranding` is not seeded at all.
c. **The checkout card is hardcoded empty.** `BillingInvoiceCard` is mounted
   with `hasAiCommissioner={false} … hasCustomBranding={false}`
   (`PricingPage.tsx:557-568`), so even the seeded state never reaches the
   card that actually calls `createCheckoutSession` (`BillingInvoiceCard.tsx:478-487`).
d. **The coupon is never persisted.** The wizard's coupon lives only in
   LaunchStep local state; "Start trial" never sends it anywhere.
   `PricingPage.tsx:568` reads `selectedPoolData.billing?.couponCode` — a field
   **no code path writes** on the trial launch (`billingForLaunch`,
   `poolCreation.ts:84-104`).

Result exactly matches Kevin's repro: $147 quote in the wizard (base $99 for a
100-player season pool + AI $19 + branding $29), then a checkout page with
nothing selected and no coupon.

### Issue 4 — "Custom branding" is charged but gates nothing

- It is priced (default $29, `shared/schemas/billingConfig.ts:234`,
  `quoteEngine.ts`) and stamped into `billing.featuresUnlocked.customBranding`
  on activation (`stripe.ts:261-266, 833`).
- **No code anywhere checks that flag.** Server: `checkBillingAccess` is only
  invoked for bracket entries / prop bets / AI commissioner
  (`bracketEntries.ts:144,213`, `propBets.ts:67,216`, `aiCommissioner.ts:38`) —
  never for branding. Client: every `featuresUnlocked` read is
  `aiCommissioner` (grep of `src/`); branding renders unconditionally from
  `pool.branding` (`NFLPoolDashboard.tsx:603-633`).
- Meanwhile the free branding step asks everyone for logo + colors, ungated.
- Net: customers can be charged $29 for a flag with zero effect, while the
  feature it names is free. Kevin's read ("completely broken") is correct.

### Bonus finding — trial pools get NONE of the add-ons they selected

- Trial launch stamps `featuresUnlocked` all-false regardless of the wizard
  selection (`poolCreation.ts:95`). A commissioner who ticked AI Commissioner
  and started the trial has **no AI tab for the whole trial**
  (`NFLPoolDashboard.tsx:841,1033` gates on the flag) — they can't try the
  thing the trial is supposed to sell. Add-ons only turn on after payment
  (webhook stamps from the checkout snapshot, `stripe.ts:759-833`).

## 2. E2E gap sweep (issue 5)

_(Filled from the full-flow sweep — see §2b table.)_

## 3. Tickets

Ordered for the weekend. T1–T4 close Kevin's issues 1–4; T5 covers the trial
entitlement gap; T6/T7 are the E2E polish items worth doing before Monday.

### T1 — Make branding colors actually theme the pool (issue 1) — frontend only

- `NFLPoolDashboard.tsx`: derive the pool accent from
  `branding.primaryColor` and apply it where a member actually looks:
  the pool header card (name bar background or border + Host line accents),
  the active-tab underline (today's `accentHex`), and the primary action
  buttons on the dashboard tab. `branding.secondaryColor` stays the accent
  for tab underline/secondary highlights. Keep reading `bgColor` as a legacy
  fallback for the page background; ALSO apply a subtle
  `primaryColor`-tinted page background so the choice is visible.
- `StepBranding.tsx`: label the two fields by effect ("Primary color — header
  & buttons", "Accent color — highlights & active tabs"), add a `type="color"`
  picker next to the hex input plus a live preview strip, and validate hex
  format (a bad string today silently styles nothing).
- Same rendering treatment on the other dashboards that already read
  `branding` (Bracket/Playoff/Props/Squares) is OUT OF SCOPE for the weekend —
  NFL only (Monday's invites are NFL). Ticket the rest.
- Tests: extend the existing vitest suites with a unit test on the new
  `brandingStyles` helper (hex validation, fallback order). No coverage claims.

### T2 — Coupon must never remove the Activate path (issue 2) — frontend only

- `LaunchStep.tsx:473`: render the Activate button whenever a quote loaded and
  the pool is not free-tier-eligible; label it
  `Activate now — $0 (coupon applied)` when `quote.total === 0` with a valid
  coupon. The server's $0 FREE PATH (`stripe.ts:303-393`) already activates
  without Stripe and confirms the coupon atomically — no server change.
- Keep the button hidden when the $0 comes from free-tier eligibility (the
  green "Launch free pool" path already covers it).
- Test: unit test on a small extracted `launchButtonsState(quote)` helper
  covering: no quote / free-eligible / paid / valid 100% coupon / invalid
  coupon.

### T3 — Carry the wizard's selections into Upgrade Now (issue 3)

Frontend:
- `BillingGate.tsx`: all four commissioner CTAs (`trial` banner Upgrade Now,
  `free` banner Upgrade to Premium, `grace_period` Pay Now, `locked` Pay Now)
  link to `/pricing?poolId={pool.id}` when a pool id is present.
- `PricingPage.tsx`: seed the calculator AND the `BillingInvoiceCard` props
  from the pool's stored wizard selection: `pool.addons.*` (falling back to
  `billing.featuresUnlocked` for legacy pools), `pool.estimatedPlayers`,
  and `billing.couponCode`. Fix the missing `setCalcBranding` seed. Replace
  the hardcoded `hasX={false}` at `PricingPage.tsx:557-568` with the seeded
  values.

Server (money-adjacent, the reason this plan exists):
- Persist the coupon at launch. `LaunchStep` adds `couponCode` to the create
  payload; the create callables **consume** it (delete from the spread — the
  permissive envelope would otherwise write it top-level onto the pool doc),
  validate via `resolveCouponForQuote`, and stamp `billing.couponCode` (upper-
  cased) only when valid. No reservation, no usage increment — it is a
  remembered intent, not a redemption; redemption stays in
  `createCheckoutSession` where it is already atomic.
- `stripPrivilegedPoolFields` gains `couponCode` so no other permissive create
  path can write it top-level.

### T4 — Custom branding: stop selling a no-op (issue 4) — D1 decides shape

Recommended (Option A, "branding is free"):
- Remove `customBranding` from the wizard's add-on list
  (`LaunchStep.tsx:332-341` filter) and from the pricing page's upgrade
  toggles; basic branding (logo + two colors) is included for every pool and
  the branding step says so.
- Keep the config key, schema, and `featuresUnlocked` plumbing — dormant, for
  a future genuinely-premium branding tier (cover images, custom headers,
  themes). Set `isPremium: false` for `customBranding` in
  `settings/billing_config` so any stray payload prices it at $0
  (`computeAddonLines` already drops non-premium features — no code needed
  server-side, one config save in the Super-Admin Billing panel).
- Audit: check whether any REAL pool has paid for customBranding to date
  (ledger query); if any exists, Kevin decides refund/credit individually.

Rejected for the weekend: Option B (enforce the gate — hide branding step
unless the add-on is bought, gate rendering on `featuresUnlocked`) — it is
more code, needs server enforcement in `updatePoolSettings` to be honest, and
punishes the exact commissioners we invite Monday. Can be revisited when a
premium branding tier actually exists.

### T5 — Unlock selected add-ons during the trial (bonus finding) — D2 decides

- `billingForLaunch` accepts the requested addons and stamps
  `featuresUnlocked` from them on the **trial** path (free path stays
  all-false; free pools selected no paid add-ons anyway — any paid add-on
  forces trial). The trial IS the demo; today the commissioner pays for a
  feature they have never seen. Expiry already handles abuse: trial →
  grace → locked.
- Activation continues to stamp from the PAID snapshot (`stripe.ts:759-833`),
  so a commissioner who tried AI in trial but doesn't buy it loses it at
  payment — correct, and the checkout page (fixed by T3) will show it
  pre-selected so keeping it is one click.
- Tests: functions vitest on `billingForLaunch(mode, trialDays, now, addons)`.

### T6 — E2E friction fixes (from §2 sweep)

_(Scoped after sweep findings — kept small; anything larger is ticketed, not
built, this weekend.)_

### T7 — Copy honesty pass on the launch/billing surfaces

- LaunchStep trial line says what the trial includes (per D2 outcome) and what
  happens at day 14 (grace period → pool locks; nothing is charged
  automatically — there is no card on file).
- Trial banner in `BillingGate` gains the same one-liner.

## 4. DECISIONS NEEDED (D1–D5)

- **D1 (T4):** Custom branding → free (Option A, recommended) or enforced gate
  (Option B)? On "approve as recommended": branding add-on disappears from
  wizard + pricing UI, config flips `isPremium: false`, basic branding free
  for everyone.
- **D2 (T5):** Unlock selected add-ons during trial? Recommended YES. On
  approve: trial stamps `featuresUnlocked` from the wizard selection.
- **D3 (T3):** Persist the wizard coupon to `billing.couponCode` at launch
  (visible to the pool's readers per current rules)? Recommended YES — it is a
  promo code, not a secret. Alternative: keep client-side only (sessionStorage),
  weaker but zero server change.
- **D4 (T1):** NFL-only branding rendering for the weekend, rest ticketed?
  Recommended YES.
- **D5 (scope):** T1–T5+T7 target this weekend, one PR at a time per the
  2026-07-21 cadence rule; T6 items triaged into "this weekend" vs "after
  Monday" in §2. Confirm the cut.

## 5. Gates

- Each ticket lands as its own PR: gates = vitest (root + functions where
  touched), lint delta zero, `codex exec review --base origin/main` per §2c
  (qodo DORMANT — two-condition stopping rule), self-review of the diff.
- No prod-data mutation anywhere in this plan. One config-doc save (D1) is a
  Kevin action in the Super-Admin panel, not a script.
- Deploy: T3/T5 touch `functions/` → full `npx firebase deploy` ritual
  (git pull in `D:\march-melee-pools` first — step zero); T1/T2/T4-UI/T7 are
  Coolify `www` rebuild only.
