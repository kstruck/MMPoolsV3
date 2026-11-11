# REVIEW LOG — PLAN-SQUARES-SERVER-FIELDS

Rounds of review on `PLAN-SQUARES-SERVER-FIELDS.md` and its PR. Newest last.

| Round | Reviewer | Findings | Accepted | Rejected / open |
|---|---|---|---|---|
| S0 | self, before the first commit | 4 | 4 | — |
| M1 | mutation testing | 49 mutants, 48 red | — | 1 survivor (equivalent — see below) |
| — | codex | — | **OWED** | not available where this was built |
| — | qodo | — | pending | runs on the PR |

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
