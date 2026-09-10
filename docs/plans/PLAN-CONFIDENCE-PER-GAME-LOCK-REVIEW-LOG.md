# PLAN-CONFIDENCE-PER-GAME-LOCK — adversarial review log

Reviewer: `codex exec -m gpt-5.6-terra` (probe replied OK 2026-09-10 09:25 MDT).
Cap: judgement up to 10 rounds (CLAUDE.md §2c). Each round: findings verbatim
in substance, severity, verdict with evidence, what changed in the plan.

---

## Round 1 — 2026-09-10 ~10:05 MDT, plan @ `1800e04a` (+ sweeps `d09faf4f`)

Prompt: adversarial review of the plan against the cited code; find factual
errors, paths that let a locked pick or weight change, D2 range problems,
backfill/deploy-window problems, missing tickets/tests, anything breaking
WEEKLY pools, Survivor, Margin, or scoring. 10 findings.

| # | Sev | Finding (condensed) | Verdict | Evidence / what changed |
|---|---|---|---|---|
| 1 | P0 | "Immutable under any circumstances" is false: `extendWeekDeadline` writes a week override that `effectiveGameLockAt` honours as `max(kickoff−buffer, override)`, with no check that a game has already locked, so a locked confidence game reopens. | **ACCEPT (as P1 — pre-existing class, but the plan CLAIMED immutability)** | True: `effectiveLock.ts:173-187`, `poolExceptions.ts:147-191`. The GAME_LOCKED error text even says "Extend the deadline first if an exception is warranted" — reopening IS the feature on straight per-game pools, and stays so there (out of scope, recorded). For a **confidence PER_GAME pool** Kevin's rule is literal — *"a game that has started cannot be changed"* — so the plan now puts a **hard ceiling at kickoff**: lock instant = `min(max(kickoff−buffer, override), kickoff)`. One clause, in the shared `gameLockAt`/server `effectiveGameLockAt` pair, used by submit, proxy, reveal and the client. §3.2a, T3, T8 #11. |
| 2 | P0 | Shrinking `lockBufferMinutes` after a game locks moves its deadline later and reopens it; `lockRevision` protects scoring concurrency, not immutability. | **ACCEPT (same fix as #1)** | True: `effectiveLock.ts:72-88` documents no freeze for Pick'em settings edits. The kickoff ceiling closes it: a buffer edit can move a confidence game's lock later only up to kickoff, never past it. A game that has not started CAN be reopened by a buffer edit — which is within Kevin's stated rule. T8 #12. |
| 3 | P0 | Functions deploy necessarily precedes the backfill; in that window a legacy confidence pool with stored `PER_GAME` plays per-game to a hand-crafted callable. "UI deploy order cannot secure a callable." | **ACCEPT** | True. Kevin ruled backfill over a commissioner-facing flag; the fix that honours BOTH is a **version stamp written by the server, not by a person**: `settings.lockRuleVersion: 2`. The rule treats `confidenceMode && lockRuleVersion !== 2` as WEEKLY (the legacy behaviour, byte-for-byte); `createPool` stamps 2 on every new NFL_PICKEM; the backfill stamps `lockMode: 'WEEKLY'` + `lockRuleVersion: 2` on every legacy confidence pool. Nothing changes for any legacy pool until the backfill has touched it — in the same release. After the backfill the legacy clause is dead code and is retired in a follow-up once `lockRuleVersion !== 2` is measured to be zero pools. §3.1, §3.6. |
| 4 | P0 | The backfill predicate (`confidenceMode && lockMode !== 'WEEKLY'`) cannot tell a legacy pool from a pool created per-game AFTER the release (D5), and would silently convert the new one to WEEKLY. | **ACCEPT (closed by the same stamp)** | True as written. With #3's stamp the predicate is `confidenceMode && lockRuleVersion !== 2` — a post-release pool is stamped 2 at creation and never matches. Predicate re-checked inside the write transaction (T5). |
| 5 | P1 | The checklist runs dry and live once each, so only the first page (≤200 pools) may be backfilled. | **REJECT (defect); ACCEPT (clarify text)** | The Operations-panel runner the plan names as the model loops `do … while (cursor && pages < 100)` and aggregates every page — `OperationsPanel.tsx:211-227` — so one click covers every pool. §7 now says so explicitly and T8 #8 seeds >1 page (limit forced to 2 in the emulator) to prove the loop. |
| 6 | P1 | `proxyPick` writes a pick and never a weight, so on a PER_GAME confidence pool it creates "pick, no weight" — neither a ranked pick nor a D2 missed game (k counts missing PICKS). Shipping it "out of scope" while claiming every path preserves the rule is wrong. | **ACCEPT** | True: `poolExceptions.ts:336-390`, schema `schemas/poolExceptions.ts:37-39`. Pre-existing on weekly confidence pools too. Fix chosen: **`proxyPick` refuses a confidence pool outright** (`PROXY_CONFIDENCE_UNSUPPORTED`) — a commissioner exception on a confidence sheet needs a weight the callable cannot carry, and a half-entry is worse than a refusal. Adding weight support to proxyPick is the recorded follow-up. §3.3, T2, T8 #13. |
| 7 | P1 | The validator must validate CONFIDENCE keys, not only submitted pick keys: the schema allows an independent `confidence` map; the PER_GAME loop iterates `picks` only; `validateConfidenceValues` ignores non-slate keys. | **ACCEPT** | True: `poolCore.ts:87-93`, `nflPools.ts:742-755`, `nflScoringEngine.ts:197-217`. §3.2 now: every `confidence` key must be in the slate (`invalid-argument`), lock equality is enforced on every in-slate confidence key whether or not a pick was submitted for it, and the merged input is built from slate ids only. T8 #3 gains the weight-only-key case. |
| 8 | P1 | Flipping `confidenceMode` mid-season changes SCORING (weight vs 1 point) and has no policy. | **ACCEPT (small, reuses an existing gate)** | True and pre-existing: `nflScoringEngine.ts:168-178`. The weekly-tiebreaker setting already has exactly the right gate — refused once anybody has submitted, evaluated inside the write transaction (`poolOps.ts`, PLAN-WEEKLY-TIEBREAKERS §5). `confidenceMode` joins that gate: **`CONFIDENCE_MODE_LOCKED` once any entry in the pool holds a pick.** New T10. |
| 9 | P2 | "Scoring untouched" overstates: the scorer adds a stored weight or 0, so a historical/proxy "pick, no weight" is indistinguishable from a zero-weight pick. | **ACCEPT (wording + invariant, no repair op)** | After #6 and #7 no server path can create a pick without a weight in a confidence pool. Historical ones score the weight they have (0) exactly as today; that is stated in §0 instead of "untouched". No repair op — none is asked for and none is safe to guess. |
| 10 | P2 | T8 lacks: extension after lock, buffer edit after lock, proxy, multi-page/concurrent backfill, `confidenceMode` toggles, Survivor/Margin regressions under member and proxy paths, pre-existing WEEKLY pool unchanged by migration. | **ACCEPT** | T8 #11–#16 added. Survivor/Margin hard lock is already pinned by `tests/nfl-lockmode-invariants.test.ts:25-31` and the emulator hard-lock suites; one explicit regression case per path added anyway because the rule function is being rewritten. |

**Round 1 result:** 9 accepted (two as one fix), 1 rejected with evidence.
Plan moves to v3 (`lockRuleVersion` stamp; kickoff ceiling; proxy refusal;
confidence-key validation; `confidenceMode` gate; six more emulator scenarios).
Round 2 runs on v3.

---

## Round 2 — 2026-09-10 ~10:40 MDT, plan v3 @ `b0766234`

Prompt: re-review v3 with the round-1 absorptions; focus on the stamp design,
whether the kickoff ceiling closes every reader, the D2 range edges
(cancellation, moved `startTime`, k from stored vs merged), the rejected #5, and
regressions. 5 findings. Codex also confirmed the round-1 #5 rejection
("cursor semantics are sound … correctly rejected").

| # | Sev | Finding (condensed) | Verdict | Evidence / what changed |
|---|---|---|---|---|
| 1 | P0 | The ceiling and "has started" both read the mutable `game.startTime`; a feed correction that moves `startTime` LATER after real kickoff reopens the game in submit, reveal and the client. | **ACCEPT (as P1; fix = status-aware lock)** | `NFLGame.status` is `'SCHEDULED' \| 'IN_PROGRESS' \| 'FINAL' \| 'CANCELLED'` (`nflPoolTypes.ts:32`) and the scorer already trusts it (`isTerminalGame`, `lib/weekCompletion.ts:27`). In a confidence pool a game is locked when `status !== 'SCHEDULED'` OR the time rule says so — one helper, pool-aware (`gameLockAtFor` / `isGameLockedFor` in `shared/nflLockMode.ts`), used by every reader (#4). A persisted first-observed kickoff is NOT added: status covers the realistic failure (the feed moves a time while the game is live/final) without a new write path. T8 #18 moves `startTime` forward on an `IN_PROGRESS` game and asserts it stays locked. |
| 2 | P1 | `lockRuleVersion` is stamped only by `createNFLPool`; the generic `createPool` (`poolOps.ts:318+`) accepts any type and would leave an NFL_PICKEM pool unstamped; and a manager can write `settings.lockRuleVersion` through `flattenSettingsPatch` because it is not in `SERVER_OWNED_SETTINGS_KEYS` (`poolUpdate.ts:99`). | **ACCEPT** | Verified: `createPool` validates only `name` and type-specific fields (`poolOps.ts:330-348`), so an NFL type goes through. Fix: one `stampLockRuleVersion(newPool)` helper called in BOTH creators for every NFL type; `lockRuleVersion` joins `SERVER_OWNED_SETTINGS_KEYS` (a manager save carrying it is refused, as `weekLockOverrides` is). The manager UI builds its payload from explicit state fields (`NFLManagerView.tsx:862-872`), so it never sends the key. T11 widened; T8 #14 gains the generic-create case and an attempted downgrade. |
| 3 | P1 | T8 #8 and §7 step 3 say only `PER_GAME`/absent pools change, but the v3 predicate matches every unstamped confidence pool including stored-WEEKLY ones; as written the test would leave WEEKLY legacy pools unstamped forever. | **ACCEPT** | Plan text error. T8 #8 now: all three confidence pools are stamped (the stored-WEEKLY one with a no-op `lockMode` write), the straight pool untouched; `plannedWrites` reports `storedLockMode` for every matched pool; §7 says Donkeys WILL appear in the dry run whatever its stored value. |
| 4 | P1 | The ceiling is promised for every client reader but T6 names only `PickemPickEntry`; `NFLUserBentoDashboard.tsx:386-389` calls `gameLockAt` itself, `nflPending.ts:173-175` hand-rolls the same arithmetic, and `pickReveal.ts:106-109` calls `effectiveGameLockAt` directly. | **ACCEPT** | One pool-aware helper pair in `shared/nflLockMode.ts` — `gameLockAtFor(pool, week, game)` / `isGameLockedFor(pool, week, game, now)` — folding buffer, override, the kickoff ceiling and game status; every reader routes through it: `PickemPickEntry`, `NFLUserBentoDashboard`, `nflPending.getWeekStatus`, `WeekChecklist`/`nflStatusService` (via nflPending), and the server's `effectiveGameLockAt` gains the same `kickoffCeiling`/status inputs so submit, proxy, reveal and the scorer's `gameLockClosed` agree. A reader-parity unit test compares the shared and server helpers on a table of cases. T6 lists the files. |
| 5 | P1 | D2 has no cancellation policy: a game `CANCELLED` before kickoff is terminal and scores VOID, yet the time-only lock leaves it "open" — members must pick and weight an unscorable game, and it consumes a value. | **ACCEPT** | With #1 a CANCELLED game is LOCKED (status-aware). Policy, scoped to the PER_GAME confidence validator: a cancelled game with NO stored pick leaves the slate for range and completeness (it is neither pickable nor the member's fault — it is NOT counted in k, and N excludes it); a cancelled game WITH a stored pick keeps its weight frozen and scores 0, exactly as today's documented behaviour ("confidence points lost, not reassigned"). Worked example: 16 games, one cancelled unpicked → 15 games, range 1..15 with k=0 (the 16 is simply not in play — no one could have used it). A postponed game (status still SCHEDULED, later `startTime`) is open and editable — that is within Kevin's rule. A game re-slotted to another WEEK leaves the slate; stored weights on it are a pre-existing class and stay out of scope. T8 #19–#20. |

**Round 2 result:** 5 accepted, 0 rejected. Plan moves to v4. Round 3 runs on
the IMPLEMENTATION diff (`codex exec review --base origin/main`), not on the
prose again — two prose rounds have converged to reader-parity and edge-policy
detail that the code will show better than the document.

---

## Round 3 — 2026-09-10 ~13:10 MDT, implementation diff @ `66f260e8` (`codex exec review --base origin/main`)

2 findings, both P1, both accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P1 | The WEEKLY branch of `submitNFLPicks` still read `weekLocked` from timestamps alone, and `weekRevealFor`'s WEEK branch likewise — so in a WEEKLY confidence pool a feed correction moving a live opener's `startTime` into the future reopened the whole sheet (and hid the reveal). The status-aware lock had only been wired into the PER_GAME paths. | **ACCEPT** | `nflPools.ts`: `weekStatusLocked = kickoffCeiling && games.some(status !== 'SCHEDULED')` folded into `weekLocked` at both the pre-transaction and per-attempt computations. `pickReveal.ts` WEEK branch: the same predicate on `open`. Tests: `pickReveal.test.ts` "status beats the clock in a WEEKLY confidence pool too"; the LEGACY emulator scenario now seeds the live opener with a FUTURE `startTime` and still expects `WEEK_LOCKED`. |
| 2 | P1 | A weight the member set on a game they then missed (locked, no saved pick) is dropped by the submit path, but the sheet still counted it in `confidenceOwners` and the duplicate audit — so its value was greyed out on every open game and, if inside the reduced range, the member could never complete the sheet. | **ACCEPT** | `PickemPickEntry.tsx`: both the duplicate audit and `confidenceValueOwners` exclude `confidenceSlate.missedIds`; `canSubmit` already only asks for weights on weightable games. |

Also found while running the full emulator suite after round 3 (not a codex
finding): `goldenArc`'s first `beforeAll` failed with "Sim harness callables are
SUPER_ADMIN only" whenever the new emulator file ran earlier in the same
process. Cause: the new `createNFLPool` scenario created a pool AS admin-1,
which wrote `managedPools` / `commissionerAggregate` onto the shared admin user
doc, and a later suite's profile recompute then changed that user's role.
Fixed by giving the scenario its own creator user and deleting its subtree
afterwards. **Correction after measuring:** the same combo (`autoScore` then
`goldenArc`, or `fixtureMatrix` then `goldenArc`) fails identically on
origin/main `59deb790` with this branch's code checked out nowhere — the
`goldenArc` beforeAll-before-beforeEach ordering is pre-existing and not
caused by this branch. Task chip filed; the isolation change above is kept
because it is hygiene either way.

---

## Round 4 — 2026-09-10 ~14:20 MDT, implementation diff @ `adbc39e1`

(A first round-4 run coincided with the lint-baseline `git checkout --detach
origin/main` and reported "HEAD matches the merge-base — no changes"; it was
re-run on the branch. Lesson: never move HEAD while a `codex exec review` is
running in the same worktree.)

1 finding, P1, accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P1 | The new tiebreaker guard used `every` over the target games, so a legacy `MNF_COMBINED` target (the SUM of two Monday games) stayed editable after the first game started — a member could revise a combined total with half the outcome known. | **ACCEPT** | `nflPools.ts`: `some` instead of `every`. Emulator scenario "a legacy MNF_COMBINED tiebreaker locks when the FIRST Monday game starts" (27/27 in the file). |
