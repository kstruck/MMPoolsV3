# ADR 0006: Sim harness drives real member-action paths via extracted internals

Date: 2026-07-09
Status: Accepted

## Context

The Test Suite's NFL simulators fabricate entries through the guarded `simWriteEntries`
callable (PLAN-TEST-SUITE items 8e/8f). That plan recorded an explicit tradeoff: *"the picks
callable is NOT exercised by simulators; callable coverage lives in emulator tests."* Direct
writes are fast and namespace-safe, but they skip everything `submitNFLPicks` enforces —
effective lock timing (per-game, weekly, commissioner overrides), spread-locked gating,
team-actually-playing validation, membership gates, duplicate-team rules for survivor/margin,
and the post-submit consensus recompute. A regression in any of those (e.g. the per-game
override lock bug fixed in Pool Homepage Phase 0) is invisible to a direct-write Sim Run:
the sim would stay green while real Members hit the bug.

The owner's bar for the preseason live test is "100% confident every pool actually works."
A harness that certifies scoring but not submission cannot meet that bar. The alternative —
having sims authenticate as dozens of real Firebase Auth users to call the public callables —
would pollute Firebase Auth and make runs slow and flaky.

`executeSurvivorRebuy` has the same shape: a member-action callable bound to
`request.auth.uid` that a season-length survivor Golden Scenario must exercise.

## Decision

Split the member-action callables into a pure internal function plus a thin auth wrapper:

- `submitNFLPicksInternal(db, uid, payload)` holds ALL existing validation and write logic,
  byte-for-byte. The public `submitNFLPicks` callable becomes `auth → internal(request.auth.uid)`.
  Same for `executeSurvivorRebuyInternal`.
- New guarded sim callables (`simSubmitPicks`, `simExecuteRebuy`) — SUPER_ADMIN-only,
  `simRunId`-verified against the target pool, sim-prefixed uid enforced, audited like every
  other harness callable — invoke the SAME internals with an explicit sim uid.

Golden Scenarios use the sim callables so a green run certifies the production submission
path (locks, validation, consensus recompute included). Bulk matrix Scenarios keep
`simWriteEntries` for speed — fidelity where it certifies, fabrication where it only feeds
the scorer.

## Consequences

- A submission-path regression now fails a Golden Scenario instead of shipping silently.
  This closes the known blind spot the previous tradeoff accepted.
- `nflPools.ts` is a danger-list file; the extraction is a behavior-preserving refactor that
  ships as its own commit with emulator tests proving the public callable's auth/validation
  behavior is unchanged.
- The sim callables widen the SUPER_ADMIN sim surface. Mitigated the same way as the rest of
  the harness: persisted-`simRunId` verification, sim-uid prefix enforcement, `admin_audit`
  on every attempt, and refusal outside the namespace.
- Lock-timing tests become possible deterministically: Scenario games carry `startTime`
  relative to run time, so a Golden Scenario can assert that a post-kickoff submission is
  REJECTED — an assertion class direct writes can never express.
- Supersedes the PLAN-TEST-SUITE 8f note "picks callable is NOT exercised by simulators"
  for NFL pool types.
