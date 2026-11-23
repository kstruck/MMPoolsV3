# PLAN-PTS-LEFT-HIDDEN-TOTAL — review log

Sweeps: `PLAN-PTS-LEFT-HIDDEN-TOTAL-SWEEPS.md`.

## Review rounds

### Self-review, before codex

- **The first emulator run returned 0 for every total.** That was correct, not a bug. The test pool was an unstamped confidence pool, which still plays WEEKLY (legacy clause, `shared/nflLockMode.ts`), so its whole week had revealed. The test pool is now stamped `lockRuleVersion: 2`, like every real Pick'em pool created since the per-game lock plan.
- **A cancelled game is revealed in a confidence pool** (it has left SCHEDULED). That is existing behaviour, and the test asserts on the open games only.

### Round X1 — codex (`gpt-5.6-terra`), on `209c6fc1`

| # | Finding | Verdict |
|---|---|---|
| X1.1 [P1] | The new switch sat inside the settings form, which is read-only for non-SuperAdmin commissioners once the season starts (`canEditSettings`). So a default-on disclosure could not be turned off at the only time it applies. | **Valid — fixed.** The switch is now its own card with its own save (`NFLPointsLeftSharingSetting.tsx`), rendered beside branding outside the gate, which is the existing precedent for in-season settings. The server already allows it: `settings` is editable while the pool is open, and the in-season lock is UI-only. Tests: `pointsLeftSharingSetting.test.tsx` covers default on, stored off, the exact one-key save, and a source pin that it is outside the gated form. |

### Round X2 — codex, on `50cd1a89`

Clean.

### Round X3 — codex, on `b0d4f568` (the final diff after test-only fixes)

| # | Finding | Verdict |
|---|---|---|
| X3.1 [P2] | The server counted a FINAL with NO reported scores as decided, while `tallyGridRow` treats it as still winnable (the scorer grades it when scores arrive). A hidden pick on one would be left out, so Pts Left and Max would read low. | **Valid — fixed.** The server now uses the client's rule: decided = CANCELLED, or FINAL with `hasReportedScores`. The game read carries `scores` for it. Emulator test: a standard pool with one open game, one scoreless FINAL and one scored FINAL, all hidden, totals 2. Mutation-checked: the old rule fails it. |

### Round X4 — codex, on `ea850d97`

| # | Finding | Verdict |
|---|---|---|
| X4.1 [P2] | On a pool with `isLocked: true`, `buildPoolSettingsUpdate` refuses the whole `settings` group, so a commissioner still could not turn the switch off in season. | **Valid — fixed.** `LOCKED_PHASE_SETTINGS_KEYS` (`shareHiddenPointsLeft` only): a `settings` patch whose EVERY key is listed passes on a locked pool. A mixed patch or an empty one is still refused, so no rule can ride along, and archived pools stay read-only. Unit test covers all four cases. |
| X4.2 [P2] | With a hidden FINISHED game the row did not pick, Max still allowed for a pick there: one point high in standard scoring, "?" in confidence. | **Valid — fixed.** The hidden-decided allowance is now capped by the saved-pick count. In standard scoring, `hiddenLeft` is the number of hidden open picks, so those come off as well. A row whose count is fully explained shows an exact Max. Unit test covers both modes. |

### Round X5 — codex, on `2ef75c32`

Clean.

### Round Q1 — qodo, on `2ef75c32` (3 bugs)

| # | Finding | Verdict |
|---|---|---|
| Q1.1 | Week Results printed Max 0 when no games had loaded for the week, where the old guard showed "—". | **Valid — fixed.** With an empty slate, Pts Left and Max show "—". Render test added. |
| Q1.2 (security) | After a commissioner turns sharing off, members' pages keep showing cached totals until their next reveal poll. | **Valid — fixed.** Both pages gate `hiddenLeft` on `sharesHiddenPointsLeft(pool.settings)`, read from the LIVE pool document every member already subscribes to, so the totals disappear at once. The server still stops sending them on the next call. Render test for Week Results, plus a source pin on the grid. Thread left open for Kevin, per the security-finding rule. |
| Q1.3 | The `hiddenLeft` doc comment still said "not FINAL, not CANCELLED", the rule X3.1 replaced. | **Valid — fixed.** The comment now states the client's rule. |

### Round X6 — codex, on `dba6b69f`

| # | Finding | Verdict |
|---|---|---|
| X6.1 [P2] | Confidence mode: one saved hidden pick, a positive total, and both an open and a finished hidden game showed Max "?", although a positive total proves that pick is on the open game. | **Valid — fixed** (a precision gain; the "?" was never wrong). A positive confidence total accounts for at least one hidden open pick, since every weight is ≥ 1. Unit test added. |

### Round X7 — codex, on `ee629e2c`

| # | Finding | Verdict |
|---|---|---|
| X7.1 [P2] | An admin-closed pool keeps `isLocked: true` beside `status: COMPLETED`, so `normalizePhase` reads it as locked and the X4.1 exemption let this setting change on a finished pool. | **Valid — fixed.** The exemption now also requires a non-terminal status (`normalizePhase({ status })` is not `archived`). Unit test covers COMPLETED + isLocked. |
