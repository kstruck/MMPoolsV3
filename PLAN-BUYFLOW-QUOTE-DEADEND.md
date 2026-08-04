# PLAN-BUYFLOW-QUOTE-DEADEND

**Status:** proposed 2026-08-04 (overnight session), implemented on
`claude/buyflow-quote-deadend`.
**Gate:** plan-gated. `mmp-change-control` §1 — **money** trigger ("quote/coupon
engines, anything that decides what a user is charged"). Client-side only: no
`functions/`, no `firestore.rules`, no `firestore.indexes.json`.
**Deploy owed:** Coolify frontend rebuild (Kevin's click). Nothing else.

---

## Why this document exists

The commissioner checkout card prices **every pool at $0** and then disables the
only button that could act on it. Both halves were observed on production on
2026-08-04, on Kevin's own `BUYFLOW TEST` pool (`NFL_PICKEM`, 25 players — a
tier the client's own fallback table prices at $29, though the server price for
it is **unknown here because the server was never successfully reached**):

* `Base Hosting fee (25 estimated players)` → **FREE**
* `UPGRADE PREMIUM TOTAL` → **FREE**
* Button label `ACTIVATE POOL (FREE ALLOCATION)`, rendered in full-brightness
  brand red with `cursor: default`, and `button.disabled === true`
  (read from the live DOM).

So the buy flow has no reachable exit: a paid pool never shows a price, and the
$0 button the wrong price produces cannot be clicked. That is the entire
monetization path, two days before the Hall of Fame game.

The two symptoms are **one root cause plus one pre-existing clause**, and they
have to be fixed together — see "Why these ship as one change" below.

---

## Root cause — `getPoolQuote` sends `couponCode: null` and the server rejects it

`src/services/dbService.ts:1678` passes its params object straight to the
callable:

```ts
const fn = httpsCallable<PoolQuoteInput, PoolQuote>(functions, 'getPoolQuote');
const result = await fn(params);
```

Both call sites always set the key, using `undefined` to mean "no coupon":

* `src/components/billing/BillingInvoiceCard.tsx:250`
* `src/components/wizard/create/LaunchStep.tsx:114`

```ts
couponCode: couponInput.trim() ? couponInput.trim().toUpperCase() : undefined,
```

The Firebase callable serializer encodes a **present key with an `undefined`
value as `null`** on the wire (`firebase/functions` `Serializer.encode`:
`if (data == null) return null`, reached through a `for (const key in data)`
walk that does not skip undefined values). The server schema is
`shared/schemas/quote.ts:54` — `couponCode: z.string().trim().min(1).optional()`
— and `.optional()` accepts *absent*, not *null*. Every quote request made
without a coupon therefore fails validation.

**This is not inferred. The exact error is in production**, on the SuperAdmin
Overview → Production Watchdog card, 50 occurrences in the last 24h:

```
medium: Invalid request: couponCode — Invalid input: expected string, received null
```

`medium` identifies the caller: `getPoolQuote` logs at `ErrorSeverity.MEDIUM`
(`dbService.ts:1685`); `createCheckoutSession` logs at `HIGH`
(`dbService.ts:1720`).

**The repo already knew about this serializer behaviour and fixed it in exactly
one place.** `dbService.ts:1709-1715`, on `createCheckoutSession`:

```ts
// The Firebase callable serializer encodes `undefined` fields as `null`
// on the wire, which fails the server's `.optional()` string schemas
// (e.g. couponCode). Strip undefined/null keys so optional fields are
// genuinely omitted.
```

`getPoolQuote` — added in the same buy-flow overhaul, sharing the same
`couponCode` field and the same optional-string schema — never got the strip.

### Why a total failure looked like a free pool

`BillingInvoiceCard` derives every displayed figure from the quote with `?? 0`:

```ts
const basePrice = quote?.basePrice ?? 0;                       // :294
const subtotal  = Math.max(0, (quote?.subtotal ?? 0) - pricePaid);  // :304
```

and its catch block deliberately says nothing unless a coupon was typed:

```ts
// Leave the last good quote in place; only surface coupon errors.
if (couponInput.trim()) { setCouponError(...) }                // :278-281
```

With no coupon there is never a last good quote, so `quote` stays `null`,
`basePrice`/`subtotal`/`total` are all `0`, and the card renders **FREE** with
no error anywhere. "Price unknown" and "price is zero" are the same state in
this component, and that is the defect class — the same "an absent error read as
a pass" shape recorded three times already in HANDOFF (#314's unbound
`COURIER_AUTH_TOKEN`, the zero-counter reminder heartbeat, `sendManualReminder`
returning `sent: 0` as success).

## Second defect — the free-allocation button is disabled by construction

`BillingInvoiceCard.tsx:746-751`:

```ts
disabled={
    isCheckoutLoading ||
    !poolId ||
    (total <= 0 && (!appliedCoupon || subtotal === 0) && !useCredit && !hasUnlimitedPass) ||
    (basePrice === 0 && subtotal === 0 && !useCredit && !hasUnlimitedPass && activeFreePoolsCount > 0)
}
```

The card's own design has two $0 outcomes, and the labels prove the intent
(`:768-771`):

| State | Intended label | Intended affordance |
|---|---|---|
| server priced $0, commissioner already has an active free pool | `Free Limit Reached (Upgrade Needed)` | greyed, disabled |
| server priced $0, no other active free pool | `Activate Pool (Free Allocation)` | **live, clickable** |

The second row is unreachable. `total <= 0` is true, `appliedCoupon` is null so
`(!appliedCoupon || …)` is true, `useCredit` and `hasUnlimitedPass` are false —
the third clause fires and disables the button. Meanwhile the *styling* ternary
(`:753`) keys only on the fourth clause, so the button renders live red with a
normal cursor: it looks clickable and is not.

The server side of that path is implemented and reachable —
`handleCheckout` → `createCheckoutSession`, the loading label is
`Activating pool...` for `total === 0` (`:761`), and the server returns a
success URL for a $0 session. Only the client blocks it.

## Why these ship as one change

Fixing the button clause **alone would be dangerous**. Today `basePrice === 0 &&
subtotal === 0` is produced by the broken quote on *every* pool, so enabling the
$0 path without fixing the quote would let a commissioner activate a **paid**
pool for nothing, in one click, on every pool in the system.

Fixing the quote alone leaves the genuinely-free allocation still dead-ended.

So the ordering is: make the price honest, add an explicit "we do not have a
price" state so a failure can never again masquerade as free, and only then open
the $0 path.

---

## The change

Three edits, all under `src/`.

**1. `src/services/dbService.ts` — one definition of the strip.**
Extract the inline object filter into `stripEmptyCallableFields()` and call it
from both `getPoolQuote` and `createCheckoutSession`. A second inline copy is
the class of bug this repo keeps hitting (#315, #319, the Buy-In Ledger); the
existing comment stays with the helper so the reason travels with it.

**2. `src/components/billing/checkoutButtonState.ts` — new pure module.**
The disabled/label/style decision moves out of JSX into a pure function so it
can be asserted directly instead of through a source-offset invariant. Inputs
are the numbers already computed in the component; output is
`{ disabled, label, muted }`.

The rule it encodes:

```
priceUnknown      = no quote has ever loaded
freeLimitReached  = priced $0, no credit/pass, and an active free pool exists
freeAllocation    = priced $0, no credit/pass, and NO active free pool exists
```

* `priceUnknown` → disabled, muted, label `Pricing Unavailable — Retry`
* `freeLimitReached` → disabled, muted, label `Free Limit Reached (Upgrade Needed)`
* `freeAllocation` → **enabled**, label `Activate Pool (Free Allocation)`
* otherwise the pre-existing $0 guard still applies unchanged

**3. `src/components/billing/BillingInvoiceCard.tsx` — call it.**
Replace the inline `disabled=` expression, the styling ternary and the label
ladder with the helper's output. Behaviour for every state other than
`priceUnknown` and `freeAllocation` is unchanged.

### What is deliberately NOT changed

* `functions/` — untouched. The server already prices $0 correctly and already
  returns a success URL for it. No functions deploy is owed.
* `shared/schemas/quote.ts` — **not** relaxed to `.nullable()`. Making the
  server accept `null` would fix the symptom and leave the client shipping a
  wire shape the schema does not describe; the strip is the correct side.
* The `pricePaid` display credit, coupon handling, add-on toggles, bundles.
* Anything about `enforceBillingStatus` or `billing.status` transitions — that
  is `PLAN-BILLING-ENFORCEMENT.md`.

---

## Sweep — every client callable payload that sets a key to `undefined`

Deterministic list, built from
`grep -rn ": undefined" src/ --include=*.ts --include=*.tsx` filtered to
payloads handed to a Firebase callable. **Complete at 4 instances, 2 callables.**

| # | Site | Callable | Strips today? | Verdict |
|---|---|---|---|---|
| 1 | `BillingInvoiceCard.tsx:250` | `getPoolQuote` | ❌ no | **BROKEN — fixed here** |
| 2 | `LaunchStep.tsx:114` | `getPoolQuote` | ❌ no | **BROKEN — fixed here** |
| 3 | `BillingInvoiceCard.tsx:399,401` | `createCheckoutSession` | ✅ yes | safe, unchanged |
| 4 | `LaunchStep.tsx:235` | `createCheckoutSession` | ✅ yes | safe, unchanged |

Both broken instances are fixed by the single `dbService.getPoolQuote` edit;
neither call site needs to change.

**Out of scope, and stated so it is not mistaken for covered:**
`PropsWizard.tsx:164` sets `billing.couponCode` to `undefined` inside a
**Firestore document write** (`createPool`), not a callable payload. That is a
different mechanism (the Admin SDK / Web SDK reject or drop `undefined` fields
rather than coercing them to `null`) and it is not evidenced by any production
error. Not touched.

**Not swept:** the other 25 `dbService` callables with optional payload fields.
A heuristic pass over them produced false positives (fields that are never
actually `undefined`) and false negatives (`getPoolQuote` itself, whose optional
field is declared in `PoolQuoteInput` rather than inline), so it is not a
trustworthy instance list and is deliberately not presented as one. The
narrower `: undefined` sweep above is the one that is complete. A general
lint-level guard is a follow-up, not this change.

---

## Guard tests

`src/components/billing/checkoutButtonState.test.ts` — pure, no jsdom, no
Firestore mock, matching the `billingGate.test.tsx` convention of testing
without a DOM.

The assertion Kevin asked for, stated directly:

> a $0 / no-coupon / no-credit pool with a LOADED quote yields an **enabled**
> button labelled `Activate Pool (Free Allocation)`

plus, in the same file:

* the same inputs with `priceUnknown: true` yield **disabled** — this is the
  assertion that makes the fix safe rather than merely permissive, and it fails
  if someone later drops the `priceUnknown` guard
* `activeFreePoolsCount > 0` still yields disabled + `Free Limit Reached`
* a priced pool ($29) yields enabled + `Upgrade Pool to Premium`
* a 100% coupon on a priced pool stays enabled (unchanged behaviour)
* `useCredit` and `hasUnlimitedPass` each keep the button enabled at $0
* no `poolId` yields disabled + `Select a Pool Above to Pay`

`src/__tests__/callableParams.test.ts` — the strip helper drops `undefined` and
`null`, keeps `0`, `''` and `false` (dropping falsy-but-meaningful values would
be a new bug), and `tests/` invariants assert `getPoolQuote` routes through it,
so the strip cannot be quietly removed from one callable again.

---

## Rollback

| Step | Command / action | Effect |
|---|---|---|
| Revert the code | `git revert <merge sha>` on `main` | back to the broken-but-known state |
| Undo in production | Coolify → Redeploy | previous bundle serves again |

There is no data migration and no server change, so rollback is a rebuild and
nothing else. No pool's `billing` document is written by this change.

---

## Residual risk

**A commissioner with a free allocation can now activate a $0 pool in one
click.** That is the intended behaviour of the button that has been dead, and
it is gated by the server, which prices the pool and decides whether the
allocation is available — the client only stops presenting a disabled control
for a path the server already allows. The new `priceUnknown` guard means a
quote failure can no longer be mistaken for that state.

**Unverified until the rebuild:** every claim above about the *fixed* behaviour
is from unit tests and source, not from production. The production evidence
covers the **broken** state only. The first thing to check after Kevin's Coolify
rebuild is that `BUYFLOW TEST` shows a real price instead of FREE.
