# REVIEW LOG — PLAN-SQUARES-SERVER-FIELDS

Rounds of review on `PLAN-SQUARES-SERVER-FIELDS.md` and its PR. Newest last.

| Round | Reviewer | Findings | Accepted | Rejected / open |
|---|---|---|---|---|
| S0 | self, before the first commit | 4 | 4 | — |
| M1 | mutation testing | 49 mutants, 48 red | — | 1 survivor (equivalent — see below) |
| X1 | codex (`gpt-5.6-terra`), first round, at `3b929a6b` against #761 | 1 | 1 | — |
| X2 | codex, second round, at `09553dbd` | 1 | 1 | — |
| X3 | codex, third round, at `bae951a6` | 1 | 1 | — |
| X4 | codex, fourth round, at `bab9a42d` | 0 | — | — |
| Q1 | qodo, first review of #765 (at `448a5aed`) | 10 | 8 (2 of them on #761) | 2 rejected (4, 6) |
| SW | sweeps (`PLAN-SQUARES-SERVER-FIELDS-SWEEPS.md`) | 0 | — | — |
| Q2 | qodo, re-review of #765 (at `cace846f`, after the draft/ready toggle) | 1 | 1 | — |

## Round S0 — self-review, before the first commit (2026-11-11)

Read against the code on `claude/squares-reopen` at `52599954`.

| # | Finding | Verdict |
|---|---|---|
| 1 | The plan's first draft said the new callable would admit "owner or manager". The squares callables it sits beside admit the owner or a confirmed SUPER_ADMIN (`assertPoolOwnerOrSuperAdmin`, as `unlockSquaresPool` does) | **Accepted** — plan §2b corrected; the callable uses the same check |
| 2 | The first draft said Manual Score Override already gates the score inputs. It does not: the per-period score cards render in every case; only the "Live Updates" card greys out | **Accepted** — the score inputs are now read-only exactly where the rule refuses them (locked, linked, override off), with a line saying why; plan §2d corrected |
| 3 | The end-to-end walk-through types a score on a pool that is linked and locked without the override — the write this change refuses. It would have failed for the right reason | **Accepted** — the walk-through turns Manual Score Override on first, as a commissioner has to |
| 4 | `createPool` would ask the real score feed from inside the functions emulator during the walk-through, about a made-up game id | **Accepted** — an emulator-only fixture (`emulatorFixtures/squaresFeed_<id>`), read only when the emulator variables are set; a unit test pins that the reader is never called otherwise (plan §2e) |

Also checked and found clean: `lockGrid` (the old alias of `isLocked`) is written but never read for a decision, so leaving it writable changes nothing; the only client write of `league` is the Props wizard, outside this rule's type scope; `firestore.rules` has no catch-all match, so `emulatorFixtures` falls under the default deny.

## Round M1 — mutation testing (2026-11-11)

Every guard was broken one at a time and the tests that should catch it were run.

- **The rule** (`squaresServerFieldsUnchanged`): 17 mutants — each frozen field dropped from its list, each condition loosened or tightened, the squares scope widened, the rule unwired. **16 red.** The survivor checks only the INCOMING type instead of both stored and incoming; it is **equivalent** — `type` is server-owned, so the two can never differ on a write the rule sees, and no test can tell them apart. It is kept as defence in depth, the same as the NFL functions beside it.
- **Server code** (`squaresFeedGame.ts`, `linkSquaresPoolGame`, the `createPool` branch): 22 mutants. **22 red.**
- **The link helper in the browser**: 5 mutants. **5 red.**
- **The read-only controls** (rules and matchup steps): 5 mutants. **5 red.** The payouts step (a disabled `fieldset` in `AdminPanel`) and the score inputs are covered by the end-to-end walk-through only.

## Round Q1 — qodo's first review of #765 (2026-11-11)

qodo reviews #765 against `main`, so it read the whole stack (110 files), not
only this PR's 24. Four findings are in code from #759/#761; where they are
real, the fix went to the PR that owns the code.

| # | qodo's finding | Verdict | What changed |
|---|---|---|---|
| 1 | Re-linking to another game carries the old game's scores and winners | **Accepted, narrowed.** Traced: the sync keeps a period score it already has, and its event records and dedupe markers (`audit_dedupe`) are keyed by pool and score, not by game. So a grid that played one game, moved to another, would be scored partly from the first | `linkSquaresPoolGame`: a **different** game starts from fresh scores; a grid whose scores show play, or that has any winner on record, cannot be moved — that is a new pool. Re-linking the **same** game keeps what it has. 4 emulator tests |
| 2 | 🛑 A commissioner can forge pre-game scores after kickoff (Manual Score Override), reopen the grid and re-draw | **Accepted — real.** `squaresGameHasStarted` read only `scores`, which the override lets the commissioner type. Repeated unlock + lock is a re-draw until the numbers suit them, with the scores known | "Started" also reads `gameTime`, which this PR makes server-owned. Fixes `unlockSquaresPool` and the non-owner reserve check together. Unit test + emulator test (forged scores, past `gameTime`, unlock refused, numbers kept). An UNLINKED pool has no `gameTime`; there the commissioner types every score by design, so there is nothing a re-draw could beat |
| 3 | The deploy order is a hard dependency | **Accepted in part.** No order makes this rule safe for the old page — refusing the old page's write is its purpose. But the order was wrong: functions → rules → `www` left a gap where the live page could not link at all | Order is now **functions → `www` → rules** (plan §5): every step leaves a working site; only a tab left open from before sees a refusal, until reloaded |
| 4 | Winner records are written by default with no opt-in switch | **Rejected.** This is decision D18, which Kevin confirmed on 2026-11-11 ("absent means running"). It is also not a new automation: the score sync wrote winners before this stack. `reconcileHeldPools` touches only pools marked held, which only happens after a pause was set | — (code is #759's) |
| 5 | No sweeps record for an authorization change | **Accepted** | `PLAN-SQUARES-SERVER-FIELDS-SWEEPS.md`: SF1–SF3. It found nothing review had not: every browser write of a frozen field is another pool type's, a SUPER_ADMIN's, or behind a control this PR disables |
| 6 | The prize pot keeps cents instead of flooring | **Rejected.** Decision D23 (an exact pot to the cent), confirmed by Kevin on 2026-11-11 and recorded in `PLAN-SQUARES-REOPEN.md` | — (code is #759's) |
| 7 | Pausing still records event winners | **Accepted as a doc defect.** The behaviour is deliberate and written down (D18; `lib/squaresPause.ts`): an Every-Score-Pays event is noted at $0 as it happens because it cannot be rebuilt later, and its prize waits for the reconcile. But HANDOFF's emergency step said a pause records "nothing" | HANDOFF's step corrected — on #761 (`14cdec9c`), where the runbook ships |
| 8 | The kickoff check runs before the transaction, so a link can land just after kickoff | **Accepted** | The clock is asked again inside the transaction, right before the write. **Not covered by a test**: the gap is between two `Date.now()` calls, and controlling it in the emulator would mean mocking the clock across the whole callable. The check is the same call the outer one makes, which is tested |
| 9 | A new game's badges can show the old game's teams | **Accepted** | The link clears `homeTeamLogo`, `awayTeamLogo`, `seasonType`, `week` and then writes those the feed gives. Emulator test |
| 10 | The README uses a green circle, which is not one of the docs' status markers | **Accepted** (`mmp-docs-and-writing`: ✅ ⚠️ ⛔ ▶️) | ✅ — on #761 (`14cdec9c`) |

**Mutation check on the new code (round Q1):** 7 mutants, **7 red**:
- the started check ignores `gameTime`;
- a game change is not refused, with both conditions removed and then each one alone;
- the scores are carried over to the new game;
- the old badges are kept;
- a re-link of the same game is treated as a change.

The in-transaction kickoff re-check (finding 8) was not mutated, because no test reaches it (above).

**Self-review of the round Q1 code.** One consequence of finding 2's fix is worth stating. The score sync updates `scores.startTime` from the feed, but nothing updates `gameTime` after the link. So a game that is **postponed** past its linked kickoff reads as "started" from the original time:
- the grid cannot be reopened;
- non-owners cannot reserve.

This matters only on a grid still unlocked at the original kickoff, because the link sets the auto-lock for that time. The remedy is to re-link the same game: the link reads the feed's new kickoff, passes the clock check and rewrites `gameTime`. This is accepted rather than adding a sync-side writer of `gameTime`, which would make the field the rule protects writable by the feed path.

## Round Q2 — qodo's re-review at `cace846f` (2026-11-11)

| # | qodo's finding | Verdict | What changed |
|---|---|---|---|
| 1 | 🛑 A played pool can still be moved: **unlink** (no play check) → clear its scores (allowed on an unlinked pool) → link another game. The old score history and the sync's dedupe markers stay | **Accepted — real; a hole in round Q1's own fix.** The Q1 guard read only the scores, which the commissioner controls once the pool is unlinked, and the winner records, which an unlocked grid never has | "Played" now also reads what only the server writes: the sync's `SCORE_STEP:` and `WINNER_EVENT…` markers in `audit_dedupe`. Firestore rules give clients no access to that collection, so it falls under the default deny. Only those key prefixes are read: the reminder jobs write other keys there, and a reminder is not play. A game change also clears the pool's `scoreEvents` history. Unlink stays allowed, because any later link of another game is refused. 4 new emulator tests: three marker kinds, plus a reminder key that must **not** block |

**Mutation check (round Q2):** 4 mutants, **4 red**:
- the score-step markers are ignored;
- the event markers are ignored;
- any dedupe key counts as play;
- the score history is kept.

**What this round confirms about round Q1:** code written to close a finding has never been reviewed. Q1's guard was checked against the attack as qodo described it, and that was not enough: it read state the attacker controls. The question to ask of every guard is whether the caller can change what it reads.

## Round X1 — codex, first round (2026-11-11)

`codex exec review -c model=gpt-5.6-terra --base origin/claude/squares-reopen`,
on this PR's own increment. codex was logged in for the first time in this
session, with the environment's `OPENAI_API_KEY`; its default model is not
available to that key.

| # | codex's finding | Verdict | What changed |
|---|---|---|---|
| 1 | P1: one write can switch Manual Score Override OFF and change the scores. The rule read only the STORED flag, so it allowed the scores, leaving a linked, locked pool that claims feed scoring with typed scores. `recomputeSquaresWinners` could record payouts from them before the next sync corrected them | **Accepted — real.** The same class of error as qodo round Q2: a guard that reads state the caller controls, here the "before" half of a write that also changes it | `handScored` needs the override ON both before and after the write. 2 rule cases: the combined write is refused, and turning the override off alone is allowed. Mutant: the old one-sided check fails the new case |

Merged in with this round: #760's codex fix (`squaresGameLink` keeps scores
only for the same game). This PR's server path already started a different
game from fresh scores; the manage page's client link that #760 fixed is
replaced here by the callable.

## Round X2 — codex, second round, at `09553dbd` (2026-11-11)

| # | codex's finding | Verdict | What changed |
|---|---|---|---|
| 1 | P1: the rule is scoped to `type == 'SQUARES'`, so a squares pool with NO `type` is not covered and its managers can still write every protected field. The server treats a typeless pool as squares (`isSquares` in `squaresAdmin.ts`, `lockPool`) | **Accepted — real.** The app was squares-only before `type` existed, and every server path already reads a missing type as squares | `isSquares` is now true for `'SQUARES'`, a missing type and `null`. NFL pools are unaffected: every NFL rule already requires an NFL type. 4 rule cases (48 assertions); mutant (scope back to `'SQUARES'` only): 3 of them red |

**Also in this round: a defect from the #760 merge, found by the emulator suite, not by a reviewer.** #760's codex fix made `squaresGameLink` keep scores only when told the pool's current game. This PR's callable did not pass it, so re-linking the SAME game lost the scores. Fixed (the callable passes `gameId`); mutant (always claim the same game) red.

## Round X3 — codex, third round, at `bae951a6` (2026-11-11)

| # | codex's finding | Verdict | What changed |
|---|---|---|---|
| 1 | P1: `createPool` checks kickoff against `now`, read at the top of the call, before billing, config and the feed request (with its retry). A game that kicks off during those steps is still linked | **Accepted — real, narrow** (a window of seconds) | The check after the lookup reads the clock then (`Date.now()`), and the creation transaction looks once more before it writes a linked squares pool. **Not covered by a test**, like round Q1's finding 8: the gap is between clock reads inside one call. Both checks are the same comparison the tested one makes |

**Round X4 — codex, fourth round, at `bab9a42d`:** "No discrete correctness issues were identified." codex has converged on this PR (4 rounds: 3 findings, all real, all fixed). Gates on this tree: root 3893, functions 2534, emulator 982 (2 expected fail, 10 skipped), rules 15/15 (48 squares assertions), tsc + build, functions typecheck + build, lint 1841.
