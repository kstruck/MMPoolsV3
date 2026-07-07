# NOTES-WAVE4B — Wizard launch/payment step (PLAN-BUYFLOW-OVERHAUL Phase 2 #5)

Overnight run 2026-07-06 → 07-07, branch `feat/buyflow-overhaul`, worktree
`D:\mmp-buyflow`. Client-only wave. No git run, nothing deployed, no prod data
touched. All server pieces (getPoolQuote / createCheckoutSession /
redeemPoolCredit / computeLaunchMode) already existed and are unchanged — this
wave is the UI + feeding the create payload the fields the server reads.

Verification (from `D:\mmp-buyflow`):
- `npx tsc --noEmit -p tsconfig.app.json` → **0 errors**.
- `npx vitest run` → **226 passed (23 files)** (was 216; +10 new launch-field tests).

---

## What the launch step is

`src/components/wizard/create/LaunchStep.tsx` is the new FINAL step of the
unified create wizard. It is pure UI (ADR-0001): it never computes price and
never decides free vs trial — the server owns both. It:

1. On mount + on every input change (300ms debounce) calls
   `dbService.getPoolQuote({ poolType, estimatedPlayers, addons, couponCode? })`
   and renders the itemized server quote verbatim (base + add-on lines +
   subtotal + coupon discount + total + trialDays + freeTierEligible).
2. Runs the **launch state machine** (creation ALWAYS first; payment/redeem is an
   action ON the created pool):
   - **Launch free pool** — shown as the primary CTA when `quote.freeTierEligible`
     is true. Creates only; the server stamps `free`.
   - **Start N-day trial** — primary CTA otherwise. Creates only; server stamps
     `trial`.
   - **Activate now — $X** — shown when `quote.total > 0`. Creates (server stamps
     trial), then `createCheckoutSession` for that poolId and
     `window.location.href = sessionUrl`. Coupon input feeds BOTH the quote and
     the checkout call. Cancel/abandon at Stripe leaves the pool a trial — no
     cleanup (server handles), per the plan.
   - **Redeem <entitlement>** — shown ONLY when `subscribeToMyBundles` reports a
     matching redeemable entitlement (see eligibility below). Creates, then
     `redeemPoolCredit({ poolId, bundleId })`.
   All four actions gate on the Terms checkbox (`_tosAccepted`) which the step
   renders itself.

### Create-first, single pool, no orphans
Creation is funneled through `runCreate()`, which validates the full form
(`trigger()`), gates on TOS, then calls the flow's `createPool(values)` (returns
the new poolId, does NOT navigate). It memoizes the created poolId, so if the
follow-on (checkout/redeem) fails, retrying does NOT create a second pool — the
error banner offers a "Continue to your pool" link (the pool is a live trial).

### Eligibility for the Redeem option
Resolved from `subscribeToMyBundles(uid,…)` using the shared pure helpers
(`creditSatisfiesPool`, `isPassLive` from `@shared/schemas`):
- **UNLIMITED_PASS**: `isPassLive` (active + not expired) AND
  `creditSatisfiesPool(productSnapshot, poolType, estimatedPlayers)`.
- **CREDIT_BUNDLE**: `status === 'active'` AND `creditsUsed < creditsTotal` AND
  the same snapshot poolType/size test.
The server's `redeemPoolCredit` re-validates per-credit constraints; the
bundle-level snapshot test here is just for showing the button. If the bundles
listener errors (Wave-5 firestore.rules not yet live → permission-denied), the
redeem option simply hides — it never blocks the rest of the launch step.

---

## Per-flow status — all 7 wired (no TODOs)

The task asked for Bracket + Squares + the 3 NFL flows first, with a TODO for any
that couldn't be safely converted. Props and Playoff turned out to be the same
"replace the Review step" shape as Squares (their type-specific complexity —
Props' field-array of questions, Playoff's reminders step — lives on EARLIER
steps, not the final one), so all seven were converted cleanly. No flow was left
half-broken; there are **no `// TODO(launch-step)` markers**.

| Flow | create callable used (via helper) | LaunchStep feeField | status |
|---|---|---|---|
| CreateBracketPool | `createBracketPool` (httpsCallable, returns `data.poolId`) | `settings.entryFee` | wired |
| CreateSquaresPool | `dbService.createPool` | `costPerSquare` | wired |
| CreatePropsPool | `dbService.createPool` | `props.cost` | wired |
| CreatePlayoffPool | `dbService.createPool` | `settings.entryFee` | wired |
| CreateNFLPickemPool | `dbService.createNFLPool(…, 'NFL_PICKEM')` | `settings.entryFee` | wired |
| CreateNFLSurvivorPool | `dbService.createNFLPool(…, 'NFL_SURVIVOR')` | `settings.entryFee` | wired |
| CreateNFLMarginPool | `dbService.createNFLPool(…, 'NFL_MARGIN')` | `settings.entryFee` | wired |

Each flow now builds its `steps[]` inside the component via `useMemo` (needed so
the launch step can close over `user.id` + `onComplete`), replaces the old
`StepReview` step with a `{ id: 'launch', ownsSubmit: true, Component: <LaunchStep …/> }`
step, and keeps a functional `onSubmit` on the shell as an unreachable fallback
(the shell hides its footer submit on `ownsSubmit` steps).

`StepReview` (`steps/StepReview.tsx`) is now unused by the create flows but is
left in place + still exported from `wizard/index.ts` (harmless barrel export;
may be reused by future edit flows). Not deleted to avoid scope creep.

---

## Shell change (minimal, backward-compatible)

- `WizardStepDef` gained an optional `ownsSubmit?: boolean` (`wizard/types.ts`).
- `WizardShell.tsx`: when the current step has `ownsSubmit`, the footer renders
  no primary Next/Submit button (the step owns its own CTAs + TOS gate). Back /
  Cancel navigation and the whole step-nav are unchanged. Flows without
  `ownsSubmit` behave exactly as before (edit mode, etc. untouched).

---

## Add-on / estimate field decisions per flow

- Added two form fields to EVERY create flow's `defaultValues`:
  `estimatedPlayers: 0` and `addons: { aiCommissioner:false, smsNotifications:false, whatIfSimulator:false, customBranding:false }`.
- The LaunchStep collects them: an "Expected number of players" number input and
  four add-on checkboxes.
- `readLaunchFields(values)` (new `create/launchFields.ts`) is spread at the TOP
  LEVEL of every `build*Payload` output, so the create payload carries
  `estimatedPlayers` (a positive int, or OMITTED when blank/0 so the server's
  "no estimate → free" default applies unchanged) and `addons.*` (always the four
  booleans). These are exactly the fields the server reads:
  `functions/src/poolOps.ts` `estimatedPlayersFromPayload` (top-level
  `estimatedPlayers` is its first candidate) and `payloadHasPaidAddon`
  (top-level `data.addons`). This directly closes the gap flagged in
  MORNING-CHECKLIST-BUYFLOW.md §A.2 ("NFL & Squares launch free because their
  payloads carry no player count — the Wave-4 launch step can pass an estimate").
- The create-input schemas (`shared/schemas/*.ts`) are plain `z.object()` (NO
  `.strict()`), so they STRIP the extra `estimatedPlayers`/`addons` keys during
  the `.parse()` gate rather than rejecting them; and the create callables
  persist the original `request.data` (privilege-stripped) and pass it to
  `computeLaunchMode(request.data, …)`. So the fields survive to the server's
  decision. Verified: all payload `safeParse` tests still pass.
- **Squares note**: a 10x10 grid is 100 squares, but "players" ≠ squares (one
  player can own many squares), so I did NOT hardcode 100 as the estimate — it's
  a commissioner input, default 0 (→ free unless they estimate higher or pick a
  paid add-on).

---

## Anonymous / logged-out entry status

The wizard is currently reached only through authenticated routes: `App.tsx`
renders every `Create*Pool` with `user={user}` behind the app's existing auth
gate, and passes `onComplete={(id) => navigate('/pool/' + id)}`. So in the live
app the LaunchStep always has a logged-in user (`uid = user.id`), which is what
it needs for `subscribeToMyBundles` and the create/checkout/redeem callables.

I did NOT add logged-out wizard entry (the plan's "Pool Draft is device-local,
sign-in at launch" vision). That is an upstream routing/auth change outside the
`wizard/**` scope this wave owns, and ripping out the existing auth gate was
explicitly discouraged. **Gap for a later wave**: to support the plan's anon
draft → sign-in-at-launch flow, the wizard route must be reachable logged-out
and the LaunchStep must trigger sign-in before its create actions when `uid` is
absent. LaunchStep already takes `uid` as a prop, so the hook point is clean;
today it assumes a signed-in user.

---

## What needs morning visual UAT (could not be tested here — no auth fixtures)

1. **End-to-end launch, each of the 7 types**: walk the wizard, confirm the
   final step shows the server quote and the right CTA (free vs trial), and that
   "Start trial" creates a pool and lands on `/pool/:id`.
2. **Quote correctness**: set estimatedPlayers above/below `freePlayerThreshold`
   (10) and toggle each add-on; confirm the itemized quote + the free-vs-trial
   CTA flip as the server dictates. (Client shows whatever the server returns.)
3. **Coupon**: enter a valid + an invalid coupon; confirm the quote's couponState
   line reflects it and that the code is carried into `createCheckoutSession`.
4. **Activate now → Stripe redirect**: confirm it creates the pool THEN redirects
   to `sessionUrl`. NOTE (from MORNING-CHECKLIST §B): while `STRIPE_SECRET_KEY` is
   a placeholder, checkout activates for free via the mock path — rotate to a real
   TEST key before money-path UAT or every "purchase" is fake-free.
5. **Redeem**: with a real matching bundle/credit in the account, confirm the
   Redeem button appears and redemption flips the pool active. Requires the
   Wave-5 `bundles` firestore.rules to be live (else the listener is
   permission-denied and the option is hidden by design).
6. **Draft resume**: start a wizard, reload (draft autosave), resume — confirm
   the new `estimatedPlayers`/`addons` fields restore (old drafts lack them; the
   LaunchStep tolerates undefined via `?? 0` / `!!`).

---

## Files changed this wave

New:
- `src/components/wizard/create/LaunchStep.tsx` — the launch step + state machine.
- `src/components/wizard/create/launchFields.ts` — `readLaunchFields()` helper.

Edited:
- `src/components/wizard/types.ts` — `WizardStepDef.ownsSubmit?`.
- `src/components/wizard/WizardShell.tsx` — suppress footer submit on `ownsSubmit` step.
- `src/components/wizard/index.ts` — export `LaunchStep` / `LaunchStepProps`.
- `src/components/wizard/create/Create{Bracket,Squares,Props,Playoff,NFLPickem,NFLSurvivor,NFLMargin}Pool.tsx`
  — steps built in-component via `useMemo`, launch step replaces review, launch
  defaults added, `createXPool` helper extracted.
- `src/components/wizard/create/build{Bracket,Squares,Props,Playoff,NFL}Payload.ts`
  — spread `readLaunchFields(values)` at top level.
- `src/components/wizard/create/build{Bracket,Squares,Props,Playoff,NFL}Payload.test.ts`
  — +2 tests each for the launch fields (present when set / omitted-and-defaulted when blank).

NOT touched (per scope): `dbService.ts`, anything in `functions/`,
`firestore.rules`, `shared/**`, `PricingPage.tsx`, `BillingInvoiceCard.tsx`,
`SuperAdminBillingPanel`, `monetization/**`, `ManagerDashboard`. The legacy
`src/components/PropsWizard/PropsWizard.tsx` was left alone — it is a separate
old wizard still imported only by `PropsPoolDashboard.tsx`; the live unified flow
is `wizard/create/CreatePropsPool`.
