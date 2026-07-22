import { describe, it, expect } from 'vitest';
import {
  autoCloseVerdict,
  autoCloseDryRunVerdict,
  autoLockVerdict,
  billingEnforceVerdict,
  monetizationVerdict,
  monetizationDryRunVerdict,
  reminderPassVerdict,
  webhookSweepVerdict,
} from '../lib/heartbeatVerdicts';

/**
 * Per-job heartbeat verdicts, now that they are pure and exported.
 *
 * WHY THIS FILE EXISTS. Until now every one of these decisions lived inline in
 * a job body and had no test at all. The only guard was the source-level
 * ratchet in heartbeat.test.ts, which asks "does this handler have SOME path
 * that reports failure" — it cannot ask whether the verdict is RIGHT. Deleting
 * autoLock's failure count produced no build error and no test failure. That
 * was verified, not assumed, and it is the gap this closes.
 *
 * Each helper is tested from both directions, because both directions are
 * failure modes with a history in this repo:
 *
 *   - a bad run must NOT report healthy (the silent-success bug), and
 *   - a normal quiet run must NOT report degraded (the cry-wolf bug, which
 *     gets a monitor ignored and then the real alert is missed).
 */

describe('autoCloseVerdict', () => {
  it('is healthy when nothing failed', () => {
    expect(autoCloseVerdict({ closed: 3, failed: 0, overflow: 0 }))
      .toEqual({ detail: { closed: 3, overflow: 0 } });
  });

  it('reports failure when a close threw, and says how many', () => {
    const v = autoCloseVerdict({ closed: 1, failed: 2, overflow: 0 });
    expect(v).toMatchObject({ ok: false, detail: { closed: 1, failed: 2 } });
    expect(v && 'error' in v && v.error).toMatch(/2 pool\(s\) failed to close/);
  });

  it('a run where EVERY close failed is not healthy', () => {
    expect(autoCloseVerdict({ closed: 0, failed: 5, overflow: 0 })).toMatchObject({ ok: false });
  });

  it('overflow alone is NOT a failure — the cap is working as designed', () => {
    // A genuine backlog would otherwise page every night.
    const v = autoCloseVerdict({ closed: 200, failed: 0, overflow: 40 });
    expect(v).toEqual({ detail: { closed: 200, overflow: 40 } });
    // No `ok` key at all — withHeartbeat treats its absence as healthy.
    expect((v as Record<string, unknown>).ok).toBeUndefined();
  });

  it('a quiet run with nothing to close is healthy', () => {
    expect(autoCloseVerdict({ closed: 0, failed: 0, overflow: 0 })).toEqual({
      detail: { closed: 0, overflow: 0 },
    });
  });
});

describe('autoCloseDryRunVerdict', () => {
  it('is healthy when the report was written', () => {
    expect(autoCloseDryRunVerdict(7, true)).toEqual({ detail: { dryRun: true, wouldClose: 7 } });
  });

  it('a dry run whose only output was lost is not healthy', () => {
    expect(autoCloseDryRunVerdict(7, false)).toMatchObject({
      ok: false,
      error: 'dry-run report not written',
      detail: { dryRun: true, wouldClose: 7 },
    });
  });
});

describe('autoLockVerdict', () => {
  it('a quiet minute with no due pools is healthy', () => {
    // This job runs every 60 seconds; most runs have nothing to do.
    expect(autoLockVerdict({ duePools: 0, failed: 0, invalidDeadlines: 0 }))
      .toEqual({ detail: { duePools: 0 } });
  });

  it('locking everything due is healthy', () => {
    expect(autoLockVerdict({ duePools: 4, failed: 0, invalidDeadlines: 0 }))
      .toEqual({ detail: { duePools: 4 } });
  });

  it('a failed lock is a failure — picks stay open past the deadline', () => {
    const v = autoLockVerdict({ duePools: 3, failed: 1, invalidDeadlines: 0 });
    expect(v).toMatchObject({ ok: false, detail: { duePools: 3, failed: 1 } });
    expect(v && 'error' in v && v.error).toMatch(/1 of 3 due pool\(s\) failed to lock/);
  });

  it('an unparseable lockAt is a failure even when nothing else went wrong', () => {
    // A data problem: silently skipped every minute, forever, and it will not
    // clear itself on the next run.
    const v = autoLockVerdict({ duePools: 0, failed: 0, invalidDeadlines: 2 });
    expect(v).toMatchObject({ ok: false });
    expect(v && 'error' in v && v.error).toMatch(/can never auto-lock/);
  });

  it('reports BOTH problems rather than only the first', () => {
    const v = autoLockVerdict({ duePools: 2, failed: 1, invalidDeadlines: 1 });
    expect(v && 'error' in v && v.error).toMatch(/failed to lock.*;.*can never auto-lock/);
    expect(v).toMatchObject({ detail: { duePools: 2, failed: 1, invalidDeadlines: 1 } });
  });
});

describe('billingEnforceVerdict', () => {
  it('a quiet night with no transitions due is healthy', () => {
    expect(billingEnforceVerdict({ trialToGrace: 0, graceToLocked: 0, failedTransitions: 0 }))
      .toEqual({ detail: { trialToGrace: 0, graceToLocked: 0 } });
  });

  it('a failed transition is a failure — that is free access nobody is told about', () => {
    const v = billingEnforceVerdict({ trialToGrace: 1, graceToLocked: 0, failedTransitions: 3 });
    expect(v).toMatchObject({ ok: false, detail: { failedTransitions: 3 } });
    expect(v && 'error' in v && v.error).toMatch(/3 billing transition\(s\) failed/);
  });

  it('counts survive into detail on the healthy path', () => {
    expect(billingEnforceVerdict({ trialToGrace: 2, graceToLocked: 5, failedTransitions: 0 }))
      .toEqual({ detail: { trialToGrace: 2, graceToLocked: 5 } });
  });
});

describe('monetizationVerdict', () => {
  it('finding no abuse is healthy — that is the normal state', () => {
    expect(monetizationVerdict({ created: 0, refreshed: 0, reopened: 0, failedUpserts: 0, audited: true }))
      .toEqual({ detail: { created: 0, refreshed: 0, reopened: 0 } });
  });

  it('a failed upsert is a failure', () => {
    const v = monetizationVerdict({ created: 1, refreshed: 0, reopened: 0, failedUpserts: 2, audited: true });
    expect(v).toMatchObject({ ok: false, detail: { failedUpserts: 2 } });
    expect(v && 'error' in v && v.error).toMatch(/2 alert upsert\(s\) failed/);
  });

  it('a lost run summary is a failure on its own', () => {
    const v = monetizationVerdict({ created: 3, refreshed: 0, reopened: 0, failedUpserts: 0, audited: false });
    expect(v).toMatchObject({ ok: false });
    expect(v && 'error' in v && v.error).toMatch(/run summary not written/);
  });

  it('reports both problems together', () => {
    const v = monetizationVerdict({ created: 0, refreshed: 0, reopened: 0, failedUpserts: 1, audited: false });
    expect(v && 'error' in v && v.error).toMatch(/upsert\(s\) failed;.*run summary not written/);
  });
});

describe('monetizationDryRunVerdict', () => {
  it('is healthy when the report landed', () => {
    expect(monetizationDryRunVerdict(4, true)).toEqual({ detail: { dryRun: true, wouldWrite: 4 } });
  });

  it('is a failure when the dry run produced nothing readable', () => {
    expect(monetizationDryRunVerdict(4, false)).toMatchObject({
      ok: false,
      error: 'dry-run report not written',
    });
  });
});

describe('reminderPassVerdict', () => {
  it('a clean pass is healthy', () => {
    expect(reminderPassVerdict({ failedPools: 0 })).toEqual({ detail: { failedPools: 0 } });
  });

  it('a thrown pool is a failure — reminders are the last line before a missed lock', () => {
    const v = reminderPassVerdict({ failedPools: 2 });
    expect(v).toMatchObject({ ok: false, detail: { failedPools: 2 } });
    expect(v && 'error' in v && v.error).toMatch(/2 pool\(s\) failed during the reminder pass/);
  });
});

describe('webhookSweepVerdict', () => {
  it('finding nothing stuck and reporting cleanly is healthy', () => {
    expect(webhookSweepVerdict({ stuckCount: 0, delivery: 'sent', audited: true }))
      .toEqual({ detail: { stuckCount: 0 } });
  });

  it('FINDING stuck events is not itself a failure — the job did its job', () => {
    // Grading a successful alert as unhealthy conflates the monitor breaking
    // with the thing it monitors breaking.
    expect(webhookSweepVerdict({ stuckCount: 9, delivery: 'sent', audited: true }))
      .toEqual({ detail: { stuckCount: 9 } });
  });

  it('finding stuck events and reaching nobody is the worst case, and reports it', () => {
    const v = webhookSweepVerdict({ stuckCount: 4, delivery: 'failed', audited: true });
    expect(v).toMatchObject({ ok: false, detail: { stuckCount: 4 } });
    expect(v && 'error' in v && v.error).toMatch(/4 stuck event\(s\) found but ops page undelivered/);
  });

  it('a lost audit entry counts too, and both losses are named', () => {
    const v = webhookSweepVerdict({ stuckCount: 4, delivery: 'failed', audited: false });
    expect(v && 'error' in v && v.error)
      .toMatch(/ops page undelivered and audit entry not written/);
  });
});
