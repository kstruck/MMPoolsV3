---
name: mmp-loop-e2e-nightly
description: Run the create-pool Playwright e2e suite and report pass rate vs the 95% target. Read-only reporting. Use when asked to run the nightly e2e sweep or check e2e health.
---

# Nightly E2E Sweep

Loop 3 of 5 (build order and activation ledger: `docs/plans/PLAN-LOOPS.md`). Read-only reporting, no mutation beyond
the test run itself. **Not yet activated** — manual invoke only until Kevin approves
scheduling.

## ✅ Blocking dependency RESOLVED — 2026-07-12

`feat/wizard-unification` merged to main via PR #117 (2026-07-04). Per
**mmp-validation-and-qa** §7: "this repo's `tests/e2e/` (create-pool.spec.ts,
admin-claims.spec.ts, global-setup.ts, helpers.ts) IS the canonical e2e
surface." The worktree dependency below is obsolete — the suite now lives in
the main tree, no separate worktree needed. This loop is unblocked; it
remains **not yet activated** (manual invoke only) purely pending Kevin's
scheduling approval, not the dependency issue described below (kept for
historical context — do not act on it).

## Steps

1. Confirm the e2e worktree exists and is on the expected branch.
2. Start the e2e dev server on the dedicated port **5199** with `--strictPort` and
   `reuseExistingServer:false` — never trust a Claude preview MCP instance for this, it
   serves the main-tree app on 5173, a different checkout entirely.
3. Run the Playwright suite (`create-pool` suite, 7 tests as of last known-green state).
4. **Verify (real gate):** pass rate ≥ 95%, the team's existing target — not "the run
   completed."
5. On any failure, capture the specific failing test + error, not just a red/green count.
6. Append one row to `LOOP-LOG.tsv` at the repo root — one tab-separated row per run
   (`date loop commit verdict metric idea lesson`, spec in
   `docs/plans/PLAN-LOOPS.md`). Append only; never rewrite an earlier row.
   **A run that could not evaluate its verifier logs `INCONCLUSIVE`, never
   `CLEAN`**, and `metric` carries the number the verifier produced.
   `metric` is the pass rate (`7/7`, `94%`). Only ping Kevin on a run below
   target — stay silent on green runs, but still write the row.

## Rules

- Never run against the main dev server / main checkout — dedicated worktree + port
  5199 only, per the documented port-contention gotcha.
- Auth emulator needs `TestPass123!`-style passwords (upper-case + non-alphanumeric) —
  a plain password fails registration silently and shows up later as a timeout, not
  an auth error. Don't misdiagnose that class of failure as a real regression.
- Never `waitForLoadState('networkidle')` in these tests — Firestore's `onSnapshot`
  keeps the channel open, so it never resolves.
- Cheap-model pass for running + summarizing. Escalate to a heavier pass only if a
  failure needs real diagnosis (not just "which test failed").
- **Still parked** — manual invoke only until Kevin approves scheduled activation.
- 🖥️ **Windows box only.** Playwright here drives real Firebase emulators, which
  need a JDK; the cloud container has neither the JDK nor the worktree this skill
  assumes. This loop cannot move to the cloud without rebuilding what it runs
  against, so it stays where it works.
