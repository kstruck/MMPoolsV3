import { describe, it, expect } from 'vitest';
import { planMembershipWrite } from '../lib/memberRecord';
import { memberDues, type MemberRecord } from '../shared/memberRecord';
import { reduceAwards } from '../shared/payoutRecords';

// PLAN-PLAYER-PROFILES Phase 4 (ADR 0005 decision 3): feeOwed as the single
// base-dues source + the payout award reducer Profit derives from.

const NOW = 1_700_000_000_000;

describe('planMembershipWrite — feeOwed stamping', () => {
  it('participant first-create stamps feeOwed = entryFee, LIVE', () => {
    const plan = planMembershipWrite('p1', 'u1',
      { userName: 'U', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true, entryFee: 25 },
      null, NOW);
    expect(plan.participant).toBe('add');
    if (plan.participant === 'add') {
      expect(plan.member.data.feeOwed).toBe(25);
      expect(plan.member.data.feeOwedSource).toBe('LIVE');
    }
  });

  it('seeded owner (MANAGER, no playable entry) stamps feeOwed 0 — hosting is not playing', () => {
    const plan = planMembershipWrite('p1', 'host',
      { userName: 'H', role: 'MANAGER', poolType: 'NFL_PICKEM', present: true, entryFee: 25, hasPlayableEntry: false },
      null, NOW);
    if (plan.participant === 'add') {
      expect(plan.member.data.feeOwed).toBe(0);
    }
  });

  it('owner upgrades 0 -> fee when they commit a playable entry', () => {
    const existing = { uid: 'host', poolId: 'p1', userName: 'H', paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE' } as unknown as MemberRecord;
    const plan = planMembershipWrite('p1', 'host',
      { userName: 'H', role: 'MANAGER', poolType: 'NFL_PICKEM', present: true, entryFee: 25, hasPlayableEntry: true },
      existing, NOW);
    if (plan.participant === 'add') {
      expect(plan.member.data.feeOwed).toBe(25);
    }
  });

  it('heals a pre-feeOwed record on touch, but never rewrites an existing stamp', () => {
    const legacy = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID' } as unknown as MemberRecord;
    const healed = planMembershipWrite('p1', 'u1',
      { userName: 'U', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true, entryFee: 25 },
      legacy, NOW);
    if (healed.participant === 'add') expect(healed.member.data.feeOwed).toBe(25);

    const stamped = { ...legacy, feeOwed: 20, feeOwedSource: 'LIVE' } as unknown as MemberRecord;
    const untouched = planMembershipWrite('p1', 'u1',
      { userName: 'U', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true, entryFee: 25 },
      stamped, NOW);
    if (untouched.participant === 'add') {
      // fee changes flow through the entryFee-edit cascade, not membership touches
      expect(untouched.member.data.feeOwed).toBeUndefined();
    }
  });

  it('no entryFee supplied -> no feeOwed field (legacy callers unchanged)', () => {
    const plan = planMembershipWrite('p1', 'u1',
      { userName: 'U', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true },
      null, NOW);
    if (plan.participant === 'add') expect(plan.member.data.feeOwed).toBeUndefined();
  });
});

describe('memberDues — feeOwed preference', () => {
  const base = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID' } as unknown as MemberRecord;

  it('prefers the per-record feeOwed over the pool fee', () => {
    const m = { ...base, feeOwed: 0 } as MemberRecord; // seeded owner who never played
    expect(memberDues(m, { poolType: 'NFL_PICKEM', entryFee: 25 }).expected).toBe(0);
  });

  it('falls back to the pool fee for pre-stamp records', () => {
    expect(memberDues(base, { poolType: 'NFL_PICKEM', entryFee: 25 }).expected).toBe(25);
  });
});

describe('reduceAwards — Profit source reducer', () => {
  it('sums non-superseded awards per uid; settled state is irrelevant to won', () => {
    const totals = reduceAwards([
      { uid: 'a', amount: 100, kind: 'PLACE', recordedAt: 1, schemaVersion: 1 },
      { uid: 'a', amount: 25, kind: 'BONUS', recordedAt: 2, schemaVersion: 1 },
      { uid: 'b', amount: 50, kind: 'PLACE', recordedAt: 3, schemaVersion: 1 },
    ]);
    expect(totals.byUid).toEqual({ a: 125, b: 50 });
    expect(totals.total).toBe(175);
  });

  it('skips superseded records so corrections reconcile', () => {
    const totals = reduceAwards([
      { uid: 'a', amount: 100, kind: 'PLACE', recordedAt: 1, supersededBy: 'x2', schemaVersion: 1 },
      { uid: 'a', amount: 80, kind: 'PLACE', recordedAt: 2, schemaVersion: 1 }, // the correction
    ]);
    expect(totals.byUid).toEqual({ a: 80 });
  });

  it('negative ADJUSTMENT lowers the total (overstatement fix)', () => {
    const totals = reduceAwards([
      { uid: 'a', amount: 100, kind: 'PLACE', recordedAt: 1, schemaVersion: 1 },
      { uid: 'a', amount: -20, kind: 'ADJUSTMENT', recordedAt: 2, schemaVersion: 1 },
    ]);
    expect(totals.byUid.a).toBe(80);
  });
});
