# Plan Review Log: Cascading Failure Prevention

Act 1 evidence collection complete. `PLAN_FILE=PLAN-CASCADING-FAILURE-PREVENTION.md`. MAX_ROUNDS=10 (CLAUDE.md §2c). This log is intentionally not marked approved: the required owner sign-off has not yet occurred.

## Round 1 — Author self-review (2026-08-25)

VERDICT: REVISE. Four findings accepted:

1. (Critical) A circuit breaker that returns cached data for Stripe would violate the money boundary. The plan now separates payment fail-closed behavior from read-path cached degradation.
2. (High) “Every external dependency” includes browser-direct ESPN calls, which would bypass a server-only breaker. The sweep now enumerates all five browser ESPN sites and the plan requires their migration.
3. (High) The codebase has no shared app-owned HTTP pool to partition; claiming one exists would be false. The plan now records the actual global-fetch/SDK transport state and specifies named client plus semaphore bulkheads.
4. (High) Independent timeouts do not implement a total request ceiling. The plan now requires a single `RequestBudget` at the orchestration boundary and explicitly covers sequential and parallel fan-out.

### Author response

Accepted all four. The plan and sweep were revised before this log was written. No implementation began.

## Resolution — PENDING KEVIN SIGN-OFF

One review round, four findings accepted, no open technical findings in the draft. Implementation remains blocked by the plan-gated approval requirement. Requested decisions are: approve a process-local first-release breaker and approve the dependency-specific fallback policy stated in the plan.

## Revalidation — 2026-09-01

VERDICT: CURRENT WITH TWO DOCUMENTATION CORRECTIONS. Since the original sweep, the merged Stripe fail-closed change strengthened the planned payment fallback rather than changing it. The merged global v2 `maxInstances: 10` cap and the explicit 270s/540s NFL scheduler ceilings are now reflected in the plan. A fresh outbound-call scan found the same direct-fetch, Stripe, Gemini, Courier, email-queue, and Firebase boundaries; no new vendor or app-owned connection pool appeared.

## Revalidation — 2026-09-03 (pre-commit review by Claude; Kevin's ruling)

VERDICT: COMMITTED AS DRAFT, NO CODEX ROUNDS RUN. Kevin's decision 2026-09-03: commit the plan set as a draft now; run the §2c codex rounds when implementation is scheduled. Three corrections applied before commit:

1. (Low) Three sweep line refs had drifted: `stripe.ts:298` → `:300`, `stripe.ts:1380` → `:1391`, `scoreUpdates.ts:106` → `:107`. All 27 other refs were re-verified line by line.
2. (High) `docs/stripe-webhook-security.md` (dated 2026-08-25) described a route token (`STRIPE_WEBHOOK_PATH_TOKEN`), a source-IP allowlist (`STRIPE_WEBHOOK_ALLOWED_IPS`), `404`/`403` responses, and tests for a stale timestamp and an outside IP as if deployed. None of it exists: zero hits in `functions/src`, no commit on any branch, and `stripeFailClosed.test.ts` tests key classification and the mock gate only. The doc was withdrawn and its content folded into the plan as Phase 5, marked PROPOSED.
3. (Medium) Round 1 above is an author self-review, not a codex round. It stays logged as written; it does not count toward §2c.

Plan-gate classification confirmed: Money — the plan changes what `stripe.ts` checkout and the webhook do under dependency failure. Scoring is borderline (ESPN feed policy changes what the engines read) and does not need to be settled because Money alone fires the gate.
