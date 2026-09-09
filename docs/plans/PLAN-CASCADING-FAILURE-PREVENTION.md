# Plan: Cascading Failure Prevention
_DRAFT — awaiting Kevin sign-off. Compiled 2026-08-25 from a complete code sweep of outbound network calls, webhook boundaries, and Cloud Functions orchestration. Terms per CONTEXT.md._

## Implementation status (revalidated 2026-09-01; committed as DRAFT 2026-09-03)
**PENDING — no runtime behavior has changed.** This is plan-gated because it changes Stripe money paths and NFL scoring/data-ingest paths. Implement only after the review log is clean and Kevin approves this plan.

> 2026-09-03: committed as a DRAFT by Kevin's decision. No codex rounds have run (see review log); §2c rounds are owed before sign-off, when implementation is scheduled. Phase 5 below was added the same day as PROPOSED.

> Revalidation: the dependency inventory is unchanged. `functions/src/lib/globalOptions.ts` now caps every v2 function at ten instances, and `syncNFLScoresJob` / `nflDeepScoreSweepJob` now declare 270s / 540s platform ceilings. These are useful outer bulkheads, but neither creates per-dependency isolation nor a shared request budget.

## Goal
Prevent a slow or failing external dependency from consuming all request capacity, exceeding a request's total latency ceiling, or causing unrelated user paths to become unavailable. Every app-controlled outbound dependency will have a bounded, observable execution policy: circuit breaker, isolated concurrency/connection capacity, per-attempt deadline, and an explicit caller fallback.

## Dependency boundary

| Dependency / boundary | Current code surfaces | Required fallback |
|---|---|---|
| ESPN Site/Core APIs | `espnBracket.ts`, `nflSchedule.ts`, `scoreUpdates.ts`, `playoffPools.ts`, `expertPicks.ts`, `winProbability.ts`, `adminHealth.ts`; browser schedule/score readers | Use last stored game/slate/feed snapshot; never write an empty feed over good data. UI says “Live data temporarily unavailable; showing last update.” |
| Stripe API + inbound Stripe webhook | `stripe.ts` checkout creation and `handleStripeWebhook` | Checkout: fail closed with retryable “Payments are temporarily unavailable; no charge was created.” Webhook: return retryable 503 after signature verification cannot proceed; preserve idempotent event state. Never fabricate a paid state. |
| Gemini Generative Language API | `gemini.ts`, callers in AI Commissioner/test tooling | Skip model discovery when open; return a typed provider-unavailable error so the UI preserves the member’s prompt and offers retry. Existing non-AI pool behavior remains available. |
| Courier SMS API (member and ops paths) | `notifications/smsService.ts`, `lib/opsAlertDispatcher.ts` | Return `failed`/`queued` without breaking the primary job; record delivery outcome. Do not retry synchronously after the breaker opens. |
| Trigger Email extension | all `sendEmail()` calls and direct `mail` writes | This is an asynchronous Firestore queue, not a caller-controlled HTTP session. Keep enqueueing durable mail records; report queue-write failure distinctly. Delivery latency/outage is monitored separately and must not block business mutations. |
| Firebase Auth / Firestore / Functions | client SDK plus Admin SDK throughout `functions/src/` | Not a replaceable third-party edge call: Firestore is the system of record and has no meaningful cached-write fallback. Protect it with Cloud Functions per-handler concurrency and request budgets; return a retryable service-unavailable response on datastore deadline exhaustion. |
| Same-origin join-preview fetch | `joinPreview.ts` | Remove the network self-dependency: render from local template/data only. Until removed, cap it and return a minimal, valid social preview. |

## Approach

### Phase 0 — Resilience primitives and observability (High, small)

0.1 **Add one server-only dependency policy module.** Define named policies (`espn`, `stripe`, `gemini`, `courierMember`, `courierOps`, `selfPreview`, `firestore`) with: five counted failures inside a rolling 30-second window; `closed`, `open`, and single-probe `half-open` states; a 15-second recovery-probe interval; counters/log fields `dependency`, `state`, `fallback`, `elapsedMs`, and `remainingBudgetMs`.

0.2 **Count only dependency faults.** Count timeouts, network errors, 429s, and 5xx responses. Do not count caller cancellation, malformed input, Stripe signature rejection, expected 4xx validation/auth errors, or an intentionally disabled Courier/Gemini configuration.

0.3 **Make circuit scope explicit.** The breaker is process-local by design: it protects a Cloud Functions instance immediately without adding a new dependency to the failure path. Metrics/structured logs aggregate state across instances. A distributed breaker requires a dedicated resilient store and is out of scope for this change.

### Phase 1 — Connection and concurrency bulkheads (High, medium)

1.1 **Replace implicit shared outbound fetch capacity.** The current code has no app-owned HTTP agents or per-vendor concurrency limits; Node’s global `fetch` dispatcher is therefore shared. Introduce an explicitly owned client/dispatcher per outbound vendor with finite limits: ESPN 12 connections / 8 concurrent requests, Courier member 4 / 4, Courier ops 2 / 2, Gemini 4 / 2, self-preview 2 / 2. Stripe uses a separate keep-alive HTTPS agent capped at 4 sockets and checkout concurrency capped at 4.

1.2 **Use a semaphore at every policy boundary.** Queueing for a dependency consumes the caller’s remaining request budget. If no permit can be obtained before that deadline, take the dependency fallback; do not create unbounded promise queues.

1.3 **Isolate Functions capacity by handler.** Preserve the existing global ten-instance v2 ceiling (`functions/src/lib/globalOptions.ts`) and add explicit per-handler `concurrency` or narrower `maxInstances` overrides only after measuring throughput. In particular, Stripe checkout/webhook traffic must not share a handler concurrency budget with ESPN scoring/imports or Gemini. Firebase Admin SDK Firestore channels remain managed by the SDK; they are not safely partitionable at each call site, so per-function concurrency is its bulkhead.

### Phase 2 — Request-level timeout budgets (Critical, medium)

2.1 **Create a `RequestBudget`.** It starts once at each HTTP/callable/scheduled orchestration boundary, defaults to 5,000 ms for interactive request paths, and exposes `remainingMs()`, `signal()`, and `child(capMs)`. A child deadline is `min(capMs, remainingMs)`; exhausted budgets fail before starting downstream work.

2.2 **Enforce the budget at all outbound policy wrappers.** Every fetch/SDK operation receives a deadline/abort signal derived from the same budget. A sequence in which ESPN spends 3 seconds gives the next dependency at most 2 seconds; it never receives a fresh independent 5 seconds. Parallel fan-out shares the parent deadline, not multiplied deadlines.

2.3 **Keep scheduled jobs distinct.** Scheduled jobs retain their configured Cloud Functions ceiling, but each item/slate gets an explicit child budget. A hung slate is recorded and skipped so it cannot consume the whole run or starve other slates.

### Phase 3 — Migrate complete dependency inventory (Critical, medium)

3.1 **ESPN.** Route all server fetches through the `espn` policy; replace direct browser ESPN fetches with one server-backed, cached callable/read model so browsers do not create an unbounded second client fleet. Preserve current data on failure and pin stale-data UI copy.

3.2 **Stripe.** Wrap only outbound Stripe SDK calls in the `stripe` policy. The webhook remains fail-closed and idempotent: if its Stripe-dependent operation cannot run, record the failure and return retryable 503; do not use cached payment state as a substitute for verification.

3.3 **Gemini and Courier.** Route both SDK/fetch paths through their named policies. Gemini fallback is typed and user-visible; Courier fallback is non-blocking delivery failure with operational telemetry. Do not let a failed page send recurse through the same broken Courier dependency.

3.4 **Email extension and Firebase.** Add bounded Firestore queue writes and datastore deadlines at orchestration boundaries, but do not add a fake “delivery success” breaker around the asynchronous extension. Add an independent queue-age health signal.

### Phase 4 — Verification and rollout (Critical, medium)

4.1 **Unit tests.** Pin closed → open after five qualifying failures in 30 seconds; open short-circuit; exactly one half-open probe after 15 seconds; close on probe success; reopen on probe failure; ignored faults; permits; and shared budget arithmetic.

4.2 **Integration/load test.** With a deliberately hung ESPN fake, saturate ESPN permits and verify a Stripe-independent callable, a Firestore-only callable, and Gemini-disabled fallback remain responsive within their own budgets. Repeat for Courier and Gemini. The test must prove zero cross-policy permit sharing.

4.3 **Canary observability.** Deploy functions first, observe breaker/fallback logs and health metrics under normal traffic, then run controlled failure drills. No production Stripe failure injection: use the Stripe test/emulator seam only.

### Phase 5 — Stripe webhook edge hardening (PROPOSED, not implemented — added 2026-09-03)

> **NO CODE EXISTS.** As of 2026-09-03, `handleStripeWebhook` (`functions/src/stripe.ts:1391`) returns only 405 / 503 / 400 / 500 / 200. There is no route token, no source-IP check, and no test for either; `git log --all -S STRIPE_WEBHOOK_PATH_TOKEN` is empty on every branch. A `docs/stripe-webhook-security.md` draft dated 2026-08-25 described this phase as if it had shipped and was withdrawn rather than committed. This phase is plan-gated in its own right (money + authorization): do not implement it under this plan's sign-off without its own §2c rounds.

5.1 **Route token.** Serve the webhook only at `POST /<STRIPE_WEBHOOK_PATH_TOKEN>` (at least 32 random URL-safe characters, held as a Firebase secret, never in source or a public runbook). A missing or wrong token returns `404` with a structured warning. The Firebase emulator may bypass route and IP filtering so `stripe listen` can deliver from localhost; it never bypasses signature verification.

5.2 **Source-IP allowlist.** `STRIPE_WEBHOOK_ALLOWED_IPS` holds the `WEBHOOKS` array from Stripe's published list (`https://stripe.com/files/ips/ips_webhooks.json`); a non-allowlisted source returns `403` with a structured warning. Defense in depth only: a directly reachable function receives proxy headers a caller can influence, so an authoritative boundary needs an external HTTPS load balancer plus a Cloud Armor allow rule built from the same list, with the direct function URL made private. Signature verification remains the primary control. UNVERIFIED: Stripe's stated seven-day notice for IP changes — confirm against Stripe's docs at implementation time.

5.3 **Cutover and tests.** Set both secrets, deploy, add the suffixed endpoint in the Stripe Dashboard, copy its signing secret into `STRIPE_WEBHOOK_SECRET`, subscribe it to the same events, and remove the old endpoint only after Stripe shows successful delivery to the new one. Tests to add in `functions/src/__tests__/`: tampered body rejected by the SDK, stale signed timestamp rejected, outside-IP source rejected with `403`, token mismatch rejected with `404`, emulator path bypasses route/IP only.

## Key decisions & tradeoffs

- **15-second recovery interval.** It limits failed fast retries while allowing a quick recovery test. It is configurable as a constant but not a live toggle in this phase.
- **Failures are rolling-window, not consecutive.** Five qualifying failures in 30 seconds open the circuit even if successes interleave; this matches the requested threshold and reacts to unstable providers.
- **No universal “success” fallback.** Payments and webhooks fail closed; score/feed reads serve known-good cached data; notifications degrade asynchronously; AI shows an honest unavailable state.
- **No shared client pool.** External vendor clients and semaphore limits are dedicated. Firebase-managed datastore transport is constrained at function concurrency rather than by unsupported per-query socket pools.
- **No retries that exceed the budget.** A retry is allowed only when enough remaining time exists for its attempt and minimal backoff.

## Risks / open questions

- **DECISION NEEDED:** Is a process-local circuit sufficient for the first rollout? Recommended: yes; aggregate log-based alerting first, then add a distributed breaker only with a deliberately operated store.
- Browser ESPN reads must be migrated rather than merely wrapped, otherwise every browser keeps an uncontrolled connection pool and bypasses server cache/breaker state.
- Stripe’s SDK transport option must be verified against the pinned v22 API before implementation; do not rely on undocumented fetch dispatcher behavior.
- Per-function `concurrency` overrides need traffic measurements before final values are committed; the existing global `maxInstances: 10` cap remains in force. The listed limits are outbound limits, not a claim about safe function throughput.

## Out of scope

- Changing scoring semantics, payment/ledger business rules, or webhook idempotency contracts.
- A new distributed cache, Redis service, or global circuit-state datastore.
- Retrofitting every ordinary Firestore document read as a circuit-breaker call; Firestore remains the system-of-record dependency and gets bounded orchestration/concurrency instead.
