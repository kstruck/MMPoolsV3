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
  const acc = target as ResumableReport;
  for (const [key, value] of Object.entries(parked)) {
    if (typeof value !== 'number') continue;
    const current = acc[key];
    acc[key] = (typeof current === 'number' ? current : 0) + value;
  }
  if (Array.isArray(parked.failures)) target.failures.push(...parked.failures);
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
