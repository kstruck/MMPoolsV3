import { describe, it, expect } from 'vitest';
import { planMembershipWrite } from '../lib/memberRecord';
import type { MemberRecord } from '../shared/memberRecord';

const NOW = 1_700_000_000_000;

describe('planMembershipWrite', () => {
  it('removes participant + deletes record when the uid is no longer present', () => {
    const plan = planMembershipWrite('p1', 'u1', { userName: 'U', poolType: 'NFL_PICKEM', present: false }, null, NOW);
    expect(plan).toEqual({ participant: 'remove', member: { op: 'delete' } });
  });

  it('seeds payment defaults on first create (merge=false)', () => {
    const plan = planMembershipWrite('p1', 'u1', { userName: 'U', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true }, null, NOW);
    expect(plan.participant).toBe('add');
    if (plan.participant !== 'add') return;
    expect(plan.member.merge).toBe(false);
    expect(plan.member.data).toMatchObject({ uid: 'u1', poolId: 'p1', userName: 'U', role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: NOW });
  });

  it('never clobbers paidStatus on update (merge, no payment fields)', () => {
    const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'Old', paidStatus: 'PAID', paidBy: 'commish' };
    const plan = planMembershipWrite('p1', 'u1', { userName: 'New', poolType: 'NFL_PICKEM', present: true }, existing, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.merge).toBe(true);
    expect(plan.member.data.paidStatus).toBeUndefined();
    expect(plan.member.data.userName).toBe('New');
  });

  it('carries units for squares members', () => {
    const plan = planMembershipWrite('p1', 'u1', { userName: 'U', poolType: 'SQUARES', present: true, unitsOwned: 6 }, null, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.unitsOwned).toBe(6);
  });

  /**
   * hasPlayableEntry is persisted as a ONE-WAY LATCH (2026-07-31). It used to be
   * computed here and thrown away — only its effect on feeOwed survived — so
   * nothing could ask a Member Record "has this person ever entered?" without
   * also joining the entries collection.
   *
   * The dangerous direction is DOWN. `ensureMemberRecord` is called on every
   * re-join touch (nflPools.ts:238) with the fact left undefined; a naive
   * `!!facts.hasPlayableEntry` on the update branch would clear the flag for
   * anyone who had already submitted.
   */
  describe('hasPlayableEntry latch', () => {
    const facts = (over: Record<string, unknown> = {}) =>
      ({ userName: 'U', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true, ...over } as never);
    const dataOf = (plan: ReturnType<typeof planMembershipWrite>) => {
      if (plan.participant !== 'add') throw new Error('expected add');
      return plan.member.data;
    };

    it('stamps FALSE on a create that is not a submit (creation and join paths)', () => {
      expect(dataOf(planMembershipWrite('p1', 'u1', facts(), null, NOW)).hasPlayableEntry).toBe(false);
    });

    it('stamps FALSE for the seeded MANAGER — hosting is not playing at t=0', () => {
      const d = dataOf(planMembershipWrite('p1', 'own', facts({ role: 'MANAGER', entryFee: 20, hasPlayableEntry: false }), null, NOW));
      expect(d.hasPlayableEntry).toBe(false);
      expect(d.feeOwed).toBe(0);
    });

    it('stamps TRUE when the create IS the submit', () => {
      expect(dataOf(planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true }), null, NOW)).hasPlayableEntry).toBe(true);
    });

    it('UPGRADES false -> true on first submit', () => {
      const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID', hasPlayableEntry: false };
      expect(dataOf(planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true }), existing, NOW)).hasPlayableEntry).toBe(true);
    });

    it('NEVER lowers true -> false when a join touch omits the fact', () => {
      // The regression that matters: re-joining must not un-submit you.
      const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'PAID', hasPlayableEntry: true };
      expect(dataOf(planMembershipWrite('p1', 'u1', facts(), existing, NOW)).hasPlayableEntry).toBeUndefined();
    });

    it('writes nothing when the latch is already true and the fact repeats it', () => {
      // Idempotent: a re-submit must not churn the field.
      const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'PAID', hasPlayableEntry: true };
      expect(dataOf(planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true }), existing, NOW)).hasPlayableEntry).toBeUndefined();
    });

    it('heals a pre-2026-07-31 record that has no field at all, on first submit', () => {
      const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID' };
      expect(dataOf(planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true }), existing, NOW)).hasPlayableEntry).toBe(true);
    });

    it('leaves a pre-2026-07-31 record ALONE on a non-submit touch', () => {
      // Absent must stay absent rather than being stamped false, or a member who
      // has already played would be recorded as never having played.
      const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID' };
      expect(dataOf(planMembershipWrite('p1', 'u1', facts(), existing, NOW)).hasPlayableEntry).toBeUndefined();
    });
  });
});
