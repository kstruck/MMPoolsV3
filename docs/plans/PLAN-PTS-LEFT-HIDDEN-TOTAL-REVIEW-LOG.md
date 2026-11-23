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
