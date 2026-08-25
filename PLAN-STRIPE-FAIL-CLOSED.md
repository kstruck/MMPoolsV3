# PLAN — Stripe fail-closed: no paid state without a real secret

## Status

**TRIAGE VERDICT: CLAIM CONFIRMED (in full).** Built 2026-08-24 on branch
`claude/audit2-s2-stripe-failclosed`.

The external (codex) P0 finding read:

> a missing or placeholder `STRIPE_SECRET_KEY` enables mock paid activation in
> deployed environments

That is exactly what the code does today. Evidence in "The verified hazard"
below, with file:line. This plan is the money-gate (`CLAUDE.md` §4 / the
`mmp-change-control` §1 trigger list: **money**).

## The verified hazard — file:line evidence

### 1. The mock switch has no environment condition

`functions/src/stripe.ts:74-86`:

```ts
function getStripe() {
    if (!stripeInstance) {
        let key = "";
        try {
            key = stripeSecretKey.value();
        } catch (e) {
            console.warn("[Stripe] STRIPE_SECRET_KEY is not defined in this environment.");
        }

        if (!key || key.startsWith("placeholder") || key === "") {
            return null; // Signal mockup bypass mode
        }
        ...
```

The only input is the key's value. Nothing consults `FUNCTIONS_EMULATOR`,
`FIRESTORE_EMULATOR_HOST`, `GCLOUD_PROJECT`, or any other signal that would
distinguish a laptop from production. Verified by search: **no production file
under `functions/src/` references either emulator variable** — the only hits in
the whole tree are in `functions/src/__tests__/emulator/*`.

So `getStripe() === null` means "no usable key", full stop, and in a deployed
function that is a *reachable* state: a `defineSecret` binding whose Secret
Manager version was deleted, never created, or populated with a placeholder
during setup throws or yields a placeholder at `.value()`, and both land in the
`return null` branch.

### 2. Pool checkout grants paid state on that branch

`functions/src/stripe.ts:594-605`:

```ts
    if (!stripe) {
        // Mock dev sandbox: emulate a completed session inline (activate now).
        console.log(`[Stripe Mockup] Missing/placeholder key — mock checkout for pool ${poolId}.`);
        const mockSessionId = `mock_local_dev_session_${Date.now()}`;
        await finalizePoolPayment({
            sessionId: mockSessionId,
            paymentIntentId: `mock_pi_${Date.now()}`,
            amountTotalCents: Math.round(serverPrice * 100),
            metadata,
        });
        return { sessionUrl: `${origin}/pool/${...}?payment=success&session_id=${mockSessionId}` };
    }
```

`finalizePoolPayment` (`functions/src/stripe.ts:829`) is the *same* function the
verified webhook calls. In one transaction it sets `billing.status: "active"`,
stamps `billing.paid` / `billing.featuresUnlocked` / `billing.tier` /
`billing.maxPlayersAllowed`, confirms the coupon reservation
(`usesCount` increment + `makeConfirmedEntry`), and writes the immutable
**Billing Charge ledger row** via `writeBillingChargeTxn`. The caller then gets a
`?payment=success` redirect. No money moved.

Reachable by any pool owner/manager (and, per K17, a claim+doc SUPER_ADMIN) —
i.e. any signed-in user who created a pool.

### 3. Bundle checkout grants entitlements on the same branch

`functions/src/stripe.ts:677-685`:

```ts
    const stripe = getStripe();
    if (!stripe) {
        console.log(`[Stripe Mockup] Mock bundle checkout for ${bundleType}.`);
        const mockSessionId = `mock_bundle_session_${Date.now()}`;
        await grantBundle(userId, bundleType, { stripeSessionId: mockSessionId, amount: serverPrice });
        return { sessionUrl: `${origin}/pricing?payment=success&session_id=${mockSessionId}` };
    }
```

`grantBundle` (`functions/src/stripe.ts:769`) writes the canonical
`bundles/{id}` doc **plus N credit docs** (via `grantEntitlementTxn`,
`functions/src/entitlements.ts`) **plus the ledger row**, all `source: PURCHASE`.
The bundle path has no ownership gate at all — it is per-person, so *any*
signed-in user reaches it. This is the worse of the two: pool activation is
capped at one pool; a Credit Bundle / Unlimited Pass is a durable entitlement
that then activates arbitrarily many pools.

### 4. Secondary defect found during triage — webhook null-deref

`functions/src/stripe.ts:1135-1145`: `handleStripeWebhook` calls `getStripe()`
and then, with no null check, `stripe.webhooks.constructEvent(...)`. On the same
bad-config state that produces the hazard above, the webhook throws a
`TypeError` on a null dereference and Firebase returns a 500 — so Stripe retries
forever against a handler that cannot ever succeed, and the failure is reported
as a crash rather than as a configuration problem. Not a grant hazard; fixed
here because it is the same root cause and the same file.

### What is NOT part of the hazard (checked, rejected)

- **`functions/src/entitlements.ts`** — no mock/bypass path. `grantEntitlementTxn`
  is a pure Firestore writer with no Stripe awareness. Grep for
  `mock|placeholder|bypass|STRIPE` returns only `stripeSessionId` field
  plumbing (lines 66, 122, 150) and one comment about the Admin SDK bypassing
  *rules* (line 10) — unrelated.
- **`functions/src/billing.ts`** — same: zero hits. It is config loading and
  coupon resolution.
- **The $0 / free-activation path** (`functions/src/stripe.ts:407-500`) — this
  path never touches Stripe *even when the key is perfect*, and it is
  independently gated: a $0 activation must present a validated pool credit, a
  free-tier eligibility, or a 100% coupon
  (`stripe.ts:409-413`, "No valid free-activation reason provided"). It grants
  free state for a free reason, not paid state for no money. **Gating it on
  Stripe config would create a new outage mode with no security benefit**, so
  the fix deliberately does not touch it. See "Blast radius".

## The fix

Three new exported, pure, unit-testable primitives in `functions/src/stripe.ts`,
one guard built from them, and the guard applied at four points.

### Primitives

```ts
export function isEmulatedEnvironment(env = process.env): boolean
export function classifyStripeKey(raw): "usable" | "missing" | "placeholder" | "malformed"
export function resolveStripeMode(raw, env): { mode: "live" } | { mode: "mock", verdict } | { mode: "refuse", verdict }
```

- `isEmulatedEnvironment` reads **only** `FUNCTIONS_EMULATOR === "true"` and the
  presence of `FIRESTORE_EMULATOR_HOST`. Both are set by the Firebase emulator
  suite itself and are not present in a deployed function. Deliberately **not**
  a Firestore config field, a request field, or an argument a caller can supply
  — a caller-flippable "dev mode" would just be the same hazard with an extra
  step.
- `classifyStripeKey` widens today's `!key || startsWith("placeholder")` test to
  also reject whitespace-only values, the common placeholder spellings
  (`changeme`, `dummy`, `example`, `todo`, `your-...`), and anything that is not
  a Stripe secret-key shape (`sk_…` / `rk_…`, the only two prefixes Stripe issues
  for secret and restricted API keys). A well-formed but *wrong* key is out of
  scope: Stripe rejects it at session-create and the existing catch releases the
  reservation.
- `resolveStripeMode` is the whole policy in one place: usable ⇒ `live`;
  unusable **and** emulated ⇒ `mock`; unusable **and** deployed ⇒ `refuse`.

### The guard

`assertStripePaymentAllowed()` — resolves the mode, and on `refuse`:

1. `console.error` with the verdict,
2. `dispatchOpsAlert(db, { type: "PAYMENT_FAILED", ... })` — the **existing**
   dispatcher (`functions/src/lib/opsAlertDispatcher.ts:168`), already used five
   times in this file; no second alerting path is invented,
3. throws `HttpsError("failed-precondition", ...)` with copy that says no charge
   was made and nothing was changed.

It is injectable (`{ env, readKey, dispatch }`) so the negative tests exercise
the real decision rather than a re-implementation of it.

### Where it is applied

| # | Site | Why there |
|---|---|---|
| 1 | `createBundleCheckout`, first statement (`stripe.ts:~656`) | Bundle path does zero writes before it. Refusal ⇒ zero mutations, no redirect. |
| 2 | Pool **paid path**, immediately before the reservation `runTransaction` (`stripe.ts:~505`) | This is the first write of the paid path. Everything above it is reads + pure quoting. Refusal ⇒ no coupon reservation, no `billing.pendingSessionId`, no `checkoutSessions` doc, no redirect. |
| 3 + 4 | Inside each `if (!stripe)` mock branch | Defence in depth. After (1) and (2) a deployed environment can never arrive here, but the branch is the thing that grants, so it carries its own refusal. |

Additionally `assertNotMockSessionInDeployedEnv(sessionId, env)` is called at the
top of **`finalizePoolPayment`** and **`grantBundle`** — the two functions that
actually write paid state. A session id with the `mock_` prefix is refused
outright in a deployed environment. This is the backstop invariant the negative
tests assert against: *in a deployed environment, no `mock_` session id can
produce a grant, by any route.*

And `handleStripeWebhook` now checks `getStripe()` for null: it responds
**503** with an ops alert instead of dereferencing null (defect 4 above).

### Ops alert type — a decision for Kevin

The dispatcher's `OpsAlertType` union lives in
`functions/src/lib/opsAlertDispatcher.ts`, which is **outside this stream's file
ownership**, so this change reuses the existing **`PAYMENT_FAILED`** type rather
than adding a `STRIPE_CONFIG_INVALID` one. `PAYMENT_FAILED` is email-only (not
in `HIGH_PRIORITY_TYPES`). A production checkout that cannot take money is
arguably SMS-worthy. **Kevin's call**; a one-line follow-up adds the type and
puts it in the high-priority set.

## Blast radius

| Surface | Effect |
|---|---|
| **Production with a valid key** | **None.** `resolveStripeMode` returns `live` and every guard is a no-op. All four call sites are `await`-ed refusals that do not fire. |
| **Production with a broken/missing key** | Paid pool checkout and bundle checkout now return `failed-precondition` with a user-readable message, write nothing, and page ops. Previously they granted paid state for free. This is the fix. |
| **$0 / free-tier / credit / 100%-coupon activation** | **Unchanged in every environment**, deliberately (see above). |
| **Add-on (mid-season) purchase** | Same as paid pool checkout — it flows through the same paid path and the same guard. |
| **Local emulator (`firebase emulators:start`)** | **Unchanged.** `FUNCTIONS_EMULATOR=true` ⇒ `mock` mode ⇒ the existing mock checkout still runs. |
| **`npm --prefix functions test` (vitest, no emulator vars)** | Counts as *deployed*. Correct: the tests assert the refusal. No existing test invokes the mock branch (verified — no test constructs `createCheckoutSession`). |
| **Stripe webhook** | A webhook arriving with no usable key gets 503 + an ops alert instead of a 500 from a null-deref. Stripe still retries, which is the desired behaviour for a transient config outage. |
| **Firestore rules / data model / scoring** | Untouched. No schema change, no new collection, no rules change, no migration. |

## Rollback

Pure code change, one file plus tests. No data written, no config flag, no
migration to reverse.

1. `git revert` the PR's merge commit on `main`.
2. `git -C D:\march-melee-pools pull --ff-only origin main` (CLAUDE.md §3 step
   zero — a stale checkout deploys nothing and still says "Deploy complete!").
3. `npm --prefix functions ci` then `npx firebase deploy --only functions`.
4. Verify: `npx firebase functions:list | Select-String "createCheckoutSession"`.

Rolling back **restores the hazard**, so the only reason to do it is a false
refusal in production — i.e. the real key is being classified as `malformed`. In
that case the smaller fix is to relax `classifyStripeKey`'s prefix test, not to
revert the guard.

## Tests (`functions/src/__tests__/stripeFailClosed.test.ts`)

Negative tests are the point of the change, so they are enumerated:

1. `classifyStripeKey` — `missing` for undefined/""/whitespace; `placeholder`
   for `placeholder…`, `changeme`, `dummy`, `example`, `todo`, `your-key`;
   `malformed` for a non-`sk_`/`rk_` string; `usable` for `sk_live_…`,
   `sk_test_…`, `rk_live_…`.
2. `isEmulatedEnvironment` — true only for `FUNCTIONS_EMULATOR === "true"` or a
   set `FIRESTORE_EMULATOR_HOST`; false for `{}`, for `FUNCTIONS_EMULATOR:"false"`,
   and — the injection case — for an env carrying attacker-shaped fields
   (`isEmulator: true`, `devMode: "1"`, `NODE_ENV: "development"`).
3. `resolveStripeMode` — the full 2×4 matrix.
4. **`assertStripePaymentAllowed` refuses in a deployed environment** for every
   unusable verdict, throws `failed-precondition`, and dispatches exactly one
   ops alert.
5. **It does not refuse** when the key is usable, and does not refuse under the
   emulator (and dispatches nothing in either case).
6. `assertNotMockSessionInDeployedEnv` — refuses `mock_local_dev_session_*` and
   `mock_bundle_session_*` when deployed; permits them under the emulator;
   permits `cs_test_…` / `cs_live_…` always.
7. **Source invariants** (the same technique as
   `__tests__/checkoutOwnership.test.ts`) proving the guard is positioned where
   it must be and cannot be bypassed:
   - the pool paid path calls `assertStripePaymentAllowed` **before** the
     paid-path `db.runTransaction`;
   - `createBundleCheckout` calls it **before** `grantBundle`;
   - every `if (!stripe)` branch in the file is preceded by a call to it;
   - `finalizePoolPayment` and `grantBundle` each call
     `assertNotMockSessionInDeployedEnv` before any write;
   - `handleStripeWebhook` null-checks `getStripe()` before
     `webhooks.constructEvent`.

Standing rule (Kevin, 2026-08-17): the feature ships with its test in the same
PR. It does.
