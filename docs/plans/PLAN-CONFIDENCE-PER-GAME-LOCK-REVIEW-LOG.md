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

---

## Round 5 — 2026-09-10 ~15:10 MDT, implementation diff @ `f92fbd03`

3 findings (2 P1, 1 P2), all accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P1 | A member who froze a 16 early (locked pick) and later MISSED a game had `maxValue` drop to 15, and the validator re-checked the frozen 16 against that range — every later submission refused, and nothing they could do about it. | **ACCEPT** | The D2 rule is now stated precisely: a miss forfeits the top value **still open** — the range `[17−N .. 16]` minus the values frozen on locked picks, minus the top k of what is left. `confidenceSlateFor` takes the stored weights and returns `frozenValues` + `availableValues`; `validatePerGameConfidence` holds only OPEN games to `availableValues` and grandfathers frozen weights (uniqueness still enforced). The sheet's dropdowns list `availableValues` (a locked game lists only its frozen value). Tests: shared + unit grandfather cases; emulator "a frozen 16 is grandfathered after a later miss" (16 frozen, Sunday missed → 15 forfeited, Monday takes 14). |
| 2 | P1 | The entry write persisted `{ confidence }` = the REQUEST map and leaned on `{ merge: true }` deep-merging the nested map. The client drops a stale locked weight before sending, so a locked weight the validator kept could vanish from Firestore and score that pick 0. | **ACCEPT** | The write now persists the MERGED map explicitly (`{ ...stored, ...submitted }`) — what the validator judged is what lands. Emulator: the r5 scenario sends no weight for the locked game and asserts the stored 16 is still on the entry. (Whether `merge: true` deep-merges maps is no longer load-bearing.) |
| 3 | P2 | `getWeekStatus` computed `weekStarted` from the raw deadline while `gameClosed` used the pool-aware lock, so an extended or status-corrected confidence week could read as `due` and show a pick CTA the server would refuse. | **ACCEPT** | `nflPending.getWeekStatus`: with the pool doc, `weekStarted = isWeekLockedFor(...)`. |

Emulator scenario #4's expectation changed from `DUPLICATE_CONFIDENCE_VALUES`
to "refused" (`OUT_OF_RANGE|DUPLICATE`): with frozen values excluded from the
open games' list, moving the Wednesday 16 onto Sunday is caught by the range
check first. Same refusal, earlier check.

---

## Round 6 — 2026-09-10 ~15:50 MDT, implementation diff @ `2c42403c`

1 finding, P1, accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P1 | `PickemPickEntry` hydrates the entry's whole-season `picks`/`confidence` maps and resends them on every save, so a Week-2 save on a stamped PER_GAME confidence pool carries Week-1 keys — and the PER_GAME loop refuses them as `Game … not found`. Every Week-2+ save would fail. | **ACCEPT** (see row) |

Row 1 detail: verified — the sheet's state IS the whole-season map
(`PickemPickEntry.tsx` hydration) and nothing filtered it, so straight PER_GAME
pools were exposed to the same refusal on Week 2+ before this branch. Fix,
server: `onlyThisWeek()` — a key outside this week's slate is never validated
and never written; a key the entry ALREADY HOLDS (history being resent, even a
stale draft of it) is ignored in both branches; a key the entry has never held
keeps each branch's long-standing contract — WEEKLY ignores it
(`blindPicks.emulator.test.ts` "picks whose games belong to another week do not
mark this week"), PER_GAME refuses it (`hofDressRehearsal` "REJECTS a pick on
the regular-season game — it is not in this pool's week"). Two cuts were needed
to land on that: the first refused every never-held key (broke blindPicks), the
second ignored every other-week key (broke hofDressRehearsal); the branch-aware
rule is the one that preserves both. Client: the payload is filtered to this
week's ids as well. Emulator: the r5 scenario seeds a prior-week pick+weight,
resends them changed, and asserts they are untouched; a never-held junk key is
still refused on the PER_GAME pool.

---

## Round 8 — 2026-09-10 ~17:15 MDT, implementation diff @ `498eebac`

1 finding, P2, accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P2 | `isWeekLockedFor` applied the status check only on WEEKLY pools; on a PER_GAME confidence pool whose LAST game left SCHEDULED and then had its `startTime` corrected forward, the per-game predicate locked the game but the week helper said open — CTA/checklist would show a slate as due that the server refuses. | **ACCEPT** | `shared/nflLockMode.ts`: on PER_GAME the week is closed when EVERY game is, by the same per-game predicate (status or clock). Unit case added. |

---

## Round 9 — 2026-09-10 ~17:50 MDT, implementation diff @ post-r8 commit

2 findings (P1, P2), both accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P1 | A weight the member changed locally on a SAVED game and did not submit before that game locked is a stale draft; the submit path drops it, but the sheet's duplicate audit still counted it, so if it collided with an open game's value `canSubmit` stayed false and the locked dropdown could not be changed — the member could not save anything. | **ACCEPT** | `PickemPickEntry.tsx`: one `auditWeights` map — a locked game counts its SAVED weight, a missed game counts nothing, an open game counts the draft — feeds the duplicate audit, the owners map, the duplicate badge, and a locked game's dropdown value/option. Surface-invariant guard updated. |
| 2 | P2 | A pre-release confidence entry holding a proxy pick with NO weight (proxyPick never carried one) would, once its pool is per-game, fail every later submission at "Missing confidence value" for a locked game nothing can supply. | **ACCEPT** | `validatePerGameConfidence`: a LOCKED pick with no weight is grandfathered (scores 0 as it always has); an OPEN pick with no weight is still the member's to fix. Unit case added. |

---

## Round 7 — 2026-09-10 ~16:30 MDT, implementation diff @ post-r6 commit

1 finding, P1, accepted.

| # | Sev | Finding (condensed) | Verdict | What changed |
|---|---|---|---|---|
| 1 | P1 | The Pick'em branch read `pool.settings` captured BEFORE the transaction. A manager enabling confidence mode can commit between that read and the retry; the retried body would then write picks with no weights against a now-confidence pool — and the new `confidenceMode` gate would refuse to correct the setting because that entry holds a pick. | **ACCEPT (narrow fix)** | The branch now reads `poolInTx.settings`, and if `confidenceMode`, `lockMode` or `lockRuleVersion` differ from the pre-transaction copy the submission is refused with `aborted` / `SETTINGS_CHANGED` — the lock instants above the transaction were computed under the other mode and must not be applied to this one; the client's ordinary retry lands on a consistent read. A full re-derivation of the lock arithmetic inside the transaction is NOT done: the freeze protocol (`ensureHardLockFreeze`, `weekLockDecision`) is deliberately pre-transaction and pre-existing, and lock-affecting settings edits already serialize with the scoring lease. Not emulator-testable as a race; the guard is a two-line equality check. | Verified: the sheet's state IS the whole map (`PickemPickEntry.tsx` hydration) and nothing filtered it. (This means straight PER_GAME pools were exposed to the same refusal on Week 2+ before this branch — the loop is pre-existing — unless a resend happened to carry no prior keys; the fix below covers them too.) Server: `onlyThisWeek()` — a key for another week that the entry already holds is history being resent and is IGNORED (never rewritten, never refused); a key the entry does not hold and the slate does not contain is still refused. Applied to picks and weights, in both branches, and to the entry write, so a stale prior-week draft can no longer overwrite a prior week. Client: the payload is filtered to this week's ids as well. Emulator: the r5 scenario now seeds a prior-week pick+weight on the entry, resends them (changed, even) and asserts they are untouched; a never-held junk key is still refused. |
