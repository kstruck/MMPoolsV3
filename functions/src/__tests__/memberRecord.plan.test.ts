import { describe, it, expect } from 'vitest';
import { isProvableMember, planMembershipWrite } from '../lib/memberRecord';
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

    it('leaves the latch ABSENT on a create where the caller stated nothing', () => {
      // codex r1: the backfill-on-touch path (nflPools.ts:238) reaches the CREATE
      // branch for an existing participant with no Member Record, and that person
      // may already have an entry. Coercing undefined to false there records a
      // durable 'never entered' for someone who has. Absent = UNKNOWN.
      expect(dataOf(planMembershipWrite('p1', 'u1', facts(), null, NOW)).hasPlayableEntry).toBeUndefined();
    });

    it('stamps FALSE on a create where the caller DID state it (a brand-new join)', () => {
      expect(dataOf(planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: false }), null, NOW)).hasPlayableEntry).toBe(false);
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

/**
 * PLAN-SETPAIDSTATUS-MEMBERSHIP §4. Two checks, and the plan is emphatic that
 * there is no third: draft 4 accepted claimed-square ownership and round 5
 * removed it as attacker-settable.
 */
describe('isProvableMember', () => {
  const CANONICAL = { joinedAt: NOW };

  it('admits a CANONICAL Member Record even with no participantIds entry', () => {
    // The legacy member this heals: on the roster since before participantIds
    // was maintained everywhere.
    expect(isProvableMember({ participantIds: [] }, CANONICAL, 'u1')).toBe(true);
  });

  it('REFUSES a claim-only record — the forged shape', () => {
    // The round-3 P1. The vulnerable claim path writes exactly these two
    // fields, so treating mere existence as proof would let the fix ratify the
    // exploit: the forger stays on the roster and keeps receiving reminders.
    const forged = { memberReportedPaid: true, memberReportedAt: NOW };
    expect(isProvableMember({ participantIds: [] }, forged, 'u1')).toBe(false);
  });

  it('accepts a non-numeric joinedAt — backfill stamps pool.createdAt', () => {
    // backfillMemberRecords writes `pool.createdAt || Date.now()`, and a legacy
    // createdAt may be a Firestore Timestamp. A `typeof === number` check here
    // would refuse real backfilled members.
    expect(isProvableMember({ participantIds: [] }, { joinedAt: { seconds: 1 } }, 'u1')).toBe(true);
  });

  it('admits membership from participantIds with no record at all', () => {
    expect(isProvableMember({ participantIds: ['u1'] }, undefined, 'u1')).toBe(true);
  });

  it('REFUSES the literal "guest" sentinel', () => {
    // squares.ts inserts the string `guest` for an anonymous reservation. A
    // membership test that accepts any array element would admit an account
    // whose uid IS `guest` into every pool holding one anonymous square.
    expect(isProvableMember({ participantIds: ['guest'] }, undefined, 'guest')).toBe(false);
    // ...and it stays refused even holding a canonical record.
    expect(isProvableMember({ participantIds: ['guest'] }, CANONICAL, 'guest')).toBe(false);
  });

  it('REFUSES a stranger with no evidence at all', () => {
    expect(isProvableMember({ participantIds: ['someone-else'] }, undefined, 'u1')).toBe(false);
    expect(isProvableMember(undefined, undefined, 'u1')).toBe(false);
    expect(isProvableMember({}, undefined, 'u1')).toBe(false);
  });

  it('REFUSES when participantIds is not an array', () => {
    // Defensive: a malformed pool document must not throw out of an
    // authorization predicate, and must not admit.
    expect(isProvableMember({ participantIds: 'u1' as unknown }, undefined, 'u1')).toBe(false);
  });

  it('does NOT accept claimed-square ownership (the removed third check)', () => {
    // Round 5: `claimMySquares` stamps reservedByUid on proof of a
    // guestDeviceKey readable from the world-readable pool document, so this
    // signal is attacker-settable. Anyone reintroducing it fails here.
    const poolWithClaimedSquare = { participantIds: [], squares: [{ reservedByUid: 'u1' }] };
    expect(isProvableMember(poolWithClaimedSquare, undefined, 'u1')).toBe(false);
  });
});

/**
 * `pickedWeeks` — the Hidden/No-selection marker (PLAN-COMMISSIONER-BLIND-PICKS T1).
 *
 * It rides the Member Record write the submit path already makes, so the marker
 * cannot disagree with the pick it describes. Two properties are load-bearing:
 * it is UNION-ONLY, and it is written only when the caller actually reports a
 * pick — a join or backfill touch must leave the stored array alone.
 */
describe('planMembershipWrite — pickedWeeks', () => {
  const base = { userName: 'U', poolType: 'NFL_PICKEM', present: true } as const;

  /**
   * ⚠️ THE CREATE BRANCH IS ALSO THE BACKFILL-ON-TOUCH PATH.
   * `joinNFLPoolInternal` reaches it for a legacy participant who has no Member
   * Record and may already have weeks of picks, so seeding `[]` here would turn
   * "unknown" into "picked no week" — and the standings cell renders those two
   * differently ("—" vs "No selection"). codex r3 caught the first version doing
   * this, which is the same trap `hasPlayableEntry` documents one field above.
   */
  it('writes NOTHING on create when no pick is being reported', () => {
    const plan = planMembershipWrite('p1', 'u1', { ...base }, null, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toBeUndefined();
  });

  it('seeds [week] on create when the caller reports a pick', () => {
    const plan = planMembershipWrite('p1', 'u1', { ...base, pickedWeek: 3 }, null, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toEqual([3]);
  });

  it('unions into the existing array, sorted', () => {
    const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID', pickedWeeks: [3, 5] };
    const plan = planMembershipWrite('p1', 'u1', { ...base, pickedWeek: 4 }, existing, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toEqual([3, 4, 5]);
  });

  it('writes NOTHING when the week is already marked (idempotent re-submit)', () => {
    const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID', pickedWeeks: [3] };
    const plan = planMembershipWrite('p1', 'u1', { ...base, pickedWeek: 3 }, existing, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toBeUndefined();
  });

  /**
   * ⚠️ The regression this guards is silent and total. `ensureMemberRecord`
   * writes with `merge: true`, and Firestore merges MAPS, not array contents —
   * so writing `[]` on a join touch would REPLACE the stored array and erase
   * every marker the member had earned. The join path
   * (`joinNFLPoolInternal`) touches existing records on every re-join.
   */
  it('a join/backfill touch (no pickedWeek) leaves the stored array alone', () => {
    const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID', pickedWeeks: [1, 2] };
    const plan = planMembershipWrite('p1', 'u1', { ...base }, existing, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toBeUndefined();
  });

  it('heals a legacy record with no array at all', () => {
    const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID' };
    const plan = planMembershipWrite('p1', 'u1', { ...base, pickedWeek: 2 }, existing, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toEqual([2]);
  });

  it('never removes a week — the marker is one-way', () => {
    const existing: MemberRecord = { uid: 'u1', poolId: 'p1', userName: 'U', paidStatus: 'UNPAID', pickedWeeks: [1, 2, 3] };
    const plan = planMembershipWrite('p1', 'u1', { ...base, pickedWeek: 9 }, existing, NOW);
    if (plan.participant !== 'add') throw new Error('expected add');
    expect(plan.member.data.pickedWeeks).toEqual([1, 2, 3, 9]);
  });

  it('a removal still deletes the record outright, marker and all', () => {
    const plan = planMembershipWrite('p1', 'u1', { ...base, present: false, pickedWeek: 4 }, null, NOW);
    expect(plan).toEqual({ participant: 'remove', member: { op: 'delete' } });
  });
});
