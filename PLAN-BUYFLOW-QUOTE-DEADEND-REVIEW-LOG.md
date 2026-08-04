# PLAN-BUYFLOW-QUOTE-DEADEND — review log

Adversarial review rounds for `PLAN-BUYFLOW-QUOTE-DEADEND.md`, per
`mmp-change-control` Rule 3. Findings are quoted, then accepted or rejected with
evidence. A rejection is a legitimate outcome and is written down with reasoning.

Reviewers: `codex exec review --base origin/main` (CLAUDE.md §2c), qodo on the
PR (§2b), and a self-read of the diff.

---

## codex round 1 — 2 findings, both [P1], both ABSORBED (one with a correction)

### 1/1 [P1] "Invalidate the quote when pricing inputs change" — ABSORBED, valid

> `quote` is retained across input changes and after failed requests, so this
> only detects that no quote has ever loaded, not that the displayed quote
> matches the current selections. For example, after a valid $0 quote,
> increasing the participant estimate or enabling an add-on and then having the
> debounced quote request fail leaves `priceUnknown` false and enables a button
> labeled as free; checkout submits the new payload and can redirect to a paid
> Stripe session.

**Verified and correct.** `priceUnknown = !quote` answers "has a quote ever
loaded", which is a strictly weaker question than "does a quote describe what is
on screen". The scenario reaches the same class of harm the fix exists to
prevent — a $0 label over a payload the server will price above zero — so the
first version of the guard was named after the property it did not have.

**Fix.** The card now stamps every quote with a `quoteKey` — a JSON identity of
`{poolType, estimatedPlayers, addons, couponCode}` — and derives a three-way
`priceState`:

| `priceState` | meaning | button |
|---|---|---|
| `ready` | `quoteFor === quoteKey` | proceeds to the normal rules |
| `pending` | debouncing or in flight for these inputs | disabled, `Updating Pricing…` |
| `unavailable` | the request for these inputs failed | disabled, `Pricing Unavailable — Retry` |

`pending` and `unavailable` are kept distinct deliberately: collapsing them
would report a transient 300 ms debounce as an error, and an error that appears
routinely gets ignored — the same "an alarm that cries wolf gets muted" argument
`findStaleJobs` is built on.

The itemized figures still show the last loaded quote during `pending` so the
card does not flash empty on every slider tick; only `unavailable` (or no quote
at all) swaps them for `—` and raises the notice. Checkout is blocked in both
non-`ready` states, which is the part that matters.

Guarded by three new cases in `checkoutButtonState.test.ts` (`pending` and
`unavailable` each disable, and both beat a credit / unlimited pass) plus a
wiring invariant in `tests/buyflow-quote-invariants.test.ts`.

### 1/2 [P1] "Do not enable free activation for trial-tier pools" — ABSORBED WITH A CORRECTION

> This identifies any fresh quote with zero base price and subtotal as a free
> allocation, but the direct-payment page selects trial pools and lets the user
> lower the estimate to 1, producing exactly that quote. `createCheckoutSession`
> then rejects the same request because its $0 path requires the stored pool
> snapshot to be `free_tier` (or a credit/full coupon), while these selected
> pools are `standard_tier`; users therefore see an enabled "Activate Pool"
> button that always fails.

**The stated mechanism is wrong, and the conclusion that follows from it does
not hold.** `snapshot.tier` is **not** the stored pool's tier. It is
`quote.tier` from the server's own `computeQuote` call on the SUBMITTED
`estimatedPlayers` (`functions/src/stripe.ts:212-215`), and the free path checks
that value (`:264`). The stored `poolData` is read only for existence and for
the transaction's idempotency check. So a trial pool quoted at ≤ the free
threshold produces `tier: 'free_tier'` and the server **accepts** it; the button
would not "always fail".

**But the underlying objection is right and is absorbed.** The client was
inferring the server's verdict from zeroes (`basePrice === 0 && subtotal === 0`)
instead of reading the verdict the server already ships. Those can disagree:
`subtotal` in this component is `quote.subtotal - pricePaid`, and `pricePaid` is
a client-side display credit the server knows nothing about — so a partly-paid
$29 pool could present as free-tier to the button while the server priced it
above zero.

**Fix.** The button now takes `freeTierEligible` straight from `PoolQuote`
(`shared/schemas/quote.ts:97-99`: "players ≤ freePlayerThreshold AND total is
$0"), which is the identical condition `computeQuote` uses to stamp
`tier: 'free_tier'` (`quoteEngine.ts:167,172`) — the exact field the server's $0
path gates on. A button enabled on that flag is a request the server will
accept, by construction rather than by coincidence.

Guarded by `free-tier eligibility comes from the server flag, not from zero
totals`, which pins the previously-conflated case: zeroes produced by
`pricePaid` must NOT read as a free allocation.

**Also fixed while here (self-review, not a codex finding).** The "Active Free
Pool Limit Reached" warning card re-derived the same condition inline, so it
could disagree with the button it sits above. Both now read one
`buttonState.kind` discriminant. The discriminant is a union member rather than
a label-string match, because matching on copy works today and breaks silently
the first time the wording changes.

---

## codex round 2 — 1 finding, [P1], ABSORBED

### 2/1 [P1] "Provide an actual retry path for unavailable pricing" — ABSORBED, valid

> When a quote request fails, this state permanently disables checkout, but no
> action re-runs `getPoolQuote`; the button is disabled and its "Retry" label is
> not interactive. […] pricing remains unavailable even once the service has
> recovered unless the user changes a priced input or reloads the page, leaving
> the purchase flow dead-ended.

**Verified and correct, and it is the same defect class as the original bug** —
a control whose text promises an action it cannot perform. Round 1's fix
introduced it while closing round 1's finding, which is the pattern CLAUDE.md
§2c predicts (rounds 2+ find defects in the fixes).

Two things were wrong: the fetch effect's dependency list contains only priced
inputs, so nothing re-runs it for the same inputs; and the disabled button's
label read `Pricing Unavailable — Retry`.

**Fix.** A `quoteRetry` nonce is added to the effect's dependencies and bumped
by a real, enabled **Try Again** control inside the red notice card, which also
clears `quoteFailedFor` so the state returns to `pending` while the retry is in
flight. The checkout button's label drops the word "Retry" — it is disabled in
that state, and the retry belongs on a control that is not.

Guarded by `the disabled price-failure label does NOT promise a retry it cannot
perform` (asserts the label contains neither "retry" nor "try again" while
disabled) and a wiring invariant that pins `quoteRetry` as an actual dependency
of the fetch effect — without that, the handler could exist and change nothing.

## codex round 3 — 2 findings, both ABSORBED

### 3/1 [P1] "Keep checkout blocked while a retry is in flight" — ABSORBED, with a note on the scenario

> Clearing `quoteFailedFor` immediately can restore `priceState` to `ready` from
> an old `quoteFor` value before the retry returns. This occurs when a user has
> previously loaded inputs A, switches away and back to A, the refresh fails,
> and presses Try Again […]

**The named scenario cannot occur as written**, and saying so matters because the
fix would otherwise look like it closes something it does not. In that trace
`quoteFor === 'A'` and the current key is `A`, so `priceState` is already
`ready`; the notice card — and with it the Try Again control — never renders, so
there is nothing to press.

**The hole it points at is real, one step earlier.** With `quoteFor === A` and a
failed refresh for A, `priceState` stayed `ready` on the strength of a quote we
had just failed to re-confirm. That is a confident render backed by stale data,
which is the property this change exists to remove.

**Fix, both directions.** A failed fetch now un-stamps a quote taken for the same
inputs — `setQuoteFor(prev => prev === key ? null : prev)` — so the state becomes
`unavailable` and the retry control appears. And `retryQuote` clears `quoteFor`
as well as `quoteFailedFor`, so the window during the retry is `pending` rather
than `ready`. Guarded by two invariants.

### 3/2 [P2] "Wait for the free-pool-limit query before enabling activation" — ABSORBED, valid

> `activeFreePoolsCount` starts at `0` and is only updated asynchronously by the
> Firestore listener. Consequently, an owner who already has an active free pool
> can receive a free quote and click the newly enabled activation button before
> that listener's first snapshot; the server then rejects the checkout.

**Verified and correct.** `useState(0)` conflated "no free pools" with "we have
not asked yet", which is the identical unknown-vs-zero conflation as the quote
itself. The window is small but the failure is a rejected checkout on the money
path, and the newly-enabled button is what makes it reachable.

**Fix.** The count is `number | null`, `null` until the listener answers, and a
free-tier quote with a `null` count yields a disabled `Checking Eligibility…`.
Two guards: the `null` case disables the FREE path, and — the one that matters
for not trading one dead end for another — a `null` count does **not** disable a
paid upgrade, which never consults the limit.

**One case deliberately left as `0`:** signed-out. That branch sets the count to
0 because a signed-out visitor genuinely owns no active pools; checkout requires
auth server-side regardless, and `Checking Eligibility…` would be the wrong copy
for it. Pre-existing behaviour, unchanged.

## qodo — pending (PR not yet opened)

## self-review — pending
