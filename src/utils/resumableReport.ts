/**
 * Folding a parked migration report into the run that resumes it.
 *
 * Extracted from OperationsPanel's `runBackfill` so it can be tested without
 * standing up firebase. It exists because of codex r5 on PLAN-PAYMENT-TRUTH P4:
 * the resume checkpoint originally stored only the paging cursor, so a run that
 * timed out and was restarted reported ONLY the pages it personally did — and
 * could finish `ok: true` while doing so. For a money migration the dry run's
 * counters are the evidence Kevin reads before authorising the live pass, so an
 * undercount there is the failure, not a cosmetic gap.
 *
 * Idempotent across repeated resumes: the parked partial always holds the
 * RUNNING total and the resuming report always starts at zero, so folding
 * cannot double-count. (Run 1 parks A+B; run 2 starts at 0, folds A+B, adds
 * C+D, parks A+B+C+D; run 3 folds that.)
 */

/** A paged migration report: named counters plus one unbounded failures list. */
export interface ResumableReport {
  failures: unknown[];
  [key: string]: unknown;
}

/**
 * Add `parked`'s progress into `target`, in place, and return it.
 *
 * Sums every NUMERIC key rather than a hardcoded list, so a counter added to the
 * report later cannot silently drop out of a resumed total — that omission would
 * be invisible, since the number would simply read low rather than error.
 * Non-numeric keys (`ok`, `dryRun`, `resumeFrom`, `error`, …) are the resuming
 * run's own state and are deliberately left alone.
 */
export function foldParkedReport<T extends ResumableReport>(target: T, parked: ResumableReport): T {
  addReportPage(target, parked);
  if (Array.isArray(parked.failures)) target.failures.push(...parked.failures);
  return target;
}

/**
 * Add ONE PAGE of a migration report into the running aggregate, in place.
 *
 * 🛑 THIS EXISTS BECAUSE THE PER-PAGE LOOPS HAND-MAINTAINED A LIST OF COUNTERS
 * AND THREE OF THEM WENT MISSING IN PRODUCTION.
 *
 * `foldParkedReport` above already summed every numeric key, and its own doc
 * block says why: "a counter added to the report later cannot silently drop out
 * of a resumed total — that omission would be invisible, since the number would
 * simply read low rather than error." The RESUME path learned that. The per-page
 * accumulation in `OperationsPanel`, one function over, did not: it listed the
 * fields it knew by name, so `entriesPaidNotLiable` (added with the not-liable
 * guard), `staleSummariesRepaired` (the duplicate-ledger fix) and `countsStamped`
 * (the partial-dues backfill) were all returned by the server, dropped by the
 * client, and absent from the Run Log an operator reads before authorising a
 * LIVE money migration. `poolsSkipped` on the member-record backfill was going
 * the same way.
 *
 * The tell that this was a CLASS and not three slips: the `squaresSkipped` line
 * carries a comment explaining that without it "the counter never reaches the Run
 * Log and the narrowing is invisible to the operator". Somebody hit exactly this,
 * and fixed their one line instead of the shape.
 *
 * Sums NUMERIC keys only. Everything else on a report page — `ok`, `dryRun`,
 * `nextCursor`, the arrays — is either the caller's own state or needs bespoke
 * handling (`plannedFixes` is capped globally, not concatenated), so it is
 * deliberately left to the caller.
 *
 * ⚠️ This assumes every numeric field on a migration report is a COUNTER. That
 * holds for all of them today and is asserted by
 * `tests/ops-panel-report-coverage.test.ts`. A report that ever needs to return a
 * numeric NON-counter (an echoed limit, a timestamp) must not just add it — the
 * aggregate would sum it into nonsense.
 */
export function addReportPage<T extends ResumableReport>(
  target: T,
  page: Record<string, unknown>,
): T {
  const acc = target as ResumableReport;
  for (const [key, value] of Object.entries(page)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const current = acc[key];
    acc[key] = (typeof current === 'number' ? current : 0) + value;
  }
  return target;
}

/**
 * Snapshot a live report for parking. The failures array is COPIED: the caller
 * keeps mutating the original after the checkpoint is taken, and an aliased array
 * would let later pages leak into an earlier snapshot.
 */
export function snapshotReport<T extends ResumableReport>(report: T): ResumableReport {
  return { ...report, failures: [...report.failures] };
}
