# REVIEW LOG — PLAN-STRIPE-FAIL-CLOSED

Cross-model review per `CLAUDE.md` §2c. `codex exec review --base origin/main`,
run from `D:\mmp-wt\s2-stripe-failclosed` on branch
`claude/audit2-s2-stripe-failclosed`. qodo is **DORMANT** (§2b), so the stopping
rule is two conditions: a clean codex round **and** my own read of the diff
agreeing.

`git fetch origin` was run before every round (§2c: `--base main` is stale in a
worktree).

## Rounds

| Round | Base | Findings | Outcome |
|---|---|---|---|
| 1 | `origin/main` @ `da8a5f0a` | 1 × P2 | **Absorbed** — commit `3172b8d0` |
| 2 | `origin/main` @ `da8a5f0a` | 0 | Clean |
| 3 | `origin/main` @ `da8a5f0a` | 0 | Clean (after the self-review fix in `d3f99647`) |

Three rounds against a cap of 10. The change is one file plus its tests, and two
consecutive clean rounds plus a self-review that found a real defect is the bar
§2c asks for — the cap is a ceiling, not a target.

## Per-finding verdicts

### r1 [P2] — "Throttle invalid-config ops alerts" — **VALID, ABSORBED**

> When `STRIPE_SECRET_KEY` is unusable, every authenticated checkout invocation
> reaches this dispatch, and App Check is only monitored rather than enforced.
> Since the dispatcher sends one mail document per configured recipient and has
> no deduplication, normal client retries or an automated caller can flood the
> ops inbox throughout a configuration outage; persist a
> cooldown/deduplication marker before paging.

Verified against the code before acting on it, as §2c requires:

- `functions/src/lib/opsAlertDispatcher.ts:187-189` — `dispatchOpsAlert` maps
  over `cfg.emailRecipients` and sends one message per recipient per call. It
  has no dedupe of its own; the *callers* that dedupe do it with per-event doc
  ids (`monetization_alerts/WEBHOOK_FAILED_${event.id}`) or an attempt-count
  threshold (`shouldAlertOnFailure`). My new call site had neither.
- `functions/src/stripe.ts:412` — `appCheck: "monitor"`, so App Check does not
  block callers. The finding's premise holds.

The finding is right, and it is the failure mode that matters most here: the
alert exists to get a broken payment config fixed, and an inbox with 400 copies
of it is worse at that than one copy.

**Fix** (`3172b8d0`): `makeAlertThrottle(30 min)` in-process, plus a persisted
`monetization_alerts/STRIPE_CONFIG_INVALID` claim taken in a transaction so a
cold-start stampede across instances also pages once. The marker counts
suppressed refusals (`refusalCount`) so the outage stays visible. Applied to the
webhook's 503 path too, which Stripe retries on its own schedule.

**What the fix must NOT do, and is tested for:** throttle the *refusal*. The
guard's entire purpose is to refuse, so the paging is wrapped in
`try/catch` and the `throw` sits outside it — a dispatcher failure, a Firestore
failure, or a suppressed page all still refuse. Test: 25 refusals inside one
window → 25 × `failed-precondition`, 1 × dispatch.

## Self-review (the second stopping condition)

Round 2 came back clean. Reading the diff myself afterwards found a **real
defect codex did not report**: two `it` blocks using the `gate` helper had
ended up inside the throttling `describe` added for r1, where `gate` is out of
scope. They threw `ReferenceError` instead of asserting — a test that looks like
it guards and does not, which is exactly the class §2c warns about. Fixed in
`d3f99647`; round 3 then re-reviewed the corrected diff.

Other things checked by hand and found sound:

- The `$0` path is deliberately ungated and still carries its own
  free-activation validation — gating it would be a new outage mode with no
  security benefit.
- The paid-path gate sits above the reservation transaction, so a refusal leaves
  no coupon reservation, no `billing.pendingSessionId`, no `checkoutSessions`
  doc, and returns no redirect URL.
- `classifyStripeKey` narrowing to `sk_`/`rk_` is the one behaviour change that
  could produce a *false* refusal in production. Accepted: those are the only
  two prefixes Stripe issues for secret/restricted API keys, the refusal is
  loud and paged, and the rollback note says to relax the prefix test rather
  than revert the guard.

## Findings carried into the PR

None. Nothing is left open.

## Decision for Kevin (also stated in the PR body and in chat)

The alert uses the existing **`PAYMENT_FAILED`** type because
`functions/src/lib/opsAlertDispatcher.ts` is outside this stream's file
ownership. `PAYMENT_FAILED` is email-only. A production checkout that cannot
take money may deserve SMS — that needs a new `STRIPE_CONFIG_INVALID` type added
to `OpsAlertType` and to `HIGH_PRIORITY_TYPES`, which is a one-line follow-up in
that file.
