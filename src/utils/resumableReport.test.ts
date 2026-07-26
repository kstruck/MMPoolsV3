import { describe, it, expect } from 'vitest';
import { foldParkedReport, snapshotReport, type ResumableReport } from './resumableReport';

/**
 * PLAN-PAYMENT-TRUTH P4, codex r5. The behaviour under test is the migration
 * EVIDENCE path: a backfill that timed out mid-sweep and was resumed must report
 * the whole job, not just the pages the final click happened to cover.
 */

/** The concrete counters these cases assert on. The production report is wider;
 *  `ResumableReport`'s index signature keeps `unknown` for everything else. */
interface TestReport extends ResumableReport {
  ok: boolean;
  dryRun: boolean;
  poolsScanned: number;
  finishedPoolsSkipped: number;
  membersCreated: number;
  resumeFrom: string | null;
  error: string | null;
}

const fresh = (): TestReport => ({
  ok: true,
  dryRun: true,
  poolsScanned: 0,
  finishedPoolsSkipped: 0,
  membersCreated: 0,
  resumeFrom: null,
  error: null,
  failures: [],
});

describe('foldParkedReport', () => {
  it('adds the parked counters into the resuming run', () => {
    const target = fresh();
    target.poolsScanned = 4;
    target.membersCreated = 40;

    foldParkedReport(target, { ...fresh(), poolsScanned: 10, membersCreated: 130, failures: [] });

    expect(target.poolsScanned).toBe(14);
    expect(target.membersCreated).toBe(170);
  });

  it('leaves the resuming run OWN non-numeric state alone', () => {
    // The parked snapshot's ok/error/resumeFrom describe the run that DIED.
    // Carrying them forward would mark a healthy resumed run as failed.
    const target = fresh();
    foldParkedReport(target, {
      ...fresh(),
      ok: false,
      error: 'deadline-exceeded',
      resumeFrom: 'poolXYZ',
      dryRun: false,
      failures: [],
    });

    expect(target.ok).toBe(true);
    expect(target.error).toBeNull();
    expect(target.resumeFrom).toBeNull();
    expect(target.dryRun).toBe(true);
  });

  it('concatenates failures instead of replacing them', () => {
    const target = fresh();
    target.failures.push({ poolId: 'late', error: 'boom' });
    foldParkedReport(target, { ...fresh(), failures: [{ poolId: 'early', error: 'bang' }] });

    expect(target.failures).toHaveLength(2);
    expect(target.failures).toContainEqual({ poolId: 'early', error: 'bang' });
  });

  it('picks up a counter that did not exist on the target', () => {
    // The guard against a counter added later silently vanishing from a resumed
    // total — it would read low rather than throw, so nothing else would catch it.
    const target = fresh();
    foldParkedReport(target, { ...fresh(), someNewCounter: 7, failures: [] });
    expect(target.someNewCounter).toBe(7);
  });

  it('does not double-count across repeated resumes', () => {
    // Two timeouts in a row. Each parked snapshot holds the RUNNING total and each
    // resuming report starts at zero, so three clicks must total 6 pages, not more.
    let live = fresh();
    live.poolsScanned = 2;
    let parked = snapshotReport(live);

    live = foldParkedReport(fresh(), parked);
    live.poolsScanned += 2;
    parked = snapshotReport(live);

    live = foldParkedReport(fresh(), parked);
    live.poolsScanned += 2;

    expect(live.poolsScanned).toBe(6);
  });
});

describe('snapshotReport', () => {
  it('copies the failures array so later pages cannot leak into the checkpoint', () => {
    const live = fresh();
    live.failures.push({ poolId: 'a' });

    const parked = snapshotReport(live);
    live.failures.push({ poolId: 'b' }); // happens AFTER the checkpoint

    expect(parked.failures).toHaveLength(1);
    expect(live.failures).toHaveLength(2);
  });

  it('carries the counters at the moment of the snapshot', () => {
    const live = fresh();
    live.poolsScanned = 9;
    const parked = snapshotReport(live);
    live.poolsScanned = 99;

    expect(parked.poolsScanned).toBe(9);
  });
});
