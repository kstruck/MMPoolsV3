/**
 * Presentation helpers for the Ops Health card's stale-job verdicts.
 *
 * Separate from the component only so the branch logic is runnable in a test:
 * importing `SuperAdminBentoDashboard.tsx` pulls in `../firebase`, which
 * initialises Firebase at module load.
 */

/** Mirrors `StaleJob['reason']` in `functions/src/lib/heartbeat.ts`. */
export type StaleJobReason = 'never-ran' | 'stale' | 'failing';

/** Why a job is flagged, in the operator's words rather than the enum's. */
export const STALE_REASON_LABEL: Record<StaleJobReason, string> = {
  'never-ran': 'never ran',
  stale: 'overdue',
  failing: 'failing',
};

/**
 * "45m" / "3h" / "2d" — an exact minute count is noise at these scales.
 *
 * `null` means the job has never completed a run, which `findStaleJobs` reports
 * as `ageMinutes: null` alongside `reason: 'never-ran'`. It must not render as
 * "0m ago": a job that has never run is the most serious verdict of the three,
 * and zero reads as the most recent.
 */
export function formatJobAge(minutes: number | null): string {
  if (minutes === null) return 'never';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}
