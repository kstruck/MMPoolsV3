# PLAN-WIZARD-BUYFLOW-FIXES — Make the create-pool → launch → upgrade path seamless

**Status: SIGNED — Kevin answered D1–D6 on 2026-08-23 (answers recorded in §4).
Scope extended the same day with T8 (post-wizard branding editor) and T9 (AI
Commissioner overhaul) from Kevin's follow-up. Build: overnight 2026-08-23→24.**
**Author session: 2026-08-23 (cloud). Deadline context: invites go out Monday 2026-08-25.**
**All file:line anchors measured at `925c6d7` (origin/main, 2026-08-23).**
**Review log: `PLAN-WIZARD-BUYFLOW-FIXES-REVIEW-LOG.md`.**

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
  - `branding.primaryColor` ← **no renderer reads it** (its only occurrences
    in `src/` are the wizard field and its help copy; measured by grep,
    2026-08-23);
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
- **No runtime check gates it.** (The flag itself appears in tests and in the
  generic access helper — but no caller passes `customBranding` to it, and no
  render path reads it.) Server: `checkBillingAccess` is only
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

Full walk of the NFL create → launch → join → upgrade → payment flow
(anchors measured at `925c6d7`). G1–G5 were re-verified by hand; the rest by
the sweep with file:line evidence.

### Blockers (must be fixed/handled before Monday's invites)

- **G1 — Pool creation is globally OFF for everyone but super admins.**
  `src/config/season.ts:2` `POOLS_OPEN = false` →
  `canAccessPoolCreation` (`src/utils/auth.ts:89-91`). All three `/create/*`
  NFL routes bounce to `/` (`App.tsx:284-310`), the create-selection cards say
  "Coming Soon", the landing hero says "Browse Public Pools While We Get
  Ready For Kickoff". **Kevin tests as SUPER_ADMIN and bypasses this, which
  is why everything looked open.** Monday's invitees cannot create a pool
  until this flips — it is a build-time constant, so the flip is a one-line
  PR + Coolify rebuild, not a config save. → **D6.**
- **G2 — Logged-out visitors on /pricing get a silent dead end.** The
  "Build Your Pool — Free to Start / no account needed" CTA
  (`PricingPage.tsx:222-243`) is enabled for anonymous users once G1 flips
  (`canAccessPoolCreation` never checks login), but `/create-pool` requires
  `user &&` (`App.tsx:452`) — click → bounced to `/`, no auth modal, no
  message. Fix: open the auth modal when `!user`, then continue.
- **G3 — A free pool that hits the 10-player wall has NO working upgrade
  path.** /pricing lists only `trial`/`grace_period` pools
  (`PricingPage.tsx:133-142`); a `free`-status pool never appears and even a
  correct `?poolId=` deep link renders no checkout card (the card renders
  only in the `hasTrialPools` branch, `:544-569`). But the 10/10 lock banner
  and the lock email both send the commissioner exactly there
  (`BillingGate.tsx:360-397`, `functions/src/billing.ts:429`). This is the
  single most important monetization moment and it dead-ends. Fix: include
  `free`-status pools the user owns in the upgradeable list.
- **G4 — The live checkout button says "Transactions are processed securely
  in Stripe Sandbox. No real credit card charges will occur."**
  (`BillingInvoiceCard.tsx:880-882`, unconditional on the production upgrade
  path.) One-line copy fix; money-trust critical.
- **G5 — After paying, nothing acknowledges the payment.** The server
  redirects to `/pool/{id}?payment=success&session_id=…`
  (`functions/src/stripe.ts:143-145`) but nothing in the client reads
  `payment=success` (only `cancelled` is handled,
  `BillingInvoiceCard.tsx:177-186`). `/payment-success` exists but is
  unreachable (only legacy bundle paths point at it, and those pass a
  `successUrl` the server no longer accepts). The commissioner pays, lands on
  the pool page, and may still see the TRIAL banner until the webhook lands.
  Fix: read `payment=success` on the pool routes → show an "activation
  processing / activated" banner.

### Friction (weekend if time allows — small, copy/gate-level)

- **G7 — "Expected number of players" defaults to 0 and is never required**
  (`CreateNFLPickemPool.tsx:120`, `LaunchStep.tsx:322-327`): an untouched
  field silently routes a 40-person pool onto the free plan; the wall is
  discovered by the 11th member. Fix: require ≥1 + copy linking the estimate
  to the free-plan cap.
- **G9 — The 11th invitee gets a raw platform-billing toast** and JoinPool
  shows no capacity/lock state at all (`JoinPool.tsx:63-84,188-192`;
  server copy `nflPools.ts:298`). Minimum fix: member-appropriate copy;
  capacity preview later.
- **G11 — Paid checkout rows say "FREE IN TRIAL" next to "+$19"**
  (`BillingInvoiceCard.tsx:671` outside any `isWizard` guard) — on the
  UPGRADE page the trial is over; the label contradicts the total.
- **G12 — Literal `**asterisks**` render in the free-pool-limit warning**
  (`BillingInvoiceCard.tsx:625-626`).
- **G14 — A pool with a $25 entry fee can launch with NO payment handles and
  no instructions** (`StepFeeAndPayment.tsx:25-43`, no validation): invitees
  see "Entry Fee $25" and no way to pay. Fix: warn (not block) at launch
  when fee > 0 and every handle + instructions are blank.

### Backlog (after Monday — ticketed, not built this weekend)

- **G6** — Only the Basics step validates; schema failures surface as a
  generic unattributed error on Launch (`WizardShell.tsx:57-59,101-108`,
  `LaunchStep.tsx:206-209`). Needs per-step `fields` lists — real work,
  regression-prone, not a weekend change.
- **G8** — The free-plan "10" is hardcoded in three places
  (`nflPools.ts:297`, `billing.ts:393-394`, `BillingGate.tsx:266-294`) while
  /pricing renders the configurable `freePlayerThreshold`; also
  `participantIds` seeds with the commissioner so "10" is really 9 invitees.
- **G10** — No trial-ending warning exists anywhere; the first email fires
  AFTER the trial ends (`billing.ts:154-165`). T7's copy softens this;
  a day-11 reminder email is backlog.
- **G13** — Every bundle card claims "SAVE OVER 35%" unconditionally
  (`BillingInvoiceCard.tsx:917-919`).
- **G15** — Share button toasts "copied!" without awaiting the clipboard
  promise (`NFLPoolDashboard.tsx:597-601`).
- **G16** — Resuming a wizard draft restores values but resets to step 1
  with later steps re-locked (`WizardShell.tsx:111-114`); "Start over"
  deletes the draft with no confirm.
- **G17** — `PaymentSuccess` classifies pools vs bundles by id-length
  heuristic (`PaymentSuccess.tsx:19-24`); fix when G5 rewires the page.
- **G18** — /pricing estimator still sells SMS, which wizard + checkout +
  webhook all refuse (`PricingPage.tsx:425-451` vs `stripe.ts:763-792`).
- **G19** — Legacy wizards still mounted (`PropsWizard` from
  PropsPoolDashboard, `AdminPanel` WizardStep* at `/admin/:id`) — a second,
  divergent branding editor lives there.
- **G20** — Dead/contradictory bits on CreatePoolSelection (disabled
  bracket/playoff cards vs live routes; NFL wizards' name placeholder says
  "Office March Madness"; JoinPool labels unknown types "Squares").

Checked with no gap found: the Stripe PAID path correctly stamps the
checkout's add-on selection at activation (`stripe.ts:444-455, 728-840`);
one residual — `billing.trialEndsAt` is never deleted on activation,
harmless today because every reader branches on `status` first.

## 3. Tickets

Ordered for the weekend. T1–T4 close Kevin's issues 1–4; T5 covers the trial
entitlement gap; **T6a is BLOCKER work (G2–G5), not polish** — G3 (free-pool
upgrade dead end) and G5 (no payment acknowledgement) sit directly on the
monetization path; T6b and T7 are the friction/copy items. T8/T9 were added
by Kevin on 2026-08-23 after sign-off. Overnight build order:
**T2 → T3 → T6a → T4 → T1 → T5 → T9 → T8 → T10 → T6b → T7 → POOLS_OPEN flip PR**
(T9 before T8 because T5+T9 together are what makes D2's "AI features
working" true; T8 reuses T1's branding field components; T10 added by Kevin
2026-08-23 — standings/results tab merge).

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
- Quote failure must not dead-end into trial-only (codex r1 #5): add a
  "Try again" control to the quote error state, mirroring
  `BillingInvoiceCard`'s existing `quoteRetry` pattern
  (`BillingInvoiceCard.tsx:127-136`).
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
- Staleness (codex r1 #3): the pricing page ALREADY revalidates whatever code
  it preloads — `couponInput` feeds `getPoolQuote`, and an
  expired/capped/disabled code comes back `couponState.valid: false` with a
  reason rendered on the card. Acceptance criterion: a preloaded-but-invalid
  coupon shows the server's reason and prices at full; it must not block
  checkout.
- Visibility (codex r1 #2): `billing.couponCode` is readable by pool readers.
  Accepted deliberately: coupon abuse is bounded server-side at redemption by
  `validateCouponRules` (`maxUses`, `perUserLimit`, `allowedPoolTypes`,
  expiry — `functions/src/lib/couponReservation.ts` / `billing.ts:495-523`),
  so a leaked code can never exceed the caps Kevin configured. If a coupon is
  ever meant to be secret per-recipient, that is a coupon-configuration
  matter (per-user limit 1), not a storage-location one. D3 carries this
  trade-off to Kevin explicitly.

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

### T6 — E2E blocker + friction fixes (from §2 sweep)

Weekend scope, split in two PRs:
- **T6a (blockers):** G2 (anon CTA → auth modal), G3 (free pools upgradeable
  on /pricing), G4 (sandbox copy), G5 (`payment=success` acknowledgement
  banner on the pool routes). All frontend; G3/G5 touch the money UX but no
  server change.
- **T6b (friction):** G7 (require player estimate ≥1 + cap copy), G9 (11th
  invitee copy), G11 ("FREE IN TRIAL" wizard-only), G12 (asterisks), G14
  (fee-without-handles launch warning).

G1 (POOLS_OPEN flip) is deliberately NOT part of T6 — it is the launch act
itself and its timing is Kevin's (**D6**).

Backlog G6/G8/G10/G13/G15–G20: ticketed in §2, not built this weekend.

### T8 — Commissioner can edit branding after the wizard (Kevin, 2026-08-23)

There is no post-wizard surface to change logo/colors — the wizard's branding
step is the only writer. Add a **Branding** section to the NFL commissioner
manager view (`NFLManagerView.tsx` settings area) with the same three fields
as `StepBranding` (plus the T1 color pickers/preview), saving through the
existing pool-update path — `functions/src/__tests__/poolUpdate.test.ts:31`
already names a `branding` editability group, so verify the callable's
editability matrix allows `branding.*` for the owner/co-commissioner and wire
to it (extend the matrix if the group turns out to be test-only). NFL first
(Monday's invites); other dashboards ticketed.

### T9 — AI Commissioner: make it real, visible, and manageable (Kevin, 2026-08-23)

Kevin's report: "I still do not see the AI features working. I see draft only —
not saved… users do not know what to do on that card… commissioners must be
able to delete any message… where are these messages shown to members?"

Measured state:
- The screenshotted **"AI Commissioner Chat" card is a mock**
  (`NFLManagerBentoDashboard.tsx:575-654`): `banterFeed` is component state
  (`:79`), `handleSendBanter` prepends to it locally (`:282-295`), nothing is
  persisted, no AI is called, no member ever sees it. The "Draft only — not
  saved" footer is the honest label of an unbuilt feature (HANDOFF item 8).
- The REAL pipeline exists and works end-to-end for paid pools:
  `pools/{id}/ai_requests` (participant + entitlement-gated create,
  `firestore.rules:497-523`) → `onAIRequest` → Gemini →
  `pools/{id}/ai_artifacts` (functions-write-only, world-readable,
  `firestore.rules:492-495`), rendered by `src/components/AICommissioner.tsx`
  on the pool dashboard's AI tab (`NFLPoolDashboard.tsx:841,1033`) — which is
  **gated on `featuresUnlocked.aiCommissioner`, all-false during trial**.
  That is why Kevin "never saw AI working": T5 fixes it.
- No delete path exists for any AI/banter content (`ai_artifacts` write:false).

Scope (respecting PLAN-COST-CONTROLS 0.5 — entitlement gates and quotas stay):
1. **Persist the banter feed.** Replace the mock card's local state with a
   real store: commissioner-typed messages AND AI-generated banter land in a
   member-readable feed (recommended: `pools/{id}/banter` docs or
   announcements-with-kind — implementer picks the shape that reuses the
   existing announcements read rules; document the choice).
2. **AI generation from the card.** The mood buttons + prompt call the real
   pipeline (an `ai_requests` doc with a BANTER category carrying the mood,
   handled in `onAIRequest`'s system prompt), entitlement-gated exactly like
   the existing categories. Generated banter posts into the same feed.
3. **Member visibility.** The feed renders on the pool homepage (dashboard
   Overview tab) for all members — not only inside the manager view.
4. **Commissioner delete.** Owner/co-commissioner can delete any feed
   message (rules change on the feed collection, or a thin callable; NOT a
   blanket write on `ai_artifacts`).
5. **UX copy.** The card explains itself: what the moods do, what the input
   does ("Type your own message, or describe what the AI should write"),
   and the DRAFT/NOT-SAVED footer is replaced by real status.
6. Rules changes = AUTHORIZATION → this plan's gate covers them; keep the
   `ai_requests` create conditions intact (all four are load-bearing).

### T10 — Merge Standings + Results into one scoped Standings tab (Kevin, 2026-08-23)

Kevin's report: "The Standings and Leaderboard tab shows the week standings,
but you have to go to Results to see the season-long standings… Can we not
just combine these tabs?"

Measured state: `NFLStandings.tsx` is BY DESIGN the season-only leaderboard
(Kevin's 2026-08-13 ruling, recorded at `NFLStandings.tsx:63-71`, moved the
weekly view out to Results) — but its dominant columns are week-scoped
("{Week} Pick", "N of 16 Picks Set", the week's tiebreaker guess, all keyed to
the global week selector; `NFLStandings.tsx:240-265`), while the season total
is a single right column that reads 0 before anything is scored. So the season
page presents as a weekly page. `NFLResults.tsx` holds the legible weekly AND
season tables behind sub-view toggles (`PickemView WEEKLY|SEASON`,
`MarginView WEEKLY|SUMMARY|STANDINGS` — a "Standings" sub-view competing with
the Standings tab; `NFLResults.tsx:61-62`). Two tabs, overlapping names, scope
split across both.

**This REVERSES the 2026-08-13 two-page ruling, by its own author, on new
evidence (2026-08-23 user confusion reports).** Frontend only.

Scope:
- One **Standings** tab with a segmented scope control: **Season** (default) |
  **This Week** (+ **Summary** for Margin only). Season segment renders the
  season table (per-week pick columns move to the Week segment so season reads
  as season); Week segment renders `NFLResults`' weekly table (row-expand pick
  reveal included); Margin's Summary segment carries its summary view.
- The tab header states its scope ("Season Standings" / "{Week label}
  Results") so a screenshot is self-explaining.
- Remove the Results tab from the strip. Keep `results` VALID in the tab list
  and map `?tab=results` → Standings/Week segment — stale shared links must
  land somewhere sensible, not fall to the dashboard (same rule the Survivor
  fallback already follows, `NFLPoolDashboard.tsx:63-94`).
- Survivor: unchanged single view (it has no Results tab today).
- Update the help registry for the merged page (the `pool.nfl.standings` /
  `pool.nfl.results` topics and the published `offeredTabs`) and run the
  help-coverage + useUrlTab guard suites — the offered-tab list is
  load-bearing (HANDOFF K13 warning).
- Tests: extend `utils/nflResults` tests only if ranking logic moves (it
  should not — re-parent, don't rewrite); add a small test for the
  `results`→`standings` alias normalization.

### T7 — Copy honesty pass on the launch/billing surfaces

- LaunchStep trial line says what the trial includes (per D2 outcome) and what
  happens at day 14 (grace period → pool locks; nothing is charged
  automatically — there is no card on file).
- Trial banner in `BillingGate` gains the same one-liner.

## 4. DECISIONS — ANSWERED BY KEVIN, 2026-08-23

| # | Kevin's ruling |
|---|---|
| D1 | **Free for everyone, remove the $29 fee.** "No one has paid that yet." (Ledger audit in T4 still runs as a verification, not a search for refunds.) |
| D2 | **Approved** — trial unlocks selected add-ons. Plus the T9 scope: AI feature must be fully wired, explained, member-visible, and commissioner-deletable. |
| D3 | **Approved** — persist `billing.couponCode` at launch. |
| D4 | **Approved**, with the explicit condition that branding rendering is READY FOR MONDAY's live publish — working when people create pools. |
| D5 | **Changed by Kevin: everything is in scope for the overnight build** (tonight 2026-08-23 → tomorrow). Order below stands; backlog G-items get picked up only after T1–T9 are done. Pool creation opens Monday. |
| D6 | **Approved** — flip ships per the recommended sequence (last PR, after T6a's G2 fix; logged-out smoke pass before invites). |

The original questions are kept below for the record.

### Original questions (as put to Kevin)

- **D1 (T4):** Custom branding → free (Option A, recommended) or enforced gate
  (Option B)? On "approve as recommended": branding add-on disappears from
  wizard + pricing UI, config flips `isPremium: false`, basic branding free
  for everyone.
- **D2 (T5):** Unlock selected add-ons during trial? Recommended YES. On
  approve: trial stamps `featuresUnlocked` from the wizard selection.
  Named risk (codex r1 #4): trial output is durable — a pool could run its
  14 trial days, extract the AI Commissioner recaps, and never pay.
  Recommendation stands: that is the ordinary cost of a free trial, the
  exposure is one pool × 14 days, and the alternative (selling add-ons that
  cannot be tried) is the current complaint. No extra guard for the weekend.
- **D3 (T3):** Persist the wizard coupon to `billing.couponCode` at launch
  (visible to the pool's readers per current rules)? Recommended YES — it is a
  promo code, not a secret. Alternative: keep client-side only (sessionStorage),
  weaker but zero server change.
- **D4 (T1):** NFL-only branding rendering for the weekend, rest ticketed?
  Recommended YES.
- **D5 (scope):** Weekend build list, one PR at a time per the 2026-07-21
  cadence rule, in order: **T2 → T3 → T6a → T4 → T1 → T5 → T6b → T7**
  (highest money-impact first; T5 depends on D2). Backlog (G6, G8, G10, G13,
  G15–G20) waits until after Monday. Confirm the cut and the order.
- **D6 (launch):** When does `POOLS_OPEN` flip to `true`? It is a one-line
  code change (`src/config/season.ts:2`), currently OFF —
  **invitees cannot create pools until it ships.** This is an OPS-GATED
  step, not a toggle: it needs a Coolify `www` rebuild to take effect, and
  rollback is another commit + rebuild (~minutes of exposure either way).
  Recommended sequence: flip in the LAST weekend PR (Sunday), Coolify
  rebuild, then a logged-out smoke pass Sunday night — `/create-pool`
  reachable, one throwaway Pick'em created end-to-end, then deleted — before
  Monday's invites. Hard prerequisite: the flip must not ship before T6a's
  anon-CTA fix (G2), or logged-out visitors hit the silent bounce.

## 5. Gates

- Each ticket lands as its own PR: gates = vitest (root + functions where
  touched), lint delta zero, `codex exec review --base origin/main` per §2c
  (qodo DORMANT — two-condition stopping rule), self-review of the diff.
- No prod-data mutation anywhere in this plan. One config-doc save (D1) is a
  Kevin action in the Super-Admin panel, not a script.
- Deploy: T3/T5 touch `functions/` → full `npx firebase deploy` ritual
  (git pull in `D:\march-melee-pools` first — step zero); T1/T2/T4-UI/T7 are
  Coolify `www` rebuild only.
