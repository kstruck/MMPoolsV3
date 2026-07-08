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
});
