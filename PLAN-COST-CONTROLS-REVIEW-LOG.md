# Plan Review Log: Cost Controls (PLAN-COST-CONTROLS.md)

_Adversarial cross-model review per CLAUDE.md §2c. PLAN_FILE=PLAN-COST-CONTROLS.md.
MAX_ROUNDS=10 flat (qodo DORMANT per §2b — stopping rule is TWO conditions: a
clean codex round AND Claude's own read of the diff). Run 2026-08-22 from the
cloud environment AFTER Kevin's network fix (api.openai.com allowed,
`OPENAI_API_KEY` set) — this closes the "§2c review NOT run" flag the PR carried
from the pre-fix session. Reviewer: `codex exec`, codex-cli 0.149.0. The
environment's API project does not carry codex's default model; rounds ran
pinned to the codex-family model the key exposes (`gpt-5.3-codex`)._

## Round 1 — codex (`codex exec review --base origin/main`)

VERDICT: CLEAN — "The diff only adds documentation and planning content
(CLAUDE.md and a new PLAN-COST-CONTROLS.md) without changing executable code
paths, so there are no introduced runtime bugs to flag."

### Claude's response

Recorded but NOT treated as the review. The stock review prompt targets
introduced runtime bugs, and a docs-only diff trivially has none — a clean
verdict that never engaged the plan's content is vacuous for a plan-gated
artifact. §2c's own warning ("do not treat a clean round 1 as the review")
applies squarely. Round 2 re-ran codex with an explicit adversarial
plan-review brief; independently, Claude verified every file:line claim in the
plan against the repo (all held — see the round 2 response for the one
discrepancy Claude found in parallel with codex).

## Round 2 — codex (adversarial plan-content brief: verify claims against code, hunt contradictions/sequencing/arithmetic)

VERDICT: REVISE. 7 findings, all accepted (final arbiter: Claude; #7 accepted
narrowly). Summary:

1. (Critical) Phase 0.5.3's kill-switch mechanism contradicts D4's exemptions:
   the D4-exempt security-alert SMS (`userManagement.ts:174`) and `testSmsHttp`
   (`:219`) flow through the SAME `sendCourierSMS` (`smsService.ts:36`) as the
   member sends the switch must block — a bare check at the top of the function
   cannot scope to "member-facing sends" as 0.5.3 claimed. (Claude's own
   self-review found this same defect independently before round 2 ran.)
2. (High) Phase 2's quota placement leaves a bypass window: 7.5 deliberately
   keeps direct `ai_requests` creates allowed until the client cutover is
   verified, so quotas enforced only in the Phase 2.1 callable would be
   bypassed by every legacy direct write (`AICommissioner.tsx:59,80` against
   `firestore.rules:500`) during that window.
3. (High) Phase 7.2's sweep definition ("no direct `generateAIResponse` /
   `sendCourierSMS` callers outside the wrappers") cannot prove
   centralization: `sendOpsSMS` already fetches `api.courier.com/send`
   directly (`opsAlertDispatcher.ts:126`), which a name-only sweep misses.
4. (Medium) Inventory claim wrong: Sentry is not client-side only — backend
   `functions/src/lib/sentryServer.ts` exists (monetization-alert mirror,
   invoked from `stripe.ts`), dormant until a `SENTRY_DSN` is configured.
5. (Medium) Email inventory incomplete: `sendEmail` (defined `reminders.ts:34`)
   is called from 19 functions files, and `opsAlertDispatcher.ts` enqueues to
   `mail` directly — the plan implied a reminders-only path.
6. (Medium) Phase 3.5(b)'s refusal shape ("headline … with no other content")
   is unproducible: the enforced schema (`gemini.ts:28`) REQUIRES
   `summaryBullets`, `explanationSteps` and `confidence`.
7. (Low) Phase 0.3's arithmetic is a single loose band, and the plan never
   states precedence between the global $50 and per-pool $5 breakers.

### Claude's response

All 7 verified against the code before absorbing (each cite re-read; #4's
`sentryServer.ts` and #5's 19-file count confirmed by grep). Plan amended:

1. **Accepted.** 0.5.3 rewritten: `sendCourierSMS` gains a required
   `audience: 'member' | 'security' | 'test'` parameter; the kill-switch blocks
   `'member'` only; per-caller assignments enumerated; `sendOpsSMS` untouched.
2. **Accepted.** 2.2 amended: the quota transaction lives in `onAIRequest`
   before the Gemini call (over-quota ⇒ `status: 'RATE_LIMITED'`, no provider
   call); the callable pre-check is UX only.
3. **Accepted.** 7.2 widened to endpoint/SDK-class sweeps
   (`generativelanguage.googleapis.com`, `GoogleGenAI`, `api.courier.com`)
   against an explicit allowlist (wrapper modules + D4-exempt
   `opsAlertDispatcher.ts`). PLAN-COST-CONTROLS-SWEEPS.md Sweeps 1–2 already
   run at endpoint level and confirm the inventory.
4. **Accepted.** Inventory Sentry row corrected (backend module named,
   DSN-gated dormant), marked as a round-2 correction in the plan text.
5. **Accepted.** Inventory email row corrected (19 caller files + the ops
   dispatcher's direct enqueue); full writer enumeration stays Phase 1 work —
   email remains inventory-only this phase.
6. **Accepted.** 3.5(b) refusal shape corrected to schema-valid (fixed
   headline, empty arrays, `confidence: 0`), pinned by a Phase 7.1 unit test.
7. **Accepted narrowly.** 0.3 gains an explicit cap-precedence paragraph
   (independent breakers, each disables its own scope) and commits Phase 0.2
   to a low/base/high cost table before quota numbers are final. The exact
   table itself is NOT written now — it depends on Phase 0.2's verified
   prices, and inventing numbers ahead of them is the failure mode the plan's
   own "prices are Phase 0.2-verify targets, not gospel" line guards against.

Claude's parallel self-review additionally verified (no plan change needed):
the 0.5.1 "no extra read billed" claim (`isPoolParticipant()` at
`firestore.rules:411` gets the same pool doc the entitlement check reads;
Firestore dedupes same-doc `get()`s), and the absence of entitlement checks in
both `onWinnerUpdate` (`:19-116`) and `onAIRequest` (`:119-370`) — the plan's
central defect claims hold.

## Round 3 — codex (re-review of the amended plan; brief: confirm each round-2 fix landed, hunt new defects in the new text)

VERDICT: REVISE. Confirmed all 7 round-2 fixes landed as amended ("Everything
else from the 7 accepted round-2 items checks out"). 2 new findings, both
accepted — both in text written during round 2, which is exactly the
"new code written to close a finding" class §2c prices a round for:

1. (High) The amended 0.5.1 weakens identity binding if implemented literally:
   it named `isPoolParticipant()` + the entitlement get but did not restate the
   EXISTING `request.resource.data.userId == request.auth.uid` condition
   (`firestore.rules:500-501`) — "tighten" could be read as "replace",
   and dropping it would let a participant forge `userId` (attribution
   poisoning; per-user quota framing once Phase 2 lands).
2. (Low) The round-2 email correction over-counted: "19 functions files" call
   `sendEmail`; the real invocation count is 17 — two of the 19
   (`emailPrefs.ts:10`, `opsAlertDispatcher.ts:92`) mention it in comments only.

### Claude's response

Both verified against the code, then absorbed:

1. **Accepted.** 0.5.1 rewritten to enumerate ALL FOUR conditions explicitly —
   `request.auth != null`, `userId == request.auth.uid` (retained, with the
   forgery rationale in the plan text), `isPoolParticipant()`, entitlement
   `== true` — with "tighten must not read as replace" named in place.
2. **Accepted.** Verified by re-grep (17 files with real invocations;
   `emailPrefs.ts` and `opsAlertDispatcher.ts` are comment-only, exactly as
   codex said). Plan corrected to 17. A lesson recorded: the 19 came from
   `grep -l "sendEmail("`, which counts mentions, not calls.

## Round 4 — codex (re-review of the two round-3 amendments)

VERDICT: APPROVED. Verification notes confirmed both amendments against the
code: the 0.5.1 wording is "explicitly additive, not replacing" and matches
`firestore.rules:497-503` / `:411` reality; the 17-file email count is accurate
(the two extras are comment-only); the ops dispatcher's direct `mail` enqueue
confirmed at `opsAlertDispatcher.ts:96`. No new findings.

### Claude's response

Nothing to absorb. Own read of the final diff (plan + log + sweeps) agrees:
every amendment traces to a logged finding, every factual claim in the plan now
carries a cite that was re-read this session, and the sweeps confirm the
inventories at endpoint level.

## Resolution — CONVERGED (clean final round, not a cap stop)

4 rounds, 9 findings total (1 Critical / 3 High / 3 Medium / 2 Low), 9 accepted
(#7 of round 2 narrowly — precedence paragraph now, exact cost table deferred to
Phase 0.2's verified prices), 0 rejected. Finding count fell 7 → 2 → 0 and
severity fell with it (the Critical came in round 2; round 3's two findings were
both in round-2's own amendments; round 4 was clean). Stopping rule per
CLAUDE.md §2c while §2b is DORMANT — TWO conditions, both met: round 4 came
back clean AND Claude's own read of the final diff agrees. No findings are
carried open. qodo was not waited for (DORMANT, Kevin 2026-08-19).

Round accounting: 4 of the 10-round cap spent. Round 1 (the stock
`codex exec review --base origin/main`) is counted even though its clean verdict
was vacuous for a docs-only diff — it was a paid run. Rounds 2–4 were
adversarial plan-content briefs, which is the shape this repo's plan gates
actually need.

---

# Phase 0.5 — implementation review (PR #516)

_Separate cycle from the plan review above: that one reviewed the PLAN, this one
reviews the CODE that implements Phase 0.5. Same reviewer and same rules
(CLAUDE.md §2c, qodo DORMANT, cap 10). Run 2026-08-22, `codex exec`,
`-m gpt-5.3-codex`._

## Round 1 — `codex exec review --base origin/main`

VERDICT: CLEAN — "tightens Firestore access controls, adds corresponding rules
tests, and propagates a new explicit SMS channel parameter consistently across
call sites without introducing obvious logic regressions."

### Claude's response

Recorded, not treated as the review — same reasoning as the plan cycle's round 1.
Rounds 2+ used adversarial briefs naming this diff's actual risk areas (a zod
transform on a money path, the rules `get()` budget, the collection-group index,
the audience split).

## Round 2 — adversarial: money paths, rules budget, index, audience coverage

VERDICT: REVISE. 1 finding (Medium), accepted.

1. (Medium) The schema transform stops SMS being SOLD going forward, but
   `finalizePoolPayment` trusts the PERSISTED session snapshot rather than
   re-parsing (`stripe.ts:725-732`, `:782`). A checkout session created before
   the deploy could still stamp `billing.featuresUnlocked.smsNotifications`.

Codex also verified clean: every buy path parses through the shared schemas; the
transform creates no type hole; no wrongful revocation for already-paid pools;
the rules change is budget-safe (`isSuperAdmin` is claim-based, total document
accesses well under 10); the collection-group query and its field override
match; every `sendCourierSMS` call site passes an audience.

### Claude's response

**Accepted, with half its proposed fix rejected.** The clamp now runs in the
webhook too, reading the SAME `UNSELLABLE_ADDON_KEYS` the transform uses so the
two cannot drift, and it writes an `UNSELLABLE_ADDON_SOLD` monetization alert —
clamping silently would leave a customer charged for SMS and not granted it,
with no record to refund from.

**Rejected:** filtering `snapshot.addons`. That array is the record of what was
PAID FOR and feeds `assertPaidCeilingForUpdate`; stripping it would make a
customer who already paid pay again if SMS returns, and it grants nothing today
because no client path can write `featuresUnlocked`.

## Round 3 — re-review of the round-2 fix

VERDICT: REVISE. 3 findings, all accepted. **Two were defects in round 2's own
fix** — the pattern §2c prices a round for.

1. (Medium) The alert `txn.set` sat ABOVE a coupon `txn.get` in the same
   transaction. Firestore requires all reads before all writes, so any checkout
   using BOTH a coupon and an unsellable add-on would have thrown the
   transaction and retried forever.
2. (Low) `clampUnsellableAddons` echoed its generic `T`, so the compiler could
   keep believing a clamped field was still literal `true`.
3. (Low) The new webhook tests were string-presence assertions that would pass
   with the executable code deleted.

### Claude's response

All three accepted. The clamp decision became a pure function
(`unsellableClampOutcome`) computed in place; only the alert write moved below
every read. The helper returns a widened boolean-valued mapped type. The tests
became behavioural, including the ordinary purchase that must NOT alert.

⚠️ **The ordering guard I wrote for finding 1 was itself vacuous.** Its first
version searched the whole file, matched a coupon read belonging to a DIFFERENT
function, and passed with the bug reintroduced. Caught by reverting the fix and
watching the test stay green. Now scoped to the `finalizePoolPayment` body,
asserting against the LAST transaction read, and it fails if its own markers go
stale.

## Round 4 — re-review of the round-3 fix

VERDICT: REVISE. 2 findings, both accepted.

1. (Medium) `checkAiVolume` delegated to `timed()`, which turns any throw into
   `ok: false` — while carrying a comment promising it would never do that. The
   Overview card ANDs every check (`SuperAdminBentoDashboard.tsx:164`), so a
   missing index would print "Degradation detected" over a healthy platform.
2. (Low) The ordering guard matched only `txn.get(`, which `txn.getAll(` does
   not contain.

### Claude's response

Both accepted. The probe catches its own errors, stays `ok: true`, and reports
`AI volume unavailable: <reason>` — never a `0`, which would read as "no AI
spend" exactly when the thing watching spend is broken. It is exported so it can
be tested by BEHAVIOUR rather than by string-matching (the round-3 lesson applied
unprompted). The guard now matches every read form.

## Round 5 — re-review of the round-4 fix

VERDICT: REVISE. 3 findings, 2 accepted, 1 rejected.

1. (Medium) `sendCourierSMS` consults the switch on every send and the reminder
   passes call it once per RECIPIENT — one `system/config` read per member per
   run, i.e. spending Firestore reads to check a cost-control switch.
2. (Low) The AI-volume test pinned the query's field and operator but not the
   24h window.
3. (Low) The ordering guard cannot see `txn['get'](…)`, an aliased handle, or a
   read inside a helper.

### Claude's response

**1 and 2 accepted.** 60s process-level TTL cache, with the staleness tradeoff
stated in the code and failures deliberately NOT cached. The window is now
asserted within a second of `now - 24h`.

**3 REJECTED, with reasoning recorded at the assertion itself.** Closing it means
an AST pass or an emulator test that deliberately mis-orders a read, and neither
is worth its weight against a tripwire: the regression that actually happened was
an ordinary `txn.get(` added below a write, which this catches. The limitation is
now named in the test rather than left implied.

## Round 6 — re-review of the round-5 fix

VERDICT: REVISE. 1 finding (Medium), accepted.

1. (Medium) Overlapping cache misses each issued their own read, and the last to
   finish installed its value — which can put an older config over a newer one
   and push real staleness past the 60s the module advertises.

### Claude's response

Accepted. `loadCostControls` now single-flights; the cache entry is stamped at
COMPLETION so a slow read cannot install an already-old entry; the `finally`
clearing `inflight` has its own test (a parked rejected promise would make every
later caller reuse the failure).

## Round 7 — re-review of the round-6 fix

VERDICT: **APPROVED.** "I don't see a new material issue worth a seventh paid
round." Confirmed: `inflight` is never left dangling, settled promises are not
reused, fail-closed holds on every read-error path, waiters on a rejected shared
promise receive the resolved `null` rather than an uncaught rejection, and
stamping at completion introduces no new staleness mode. Fresh-eyes sweep of the
whole diff found no new authorization holes.

One caveat raised and agreed as test-seam behaviour, not a production defect: a
read already in flight when `__resetCostControlsCache()` is called still writes
the cache when it settles. Nothing in production calls the reset; the limitation
is now named in its doc comment.

## Resolution — CONVERGED (clean final round)

7 rounds, 10 findings (5 Medium / 5 Low — no Critical), **9 accepted, 1 rejected
with written reasoning**, plus one half-rejection (round 2's proposal to filter
the paid-addons record). Severity never rose above Medium and the count fell
1 → 3 → 2 → 3 → 1 → 0. Stopping rule per §2c while §2b is DORMANT: round 7 came
back clean AND Claude's own read of the diff agrees. No findings carried open.

**Three of the ten findings were defects in code written to close an earlier
finding**, and one was a GUARD THAT DID NOT GUARD — the exact failure §2c
documents. Every guard in this PR was therefore checked by reverting the thing it
protects and confirming the test goes red: the rules tighten (3 assertions fail),
the audience assignments, the transaction ordering, the health probe, the 24h
window, and single-flight.

---

# Cycle 3 — Phase 1 (usage attribution)

_Third review cycle on this plan: cycle 1 reviewed the plan document, cycle 2
reviewed the Phase 0.5 implementation, this one reviews Phase 1. Run 2026-08-23,
`codex exec`, codex-cli 0.149.0, model `gpt-5.3-codex` (the API project does not
carry codex's default model). MAX_ROUNDS=10 flat; qodo DORMANT per §2b, so the
stopping rule is TWO conditions — a clean codex round AND my own read agreeing._

## Round 1 — `codex exec review --base origin/main`

VERDICT: CLEAN. "I reviewed the diff against the specified merge base and did
not find discrete, actionable defects introduced by this patch."

### Claude's response

Recorded, not treated as the review — §2c: "round 1 finds defects in the code,
and rounds 2+ find defects in the fixes… do not treat a clean round 1 as the
review." Self-review of the same diff immediately found TWO defects the stock
prompt missed, both in code written this cycle:

1. **Double-count.** `generateAIResponse` parses the model's JSON *inside* the
   same `try` as the API call, and a malformed response throws
   `Failed to parse AI JSON` into the outer catch — the catch that records
   provider failures. One billed call therefore recorded BOTH a `success` (with
   tokens and cost) and an `error`, inflating `calls` in the rollup and dragging
   per-call cost averages low. Fixed with a `providerCallRecorded` flag: a parse
   failure on our side does not change whether the provider billed us.
2. **Silent misconfiguration.** `if (!apiKey) throw` sits OUTSIDE that try, so a
   missing Gemini key threw with zero telemetry — indistinguishable in the
   rollup from "nobody used the feature", while the equivalent missing-Courier-
   token path already recorded `skipped`. Now records `skipped` /
   `not_configured`.

Both pinned by `geminiUsageAccounting.test.ts`, and both revert-checked.

## Round 2 — adversarial: write amplification, telemetry latency, accounting holes, guard quality

VERDICT: REVISE. 6 findings (1 High, 2 Medium, 3 Low). All 6 verified against
the code, all 6 accepted.

1. (High) Member SMS carried no pool context, so every pool's SMS collapsed into
   ONE daily aggregate doc (`…__sms.member____none__`) — losing per-pool spend
   attribution AND creating 1-write/sec contention on a single document during a
   reminder blast.
2. (Medium) `sendOpsSMS` reaches `api.courier.com` directly and recorded
   nothing, so the Phase 1 exit gate ("every external paid call produces an
   attributable usage event") was **false as written**, and Courier invoice
   reconciliation would be incomplete.
3. (Medium) The raw event and its daily aggregate were two separate awaits: the
   event could land while the increment failed, leaving the rollup reading LOW
   while calls were billed — and that rollup is what the Phase 2.3 breaker and
   the Phase 6 cost card read.
4. (Low) `normalized.startsWith(key)` has no delimiter boundary, so a
   non-delimited id like `gemini-2.0-flashlite` would price as
   `gemini-2.0-flash` — a WRONG number rather than the honest null this module
   exists to return.
5. (Low) The structural guards were loose: the SMS guard sliced from the
   function declaration to end-of-file, and the AI guard accepted `feature:`
   appearing anywhere in the argument list.
6. (Low) The 90-day `expiresAt` is inert without a Firestore TTL policy, which
   no deploy command creates and nothing in the repo can assert.

### Claude's response

All accepted; #5 accepted in part, with the AST half declined and reasoned.

1. **Accepted.** `sendCourierSMS` takes a required 4th `context` parameter;
   `reminders.ts:291,757` pass `{ poolId: pool.id }`, `userManagement.ts:174`
   passes `{ userId: uid }`, `:219` passes `{}`. Required rather than defaulted
   for the same reason as the `audience` parameter: a default makes a new call
   site silently un-attributed.
2. **Accepted.** `sendOpsSMS` instrumented on all four return paths as
   `sms.ops`, with its own brace-bounded coverage guard. D4 exempts ops paging
   from the KILL-SWITCH; it does not exempt it from costing money.
3. **Accepted.** Both writes now commit in one `db.batch()`. Tests assert a
   failed commit writes NEITHER document.
4. **Accepted.** Boundary-safe (`key + "-"`), with regression tests for a
   lookalike id.
5. **Accepted in part.** The scoping half is a real defect and is fixed:
   `extractFunctionBody()` brace-bounds both SMS guards, and `splitTopLevelArgs()`
   makes the AI guard check the THIRD POSITIONAL argument. A correctness
   experiment confirmed the change is not cosmetic — with a neighbouring
   function appended below `sendCourierSMS`, the old slice-to-EOF guard reported
   `6 outcome returns but only 5 usage events`, and the brace-bounded one is
   unaffected. **The AST proposal is REJECTED**, on the same reasoning this repo
   used to reject the equivalent request on #516's transaction-ordering guard:
   the primary enforcement is the TYPE SYSTEM — `usageContext` is a required
   parameter, so an omitted context is a compile error and CI typechecks — and
   these tests are a tripwire for the day someone makes it optional, not the
   enforcement itself. An AST pass is not worth its weight against a
   compiler-enforced invariant. Recorded at the assertion rather than left
   implied.
6. **Accepted.** Recorded in `PLAN-COST-CONTROLS.md` as a required manual step
   with the exact `gcloud firestore fields ttls update` command, and the
   90-day retention line marked **aspirational until it runs**. The
   automated-check half is not actionable from this repo: TTL is GCP-level
   configuration and appears in no file CI can read.

Two existing fixtures also needed updating — not product defects: `costControls`'
call-site regexes assumed the audience was the final argument, and the
`usageEvents` mock had to model a batch.

## Round 3 — re-review of all six fixes, plus a hunt in the new code

VERDICT: **APPROVED.** Confirmed each of the six fixes closes its finding, with
file:line evidence for every one. No new findings. It also independently
confirmed two properties I had checked myself: the batch rewrite preserves
`merge: true` and the never-throws contract, and the ops-SMS attribution
introduces no reentrancy loop (`recordUsageEvent` swallows its own failures and
never dispatches an ops alert, so `sendOpsSMS → recordUsageEvent → fail` cannot
recurse).

### Claude's response

Nothing to absorb.

## Resolution — CONVERGED (clean final round), with ONE residual risk named

3 rounds, **8 findings** (1 High, 2 Medium, 3 Low from codex; 2 more from
self-review that codex's clean round 1 missed), 7 accepted outright, 1 accepted
in part with the rejected half reasoned above. Round 3 came back APPROVED and my
own read of the diff agrees — the two conditions §2c requires while §2b is
dormant. 3 of the 10-round cap spent.

⚠️ **NAMED RESIDUAL RISK — per-pool aggregate contention under a large blast.**
Round 2's finding 1 fixed the *global* collapse; it did not eliminate
contention, it scoped it. A reminder blast to one large pool still increments a
single document (`{day}__courier__sms.member__{poolId}`) once per recipient, and
`recordUsageEvent` swallows write failures — so a contended write is DROPPED,
undercounting the rollup rather than erroring. Judged low in practice and NOT
fixed here, for three measured reasons: sends are sequential and awaited, so the
rate is bounded by Courier's round-trip; the call is already gated behind
`pool.reminders?.smsEnabled && smsOptIn && phone`, so the write count is
proportional to real intended sends rather than to membership; and member SMS is
OFF by Kevin's decision #3, so the live rate is currently zero. **The fix, if it
is ever needed, is a sharded counter, and Phase 2 is where it belongs** — that
phase already introduces a per-pool quota transaction on the same key. Recorded
here rather than in a comment so it is Kevin's call, not an assumption.
