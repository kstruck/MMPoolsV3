import { describe, it, expect } from 'vitest';
import { planMembershipWrite } from '../lib/memberRecord';
import {
  assertEntryAdmitted, assertEntryNameFree, entryCountWrite, entryHasPick, ownerStateAfter, pickOwnedEntry,
} from '../lib/multiEntry';
import { defaultEntryName, entryIdFor } from '../shared/multiEntry';
import {
  derivePaidStatus, deriveEntryCount, liableEntryIds, memberLiableEntries, type MemberRecord,
} from '../shared/memberRecord';

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

  /**
   * PLAN-MULTI-ENTRY-DUES D1a (codex r4 #1). The ids, not just the count — the
   * input `liableEntryIds` cannot get from the Member Record.
   */
  it('returns WHICH entries hold a pick, agreeing with the count', () => {
    const owned = [
      { id: 'u1', data: { picks: { g1: 'KC' } } },
      { id: 'e2:u1', data: { picks: {}, entryIndex: 2 } },        // empty sheet — not liable
      { id: 'e4:u1', data: { picks: { g7: 'SF' }, entryIndex: 4 } },
    ];
    const s = ownerStateAfter(owned, { id: 'e3:u1', entryIndex: 3, hasPick: true });
    expect([...s.pickedEntryIds].sort()).toEqual(['e3:u1', 'e4:u1', 'u1']);
    // The two outputs are derived from ONE predicate pass and must never disagree.
    expect(s.pickedEntryIds.length).toBe(s.playableEntryCount);
  });

  it('the written doc is judged by its POST-write shape, not the stored one', () => {
    // Stored empty, written with a pick -> liable. The stale `owned` copy of the
    // same id must not win, or a first submit would look unpaid-for.
    const owned = [{ id: 'u1', data: { picks: {} } }];
    expect(ownerStateAfter(owned, { id: 'u1', entryIndex: 1, hasPick: true }).pickedEntryIds).toEqual(['u1']);
    // ...and the reverse: written WITHOUT a pick is not liable, even though a
    // stored copy has one (an empty resubmit cannot un-commit, but the predicate
    // must still read off `written`).
    const owned2 = [{ id: 'u1', data: { picks: { g1: 'KC' } } }];
    expect(ownerStateAfter(owned2, { id: 'u1', entryIndex: 1, hasPick: false }).pickedEntryIds).toEqual([]);
  });

  it('is EMPTY when nothing has a pick — the seeded-manager shape that feeds N1', () => {
    const s = ownerStateAfter([], { id: 'u1', entryIndex: 1, hasPick: false });
    expect(s.pickedEntryIds).toEqual([]);
    expect(s.playableEntryCount).toBe(0);
  });

  /**
   * 🛑 GUARD THE GUARD, and this one guards an AUTHORIZATION invariant.
   *
   * `pickedEntryIds` is transaction-local by contract: persisting it onto the
   * Member Record is the commissioner-blind-picks leak the `entries` map exists
   * to avoid. `entries` must therefore carry index/name and NOTHING pick-shaped.
   *
   * The sample it MUST catch is below — a leak is simulated by hand and the
   * assertion fails on it. The sample it must NOT catch is the ordinary roster
   * on the line above, which passes.
   */
  it('the roster map still leaks NO pick state, even though the ids are now computed', () => {
    const owned = [{ id: 'e2:u1', data: { picks: { g1: 'KC' }, entryIndex: 2, entryName: 'Kev #2' } }];
    const s = ownerStateAfter(owned, { id: 'u1', entryIndex: 1, hasPick: true });
    const pickShaped = (o: Record<string, unknown>) =>
      Object.keys(o).some(k => /pick|liable|week|hasPick/i.test(k));

    // MUST NOT catch: the real roster entries.
    for (const v of Object.values(s.entries)) expect(pickShaped(v)).toBe(false);
    expect(Object.values(s.entries).every(v => pickShaped(v))).toBe(false);

    // MUST catch: a hand-built leak of exactly the shape this forbids.
    expect(pickShaped({ entryIndex: 2, name: 'Kev #2', hasPick: true })).toBe(true);
    expect(pickShaped({ entryIndex: 2, liable: true })).toBe(true);
    expect(pickShaped({ entryIndex: 2, pickedWeeks: [1] })).toBe(true);
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
  });

  /**
   * PLAN-MULTI-ENTRY-DUES D6 — K11 RETIRED. This test used to assert the reset
   * PAYLOAD; it now asserts what replaced it, and the distinction is the ticket.
   */
  it('D6: a PAID member adding an entry still goes UNPAID — the SUMMARY survives K11', () => {
    const existing = rec({ role: 'PARTICIPANT', feeOwed: 25, paidStatus: 'PAID', paidAt: 123, hasPlayableEntry: true, playableEntryCount: 1 });
    const plan = planMembershipWrite('p1', 'u1', facts({ hasPlayableEntry: true, playableEntryCount: 2 }), existing, NOW);
    if (plan.participant !== 'add') throw new Error('add');
    // The half that MUST survive: nothing derives `paidStatus` on read, so a
    // dropped write leaves a fully-paid member reading PAID while owing $50.
    expect(plan.member.data.paidStatus).toBe('UNPAID');
    expect(plan.member.data.feeOwed).toBe(50);
    // The half that is GONE: no reset payload, so no ledger line and no mirror.
    expect('paidReset' in plan.member).toBe(false);
  });

  /**
   * 🛑 THE EQUIVALENCE THE LITERAL RESTS ON.
   *
   * `planMembershipWrite` writes the literal `'UNPAID'` rather than calling
   * `derivePaidStatus`, because it is pure and reading the dues store would cost
   * a transactional read on every pick submission. That is only sound while a
   * newly-liable entry cannot already be in `paidEntries` — which `setPaidStatus`
   * guarantees by refusing ENTRY_NOT_FOUND outside the liable set.
   *
   * Pinned here rather than left in a comment: if that guarantee ever breaks,
   * this fails and the literal must become the real call.
   */
  it('the literal UNPAID equals derivePaidStatus for every shape this branch fires on', () => {
    for (const priorCount of [0, 1, 2, 5]) {
      const nextCount = priorCount + 1;
      const paidIds = Array.from({ length: priorCount }, (_, i) => (i === 0 ? 'u1' : `e${i + 1}:u1`));
      const liableIds = Array.from({ length: nextCount }, (_, i) => (i === 0 ? 'u1' : `e${i + 1}:u1`));
      // Every PRIOR entry paid — the most favourable case for reading PAID.
      const paidEntries = Object.fromEntries(paidIds.map(id => [id, { paidAt: NOW }]));
      const member = { role: 'PARTICIPANT' as const, playableEntryCount: nextCount, paidEntries };
      expect(derivePaidStatus(member, liableEntryIds(member, 'u1', liableIds))).toBe('UNPAID');
    }
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

/**
 * PLAN-MULTI-ENTRY-DUES P2-T1 — the derivation, PURE and with no writers yet.
 *
 * This block exists before anything can write `paidEntries` on purpose: the
 * derivation is where N1 lives, and a pure function with a test is the only
 * place that bug is cheap (plan section 7, "T1 before T2 is not arbitrary").
 */
describe('DUES D1 — liableEntryIds', () => {
  it('N1 (THE FIRST TEST, and the reason the length guard exists): a seeded manager with no liable entries is liable for NOTHING', () => {
    // `[].every(...)` is `true`. Without the guard this member derives PAID and
    // every seeded commissioner in production turns green.
    expect(liableEntryIds(rec({ role: 'MANAGER', feeOwed: 0 }), 'u1', [])).toEqual([]);
    expect(derivePaidStatus({ paidEntries: {} }, [])).toBe('UNPAID');
    expect(derivePaidStatus({}, [])).toBe('UNPAID');
    // ...and the whole point: they stay UNPAID even with a populated map.
    expect(derivePaidStatus({ paidEntries: { 'u1': { paidAt: NOW } } }, [])).toBe('UNPAID');
  });

  it('a joined-and-never-picked PARTICIPANT gets exactly ONE payable row, at the synthetic uid', () => {
    // They owe a fee from the moment they join, before any entry doc exists,
    // and entry #1's id IS the bare uid (parent plan D1).
    expect(liableEntryIds(rec({ role: 'PARTICIPANT' }), 'u1', [])).toEqual(['u1']);
    expect(liableEntryIds(rec({ role: 'PARTICIPANT', playableEntryCount: 0 }), 'u1', [])).toEqual(['u1']);
  });

  it('a legacy MANAGER charged before the latch existed still gets a payable row', () => {
    // memberLiableEntries counts them 1 off `feeOwed > 0`; liability without a
    // payable row would be a debt nobody can settle.
    expect(liableEntryIds(rec({ role: 'MANAGER', feeOwed: 25 }), 'u1', [])).toEqual(['u1']);
  });

  it('picked ids win, deduped and sorted, and the synthetic fallback does NOT apply', () => {
    expect(liableEntryIds(rec({ role: 'PARTICIPANT' }), 'u1', ['e2:u1', 'u1'])).toEqual(['e2:u1', 'u1']);
    expect(liableEntryIds(rec({ role: 'PARTICIPANT' }), 'u1', ['u1', 'u1'])).toEqual(['u1']);
    // A manager who HAS played is liable for what they played, not for a uid row.
    expect(liableEntryIds(rec({ role: 'MANAGER', playableEntryCount: 1 }), 'u1', ['e2:u1'])).toEqual(['e2:u1']);
  });

  it('the picked ids are the AUTHORITY and are NOT intersected with the `entries` mirror', () => {
    // The mirror is ABSENT on legacy records and stale between submits.
    // Intersecting would drop a liable id, making the member owe LESS and derive
    // PAID more easily -- the money-lie direction. The entry docs win.
    const legacy = rec({ role: 'PARTICIPANT', entries: undefined });
    expect(liableEntryIds(legacy, 'u1', ['u1', 'e2:u1'])).toEqual(['e2:u1', 'u1']);
    const stale = rec({ role: 'PARTICIPANT', entries: { 'u1': { entryIndex: 1 } } });
    expect(liableEntryIds(stale, 'u1', ['u1', 'e2:u1'])).toEqual(['e2:u1', 'u1']);
    // ...and the consequence that matters: paying only the mirrored one is NOT paid in full.
    expect(derivePaidStatus({ paidEntries: { 'u1': {} } }, liableEntryIds(stale, 'u1', ['u1', 'e2:u1']))).toBe('UNPAID');
  });
});

describe('DUES D1/D1b — derivePaidStatus, where PRESENCE is the paid signal', () => {
  it('PAID only when EVERY liable id is present', () => {
    expect(derivePaidStatus({ paidEntries: { 'u1': {}, 'e2:u1': {} } }, ['u1', 'e2:u1'])).toBe('PAID');
    expect(derivePaidStatus({ paidEntries: { 'e2:u1': {} } }, ['u1', 'e2:u1'])).toBe('UNPAID');
    expect(derivePaidStatus({ paidEntries: { 'u1': {} } }, ['u1', 'e2:u1'])).toBe('UNPAID');
  });

  it("Kevin's case: pay entry 2, not entry 1 -> the member is UNPAID", () => {
    const m = rec({ role: 'PARTICIPANT', playableEntryCount: 2 });
    const liable = liableEntryIds(m, 'u1', ['u1', 'e2:u1']);
    expect(derivePaidStatus({ paidEntries: { 'e2:u1': { paidAt: NOW } } }, liable)).toBe('UNPAID');
    expect(derivePaidStatus({ paidEntries: { 'e2:u1': { paidAt: NOW }, 'u1': { paidAt: NOW } } }, liable)).toBe('PAID');
  });

  it('an EMPTY value object still counts as paid — presence is the signal, not truthiness', () => {
    // D1b: there is no `paid: boolean`, so `{}` means paid. Metadata is optional.
    expect(derivePaidStatus({ paidEntries: { 'u1': {} } }, ['u1'])).toBe('PAID');
    expect(derivePaidStatus({ paidEntries: { 'u1': { method: 'cash' } } }, ['u1'])).toBe('PAID');
  });

  it('an ABSENT map is "no per-entry detail", never "everything is paid"', () => {
    expect(derivePaidStatus({}, ['u1'])).toBe('UNPAID');
    expect(derivePaidStatus({ paidEntries: undefined }, ['u1'])).toBe('UNPAID');
  });

  it('a colon-bearing entry id round-trips (D1b — the FieldPath case)', () => {
    expect(derivePaidStatus({ paidEntries: { 'e2:u1': { paidAt: NOW } } }, ['e2:u1'])).toBe('PAID');
    // and un-marking is a DELETED key, not a falsy value -- which is what the
    // callable must do, and what this reads back as.
    const afterUnmark: Record<string, { paidAt?: number }> = { 'e2:u1': { paidAt: NOW } };
    delete afterUnmark['e2:u1'];
    expect(derivePaidStatus({ paidEntries: afterUnmark }, ['e2:u1'])).toBe('UNPAID');
  });

  /**
   * PLAN-MULTI-ENTRY-DUES, codex r3 findings 2 and 3 on the T1 diff.
   *
   * These two findings share one root cause and one fix. `feeOwed` is
   * `entryFee x memberLiableEntries(m)`, so a caller whose entry evidence yields
   * FEWER liable rows than the stored counter would have the member pay every
   * row shown, settle less money than they owe, and still read PAID.
   */
  describe('fail-closed: fewer liable rows than the fee covers can NEVER derive PAID', () => {
    it('a participant recorded at 3 played entries, but only 2 ids supplied, stays UNPAID', () => {
      const m = { role: 'PARTICIPANT', playableEntryCount: 3,
        paidEntries: { 'u1': {}, 'e2:u1': {} } } as const;
      const liable = liableEntryIds(m, 'u1', ['u1', 'e2:u1']);
      expect(liable).toEqual(['e2:u1', 'u1']);          // the helper reports what it was told
      expect(memberLiableEntries(m)).toBe(3);           // ...but the record says three fees
      expect(derivePaidStatus(m, liable)).toBe('UNPAID');
      // and paying the third settles it
      expect(derivePaidStatus(
        { ...m, paidEntries: { 'u1': {}, 'e2:u1': {}, 'e3:u1': {} } },
        liableEntryIds(m, 'u1', ['u1', 'e2:u1', 'e3:u1']),
      )).toBe('PAID');
    });

    it('a member who HAS played but is handed [] does not settle on one synthetic row', () => {
      // The synthetic-uid fallback is right for a joined-and-never-picked member
      // and WRONG for this one; the count guard is what tells them apart.
      const m = { role: 'PARTICIPANT', playableEntryCount: 2, paidEntries: { 'u1': {} } } as const;
      expect(liableEntryIds(m, 'u1', [])).toEqual(['u1']);
      expect(derivePaidStatus(m, ['u1'])).toBe('UNPAID');
    });

    it('evidence LARGER than the stored counter is allowed — the entry docs outrank a stale count', () => {
      // Legacy record: playableEntryCount absent, hasPlayableEntry true -> counts 1.
      // The transaction found two picked entries. Owing MORE is the safe direction.
      const m = { role: 'PARTICIPANT', hasPlayableEntry: true,
        paidEntries: { 'u1': {}, 'e2:u1': {} } } as const;
      expect(memberLiableEntries(m)).toBe(1);
      expect(derivePaidStatus(m, liableEntryIds(m, 'u1', ['u1', 'e2:u1']))).toBe('PAID');
      // ...and only ONE of the two paid is still UNPAID, which is the point.
      expect(derivePaidStatus({ ...m, paidEntries: { 'u1': {} } }, ['e2:u1', 'u1'])).toBe('UNPAID');
    });

    it('derivePaidStatus SANITIZES ITS OWN ARGUMENT — it does not trust liableEntryIds (codex r4 #3)', () => {
      // MUST catch: duplicates would otherwise pad the array to the owed length
      // and let ONE paid row settle TWO owed entries.
      const dup = { role: 'PARTICIPANT', playableEntryCount: 2, paidEntries: { 'u1': {} } } as const;
      expect(['u1', 'u1'].length).toBe(2);                       // the pad is real
      expect(memberLiableEntries(dup)).toBe(2);
      expect(derivePaidStatus(dup, ['u1', 'u1'])).toBe('UNPAID');
      // MUST catch: a hand-built blank id with a matching key.
      expect(derivePaidStatus(
        { role: 'PARTICIPANT', paidEntries: { '': {} } }, [''],
      )).toBe('UNPAID');
      // MUST NOT catch: two DISTINCT real ids, both paid, is genuinely PAID.
      expect(derivePaidStatus(
        { ...dup, paidEntries: { 'u1': {}, 'e2:u1': {} } }, ['u1', 'e2:u1'],
      )).toBe('PAID');
    });

    it('a blank entry id cannot be paid off (codex r3 #1)', () => {
      // MUST catch: `liable: ['']` with a matching `paidEntries['']` key would
      // otherwise derive PAID against a row that cannot exist.
      expect(liableEntryIds({ role: 'PARTICIPANT' }, 'u1', ['', 'u1'])).toEqual(['u1']);
      expect(liableEntryIds({ role: 'PARTICIPANT' }, 'u1', [''])).toEqual(['u1']);   // falls back
      expect(derivePaidStatus(
        { role: 'PARTICIPANT', paidEntries: { '': {} } },
        liableEntryIds({ role: 'PARTICIPANT' }, 'u1', ['']),
      )).toBe('UNPAID');
      // MUST NOT catch: a real id is untouched by the filter.
      expect(liableEntryIds({ role: 'PARTICIPANT' }, 'u1', ['e2:u1'])).toEqual(['e2:u1']);
    });
  });

  it('a MALFORMED row value is not a payment (codex r5 #1)', () => {
    // The realistic arrival: a writer that "un-marks" by writing a falsy value
    // instead of DELETING the key - the exact mistake D1b forbids. Firestore
    // stores null happily, and reading it as PAID would report money collected
    // that was just disclaimed.
    const bad = { 'u1': null } as unknown as Record<string, { paidAt?: number }>;
    expect(Object.prototype.hasOwnProperty.call(bad, 'u1')).toBe(true);   // present...
    expect(derivePaidStatus({ role: 'PARTICIPANT', paidEntries: bad }, ['u1'])).toBe('UNPAID');
    // `typeof null` AND `typeof []` are both 'object', so each needs excluding
    // by hand. Firestore stores arrays natively, so this is as reachable as null.
    expect(typeof [] === 'object').toBe(true);                            // the trap is real
    const arr = { 'u1': [] } as unknown as Record<string, { paidAt?: number }>;
    expect(derivePaidStatus({ role: 'PARTICIPANT', paidEntries: arr }, ['u1'])).toBe('UNPAID');
    // ...and every Firestore CLASS INSTANCE too. The realistic arrival is a
    // writer doing paidEntries[id] = serverTimestamp() instead of { paidAt }.
    // Stand-ins, because importing firebase-admin here would break the
    // framework-free property that lets the client bundle this module.
    class Timestamp { constructor(public seconds = 1, public nanoseconds = 0) {} }
    class GeoPoint { constructor(public latitude = 0, public longitude = 0) {} }
    for (const v of [new Timestamp(), new GeoPoint(), new Date(NOW)]) {
      expect(typeof v === 'object' && v !== null && !Array.isArray(v)).toBe(true);  // passes the OLD check
      const inst = { 'u1': v } as unknown as Record<string, { paidAt?: number }>;
      expect(derivePaidStatus({ role: 'PARTICIPANT', paidEntries: inst }, ['u1'])).toBe('UNPAID');
    }
    // MUST NOT catch: a null-prototype map is still a plain map.
    const bare = Object.assign(Object.create(null), { paidAt: NOW });
    expect(derivePaidStatus(
      { role: 'PARTICIPANT', paidEntries: { 'u1': bare } }, ['u1'],
    )).toBe('PAID');
    // MUST NOT catch: `{}` IS paid. D1b has no `paid: boolean`; metadata is optional.
    expect(derivePaidStatus({ role: 'PARTICIPANT', paidEntries: { 'u1': {} } }, ['u1'])).toBe('PAID');
    expect(derivePaidStatus(
      { role: 'PARTICIPANT', paidEntries: { 'u1': { paidAt: NOW, method: 'cash' } } }, ['u1'],
    )).toBe('PAID');
  });

  it('a RESERVED `__proto__` id is dropped, not assigned through (codex r5 on T2)', () => {
    // MUST catch: `map['__proto__'] = row` on an ordinary object sets the
    // PROTOTYPE instead of creating a key, so the row lands nowhere while a
    // caller that already decided a transition happened ledgers a payment.
    const victim: Record<string, unknown> = {};
    victim['__proto__'] = { paidAt: NOW };
    expect(Object.prototype.hasOwnProperty.call(victim, '__proto__')).toBe(false);  // the trap is real

    // Dropped from the liable set entirely, which fails toward UNPAID.
    expect(liableEntryIds({ role: 'PARTICIPANT' }, 'u1', ['__proto__', 'u1'])).toEqual(['u1']);
    expect(derivePaidStatus(
      { role: 'PARTICIPANT', paidEntries: { 'u1': {} } }, ['__proto__', 'u1'],
    )).toBe('PAID');   // only the real row is owed, and it is paid
    // ...and a member whose ONLY id is reserved is liable for nothing derivable.
    expect(derivePaidStatus({ role: 'PARTICIPANT' }, ['__proto__'])).toBe('UNPAID');
    // Every reserved shape, not just this one.
    for (const id of ['__proto__', '__name__', '__id__']) {
      expect(liableEntryIds({ role: 'MANAGER', playableEntryCount: 1 }, 'u1', [id])).toEqual(['u1']);
    }
    // MUST NOT catch: a real id with underscores is untouched.
    expect(liableEntryIds({ role: 'PARTICIPANT' }, 'u1', ['e2:my_uid_'])).toEqual(['e2:my_uid_']);
    expect(liableEntryIds({ role: 'PARTICIPANT' }, 'u1', ['__notclosed'])).toEqual(['__notclosed']);
  });

  it('GUARD THE GUARD: an inherited Object.prototype key is NOT presence', () => {
    // MUST catch: `'constructor' in {}` is true, so an `in` check would report
    // PAID against a map that never mentioned the id. hasOwnProperty does not.
    expect('constructor' in {}).toBe(true);                       // the trap is real
    expect(derivePaidStatus({ paidEntries: {} }, ['constructor'])).toBe('UNPAID');
    expect(derivePaidStatus({ paidEntries: {} }, ['toString'])).toBe('UNPAID');
    // MUST NOT catch: an OWN key of that name is still presence.
    expect(derivePaidStatus({ paidEntries: { 'constructor': {} } }, ['constructor'])).toBe('PAID');
  });
});
