import { describe, it, expect, vi } from 'vitest';

/**
 * Transition-only ops alerting on scheduledHealthCheck (availability audit #2 /
 * error-tracking 21c).
 *
 * TWO PROPERTIES, and the whole design exists because of them:
 *
 *  1. THE SECOND HOUR OF THE SAME OUTAGE MUST NOT PAGE. `findStaleJobs` returns
 *     the same entry every run until the job recovers, so state-based paging
 *     would send an identical alert hourly until someone muted it — and a muted
 *     pager is how the NEXT outage is missed.
 *  2. AN UNDELIVERED PAGE MUST NOT COUNT AS DELIVERED. `dispatchOpsAlert`
 *     returns "failed" rather than throwing, so marking the condition alerted
 *     before knowing the outcome would burn the transition and the page would
 *     never go out at all.
 *
 * Both are trivially easy to regress into (one is `if (failing.length)`), and
 * neither is visible from reading the diff, which is why they are tested here
 * rather than argued about in review.
 */

// adminHealth.ts touches the admin SDK at import; stub it before the import.
vi.mock('firebase-admin', () => {
  const firestore = () => ({});
  return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore };
});

import {
  planHealthAlerts,
  applyDispatchOutcomes,
  failingCheckKeys,
  staleJobKeys,
  MAX_ALERT_ATTEMPTS,
  type HealthAlertState,
  type HealthSnapshot,
} from '../adminHealth';
import type { StaleJob } from '../lib/heartbeat';

const snapshot = (checks: Record<string, boolean>): HealthSnapshot => ({
  at: 1,
  checks: Object.fromEntries(
    Object.entries(checks).map(([k, ok]) => [k, { label: k, ok, latencyMs: 1, detail: 'd' }]),
  ),
});

/** Runs one hourly cycle: plan → dispatch outcomes → next state. */
function cycle(
  prev: HealthAlertState | undefined,
  keys: string[],
  outcome: 'sent' | 'failed' | 'no-recipients' = 'sent',
): { dispatched: string[]; next: HealthAlertState } {
  const plan = planHealthAlerts(prev, keys);
  const outcomes = Object.fromEntries(plan.toDispatch.map((k) => [k, outcome] as const));
  return { dispatched: plan.toDispatch, next: applyDispatchOutcomes(plan, outcomes) };
}

describe('failing-condition keys', () => {
  it('names only the checks reporting ok:false', () => {
    expect(failingCheckKeys(snapshot({ espn: false, firestore: true, email: false })).sort())
      .toEqual(['check:email', 'check:espn']);
  });

  it('keys a stale job by name AND reason, so never-ran → failing is its own condition', () => {
    const stale: StaleJob[] = [
      { jobName: 'syncNFLScoresJob', reason: 'stale', ageMinutes: 90 },
      { jobName: 'autoLockPools', reason: 'never-ran', ageMinutes: null },
    ];
    expect(staleJobKeys(stale)).toEqual(['job:syncNFLScoresJob:stale', 'job:autoLockPools:never-ran']);
  });
});

describe('property 1 — transitions page, continuations do not', () => {
  it('pages on the first appearance of a failing check', () => {
    const { dispatched, next } = cycle(undefined, ['check:espn']);
    expect(dispatched).toEqual(['check:espn']);
    expect(next.alerted).toEqual(['check:espn']);
  });

  it('does NOT page again while the same check keeps failing', () => {
    const first = cycle(undefined, ['check:espn']);
    const second = cycle(first.next, ['check:espn']);
    const third = cycle(second.next, ['check:espn']);
    expect(second.dispatched).toEqual([]);
    expect(third.dispatched).toEqual([]);
    // …and it is still on the record as failing, just not on the pager.
    expect(third.next.alerted).toEqual(['check:espn']);
  });

  it('does NOT page again while the same job stays in the stale set (the hourly-repeat trap)', () => {
    const key = 'job:nflFinalizeSweepJob:stale';
    let state = cycle(undefined, [key]);
    expect(state.dispatched).toEqual([key]);
    for (let hour = 0; hour < 24; hour++) {
      state = cycle(state.next, [key]);
      expect(state.dispatched).toEqual([]);
    }
  });

  it('pages again after a recovery — a recurrence is a new transition', () => {
    const first = cycle(undefined, ['check:espn']);
    const recovered = cycle(first.next, []);
    expect(recovered.next.alerted).toEqual([]);
    const again = cycle(recovered.next, ['check:espn']);
    expect(again.dispatched).toEqual(['check:espn']);
  });

  it('pages only the NEW condition when one is added to an ongoing one', () => {
    const first = cycle(undefined, ['check:espn']);
    const second = cycle(first.next, ['check:espn', 'job:autoLockPools:never-ran']);
    expect(second.dispatched).toEqual(['job:autoLockPools:never-ran']);
    expect(second.next.alerted).toEqual(['check:espn', 'job:autoLockPools:never-ran']);
  });
});

describe('property 2 — only a SENT dispatch marks the condition alerted', () => {
  it('does not mark on "failed", and retries next run', () => {
    const first = cycle(undefined, ['check:email'], 'failed');
    expect(first.dispatched).toEqual(['check:email']);
    expect(first.next.alerted).toEqual([]);
    expect(first.next.attempts['check:email']).toBe(1);

    const second = cycle(first.next, ['check:email'], 'sent');
    expect(second.dispatched).toEqual(['check:email']);
    expect(second.next.alerted).toEqual(['check:email']);
    expect(second.next.attempts['check:email']).toBeUndefined();
  });

  it('treats "no-recipients" as undelivered too — an unconfigured pager is not a delivered page', () => {
    const first = cycle(undefined, ['check:email'], 'no-recipients');
    expect(first.next.alerted).toEqual([]);
    expect(first.next.attempts['check:email']).toBe(1);
  });

  it('treats a dispatched key with no recorded outcome as undelivered', () => {
    const plan = planHealthAlerts(undefined, ['check:espn']);
    const next = applyDispatchOutcomes(plan, {});
    expect(next.alerted).toEqual([]);
    expect(next.attempts['check:espn']).toBe(1);
  });

  it('bounds the retries — a broken pager is not hammered forever', () => {
    let state = cycle(undefined, ['check:email'], 'failed');
    for (let i = 1; i < MAX_ALERT_ATTEMPTS; i++) {
      state = cycle(state.next, ['check:email'], 'failed');
      expect(state.dispatched).toEqual(['check:email']);
    }
    expect(state.next.attempts['check:email']).toBe(MAX_ALERT_ATTEMPTS);

    const afterCap = cycle(state.next, ['check:email'], 'failed');
    expect(afterCap.dispatched).toEqual([]);
    expect(afterCap.next.attempts['check:email']).toBe(MAX_ALERT_ATTEMPTS);
  });

  it('re-arms after recovery even when retries were abandoned', () => {
    let state = cycle(undefined, ['check:email'], 'failed');
    for (let i = 1; i <= MAX_ALERT_ATTEMPTS; i++) state = cycle(state.next, ['check:email'], 'failed');
    const recovered = cycle(state.next, []);
    expect(recovered.next.attempts).toEqual({});
    const again = cycle(recovered.next, ['check:email'], 'sent');
    expect(again.dispatched).toEqual(['check:email']);
  });
});

describe('plan bookkeeping', () => {
  it('separates continuation, abandonment and recovery', () => {
    const prev: HealthAlertState = {
      alerted: ['check:espn'],
      attempts: { 'check:email': MAX_ALERT_ATTEMPTS, 'job:gone:stale': 1 },
    };
    const plan = planHealthAlerts(prev, ['check:espn', 'check:email', 'check:firestore']);
    expect(plan.alreadyAlerted).toEqual(['check:espn']);
    expect(plan.abandoned).toEqual(['check:email']);
    expect(plan.toDispatch).toEqual(['check:firestore']);
    expect(plan.recovered).toEqual(['job:gone:stale']);
  });

  it('de-duplicates repeated keys rather than paging twice for one condition', () => {
    const plan = planHealthAlerts(undefined, ['check:espn', 'check:espn']);
    expect(plan.toDispatch).toEqual(['check:espn']);
  });
});
