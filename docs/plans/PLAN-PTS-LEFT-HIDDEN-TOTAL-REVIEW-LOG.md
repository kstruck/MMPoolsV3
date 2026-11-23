# PLAN-PTS-LEFT-HIDDEN-TOTAL — review log

Sweeps: `PLAN-PTS-LEFT-HIDDEN-TOTAL-SWEEPS.md`.

## Review rounds

### Self-review, before codex

- **The first emulator run returned 0 for every total.** That was correct, not a bug. The test pool was an unstamped confidence pool, which still plays WEEKLY (legacy clause, `shared/nflLockMode.ts`), so its whole week had revealed. The test pool is now stamped `lockRuleVersion: 2`, like every real Pick'em pool created since the per-game lock plan.
- **A cancelled game is revealed in a confidence pool** (it has left SCHEDULED). That is existing behaviour, and the test asserts on the open games only.
