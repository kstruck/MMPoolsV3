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
