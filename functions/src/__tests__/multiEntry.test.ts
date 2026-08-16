import { describe, it, expect } from 'vitest';
import { planMembershipWrite } from '../lib/memberRecord';
import {
  assertEntryAdmitted, assertEntryNameFree, entryCountWrite, entryHasPick, ownerStateAfter, pickOwnedEntry,
} from '../lib/multiEntry';
import { defaultEntryName, entryIdFor } from '../shared/multiEntry';
import { deriveEntryCount, memberLiableEntries, type MemberRecord } from '../shared/memberRecord';

/**
 * PLAN-MULTI-ENTRY T2 — the pure half. Every rule here is also exercised
 * end-to-end in `emulator/multiEntry.emulator.test.ts`; these pin the DECISIONS
 * (id scheme, fallback order, liability arithmetic, K11 flip) so a future edit
 * that moves one of them fails here first, in milliseconds.
 */
const NOW = 1_700_000_000_000;
const rec = (o: Partial<MemberRecord>): MemberRecord =>
  ({ uid: 'u1', poolId: 'p1', userName: 'Kev', paidStatus: 'UNPAID', joinedAt: NOW, ...o });

describe('K1 — entry identity', () => {
  it('entry #1 IS the uid; extras are index-PREFIXED with a colon', () => {
    expect(entryIdFor('mr_boss', 1)).toBe('mr_boss');
    expect(entryIdFor('mr_boss', 2)).toBe('e2:mr_boss');
    // The `_` suffix scheme the plan rejected would collide here; the prefix does not.
    expect(entryIdFor('a', 2)).not.toBe(entryIdFor('a_2', 1));
  });
  it('default entry name is "Name #n" for extras and absent for entry #1 (K5)', () => {
    expect(defaultEntryName('Kev', 1)).toBeUndefined();
    expect(defaultEntryName('Kev', 3)).toBe('Kev #3');
  });
});

describe('pickOwnedEntry — which owned doc is "entry n"', () => {
  const owned = [
    { id: 'u1', data: { ownerUid: 'u1' } },                             // legacy #1: no entryIndex
    { id: 'e2:u1', data: { ownerUid: 'u1', entryIndex: 2 } },
    { id: 'autoXYZ', data: { ownerUid: 'u1', entryIndex: 3 } },       // §0a fallback id
  ];
  it('prefers the deterministic id', () => {
    expect(pickOwnedEntry('u1', 2, owned)?.id).toBe('e2:u1');
  });
  it('a legacy doc with no entryIndex is entry #1', () => {
    expect(pickOwnedEntry('u1', 1, owned)?.id).toBe('u1');
  });
  it('falls back to the stored entryIndex when the deterministic id is not ours', () => {
    expect(pickOwnedEntry('u1', 3, owned)?.id).toBe('autoXYZ');
  });
  it('null when the entry does not exist yet', () => {
    expect(pickOwnedEntry('u1', 4, owned)).toBeNull();
  });
});

describe('the cap — from existence, inside the transaction', () => {
  const owned2 = [{ id: 'u1', data: {} }, { id: 'e2:u1', data: {} }];
  it('refuses an index beyond the pool max', () => {
    expect(() => assertEntryAdmitted({ maxEntriesPerUser: 2 }, { existing: null, owned: [], entryIndex: 3 }))
      .toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);
  });
  it('refuses CREATING once the owner holds max docs (even at a free index)', () => {
    expect(() => assertEntryAdmitted({ maxEntriesPerUser: 2 }, { existing: null, owned: owned2, entryIndex: 2 }))
      .toThrow(/MAX_ENTRIES_REACHED/);
  });
  it('a resubmit to an existing entry is never capped', () => {
    expect(() => assertEntryAdmitted({ maxEntriesPerUser: 2 }, { existing: { picks: {} }, owned: owned2, entryIndex: 2 })).not.toThrow();
  });
  it('legacy pool (setting absent) admits exactly one', () => {
    expect(() => assertEntryAdmitted(undefined, { existing: null, owned: [], entryIndex: 1 })).not.toThrow();
    expect(() => assertEntryAdmitted(undefined, { existing: null, owned: [], entryIndex: 2 })).toThrow(/ENTRY_INDEX_EXCEEDS_MAX/);
  });
});

describe('K5 — entryName unique per owner', () => {
  const owned = [{ id: 'u1', data: { entryName: 'Sharp' } }, { id: 'e2:u1', data: {} }];
  it('rejects a case-insensitive duplicate on ANOTHER of the owner\'s entries', () => {
    expect(() => assertEntryNameFree('  sharp ', { owned, ref: { id: 'e2:u1' } })).toThrow(/ENTRY_NAME_TAKEN/);
  });
  it('the entry keeping its own name is fine; trims to the cap', () => {
    expect(assertEntryNameFree('Sharp', { owned, ref: { id: 'u1' } })).toBe('Sharp');
    expect(assertEntryNameFree(' ' + 'x'.repeat(40), { owned, ref: { id: 'e2:u1' } })).toHaveLength(30);
  });
  it('blank is refused', () => {
    expect(() => assertEntryNameFree('   ', { owned, ref: { id: 'e2:u1' } })).toThrow(/ENTRY_NAME_EMPTY/);
  });
});

describe('ownerStateAfter — post-write count + roster', () => {
  it('counts only entries with a pick; the written doc by its POST-write shape', () => {
    const owned = [
      { id: 'u1', data: { picks: { g1: 'KC' } } },
      { id: 'e2:u1', data: { picks: {}, entryIndex: 2, entryName: 'Kev #2' } },  // empty pick'em sheet
    ];
    const s = ownerStateAfter(owned, { id: 'e3:u1', entryIndex: 3, entryName: 'Third', hasPick: true });
    expect(s.playableEntryCount).toBe(2);
    expect(s.entries).toEqual({
      'u1': { entryIndex: 1 },
      'e2:u1': { entryIndex: 2, name: 'Kev #2' },
      'e3:u1': { entryIndex: 3, name: 'Third' },
    });
  });
  it('a resubmit of an existing entry does not double count it', () => {
    const owned = [{ id: 'u1', data: { picks: { g1: 'KC' } } }];
    expect(ownerStateAfter(owned, { id: 'u1', entryIndex: 1, hasPick: true }).playableEntryCount).toBe(1);
  });
  it('entryHasPick', () => {
    expect(entryHasPick({ picks: {} })).toBe(false);
    expect(entryHasPick({ picks: { 1: 'KC' } })).toBe(true);
    expect(entryHasPick(null)).toBe(false);
  });
});

describe('D2 — liable entries', () => {
  it('participant: max(1, played); manager: played only', () => {
    expect(memberLiableEntries({ role: 'PARTICIPANT' })).toBe(1);
    expect(memberLiableEntries({ role: 'PARTICIPANT', playableEntryCount: 3 })).toBe(3);
    expect(memberLiableEntries({ role: 'MANAGER' })).toBe(0);
    expect(memberLiableEntries({ role: 'MANAGER', hasPlayableEntry: true })).toBe(1);
    expect(memberLiableEntries({ role: 'MANAGER', playableEntryCount: 2 })).toBe(2);
  });
  it('legacy manager charged before the latch existed counts 1', () => {
    expect(memberLiableEntries({ role: 'MANAGER', feeOwed: 25 })).toBe(1);
  });
  it('deriveEntryCount sums CANONICAL records only', () => {
    expect(deriveEntryCount([
      { joinedAt: 1, role: 'MANAGER', feeOwed: 0 },
      { joinedAt: 1, role: 'PARTICIPANT' },
      { joinedAt: 1, role: 'PARTICIPANT', playableEntryCount: 2 },
      { memberReportedPaid: true },                                     // forged (#344) — not a member
    ])).toBe(3);
  });
});

describe('D8 — entryCountWrite', () => {
  it('increments when present, derives + delta when absent, nothing on zero delta', () => {
    expect(entryCountWrite({ entryCount: 4 }, null, 1)).toHaveProperty('entryCount');
    expect(entryCountWrite({ entryCount: 4 }, null, 0)).toEqual({});
    expect(entryCountWrite({}, [{ joinedAt: 1, role: 'PARTICIPANT' }, { joinedAt: 1, role: 'PARTICIPANT' }], 1)).toEqual({ entryCount: 3 });
    expect(entryCountWrite({}, null, 1)).toEqual({});
  });
});

describe('planMembershipWrite × multi-entry', () => {
  const facts = (o: object) => ({ userName: 'Kev', role: 'PARTICIPANT', poolType: 'NFL_PICKEM', present: true, entryFee: 25, ...o });

  it('second entry: feeOwed 25 → 50, counter 2, delta +1, roster written', () => {
    const existing = rec({ role: 'PARTICIPANT', feeOwed: 25, hasPlayableEntry: true, playableEntryCount: 1 });
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true, playableEntryCount: 2, entries: { u1: { entryIndex: 1 }, 'e2:u1': { entryIndex: 2 } } }), existing, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data).toMatchObject({ feeOwed: 50, feeOwedSource: 'LIVE', playableEntryCount: 2 });
    expect(plan.member.data.entries).toEqual({ u1: { entryIndex: 1 }, 'e2:u1': { entryIndex: 2 } });
    expect(plan.member.liabilityDelta).toBe(1);
    expect(plan.member.paidReset).toBeUndefined();
  });

  it('K11: a PAID member adding an entry flips to UNPAID with the reset detail', () => {
    const existing = rec({ role: 'PARTICIPANT', feeOwed: 25, paidStatus: 'PAID', paidAt: 123, hasPlayableEntry: true, playableEntryCount: 1 });
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true, playableEntryCount: 2 }), existing, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data.paidStatus).toBe('UNPAID');
    expect(plan.member.paidReset).toEqual({ previousFeeOwed: 25, feeOwed: 50, paidAt: 123 });
  });

  it('a resubmit on the same entry changes nothing about money (no reset, delta 0)', () => {
    const existing = rec({ role: 'PARTICIPANT', feeOwed: 25, paidStatus: 'PAID', hasPlayableEntry: true, playableEntryCount: 1 });
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true, playableEntryCount: 1 }), existing, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data.feeOwed).toBeUndefined();
    expect(plan.member.data.paidStatus).toBeUndefined();
    expect(plan.member.liabilityDelta).toBe(0);
  });

  it('legacy record (latch only, stamped at an OLD fee) is not restamped by a same-liability submit', () => {
    const existing = rec({ role: 'PARTICIPANT', feeOwed: 20, hasPlayableEntry: true });
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true, playableEntryCount: 1 }), existing, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data.feeOwed).toBeUndefined();     // the cascade owns fee changes, not a submit
    expect(plan.member.data.playableEntryCount).toBe(1);  // …but the counter heals
  });

  it('the counter never goes down (K7)', () => {
    const existing = rec({ role: 'PARTICIPANT', feeOwed: 50, playableEntryCount: 2 });
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true, playableEntryCount: 1 }), existing, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data.playableEntryCount).toBeUndefined();
    expect(plan.member.data.feeOwed).toBeUndefined();
  });

  it('seeded manager: 0 → fee on the first playable entry, delta +1; a second entry → 2×', () => {
    const host = rec({ role: 'MANAGER', feeOwed: 0, hasPlayableEntry: false });
    const p1 = planMembershipWrite('p1', 'u1', facts({ role: 'MANAGER', hasPlayableEntry: true, playableEntryCount: 1 }), host, NOW);
    if (p1.participant !== 'add') throw new Error('add');
    expect(p1.member.data.feeOwed).toBe(25);
    expect(p1.member.liabilityDelta).toBe(1);
    const p2 = planMembershipWrite('p1', 'u1', facts({ role: 'MANAGER', hasPlayableEntry: true, playableEntryCount: 2 }), rec({ role: 'MANAGER', feeOwed: 25, hasPlayableEntry: true, playableEntryCount: 1 }), NOW);
    if (p2.participant !== 'add') throw new Error('add');
    expect(p2.member.data.feeOwed).toBe(50);
  });

  it('a join (no count reported) on a fresh participant is liability 1, no counter written', () => {
    const plan = planMembershipWrite('p1', 'u1', facts({}), null, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data.feeOwed).toBe(25);
    expect(plan.member.data.playableEntryCount).toBeUndefined();
    expect(plan.member.data.hasPlayableEntry).toBeUndefined();
    expect(plan.member.liabilityDelta).toBe(1);
  });

  it('a count > 0 always carries the latch (they cannot disagree)', () => {
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: false, playableEntryCount: 1 }), null, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    expect(plan.member.data.hasPlayableEntry).toBe(true);
  });
});

describe('K5 — generated default names are unique too (codex r1 P2)', () => {
  it('"Kev #3" already taken by an explicitly named entry 2 → entry 3 gets "Kev #3 (2)"', async () => {
    const { freeDefaultEntryName } = await import('../lib/multiEntry');
    const owned = [{ id: 'u1', data: {} }, { id: 'e2:u1', data: { entryName: 'kev #3' } }];
    expect(freeDefaultEntryName('Kev', 3, { owned, ref: { id: 'e3:u1' } })).toBe('Kev #3 (2)');
    expect(freeDefaultEntryName('Kev', 2, { owned, ref: { id: 'e2:u1' } })).toBe('Kev #2');
    expect(freeDefaultEntryName('Kev', 1, { owned, ref: { id: 'u1' } })).toBeUndefined();
  });
});
