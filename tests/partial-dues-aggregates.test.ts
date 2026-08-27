import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  collectedBaseDues,
  memberDues,
  paidEntryCountOf,
  type MemberRecord,
  type PaidEntryMap,
} from '../shared/memberRecord';
import { buildPoolRoster, memberOutstanding, rosterPotStats } from '../src/utils/poolRoster';

/**
 * PLAN-PARTIAL-DUES-AGGREGATES — partial payment reaches the money surfaces.
 *
 * Phase 2 made partial payment representable for the first time. Until this
 * ticket, three aggregate surfaces read the all-or-nothing `paidStatus` and
 * booked a member who owes $50 and paid $25 as having paid NOTHING — an
 * UNDER-count that reaches the world-readable `stats/global.prizePot`.
 *
 * These are BEHAVIOUR tests on the arithmetic, not source-text wiring guards.
 * The failure mode this repo keeps shipping is a test that matches a string
 * instead of a value, so every assertion below is a number.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** A member with `n` liable entries, `paid` of them paid for. */
const member = (n: number, paid: number | undefined, fee: number, status = 'UNPAID'): MemberRecord =>
  ({
    uid: 'u1', role: 'PARTICIPANT', playableEntryCount: n, feeOwed: fee,
    paidStatus: status, ...(paid === undefined ? {} : { paidEntryCount: paid }),
  } as unknown as MemberRecord);

const row = (m: MemberRecord) => m as unknown as Parameters<typeof memberOutstanding>[0];

describe('paidEntryCountOf — the LIABLE ids that are paid, via isPaidRow', () => {
  const map: PaidEntryMap = { u1: { paidAt: 1 }, 'e2:u1': { paidAt: 2 } };

  it('counts the liable ids present in the map', () => {
    expect(paidEntryCountOf(map, ['u1', 'e2:u1'])).toBe(2);
    expect(paidEntryCountOf(map, ['u1'])).toBe(1);
    expect(paidEntryCountOf(map, [])).toBe(0);
    expect(paidEntryCountOf(undefined, ['u1'])).toBe(0);
  });

  it('🛑 IGNORES a key the member is no longer LIABLE for — Object.keys would OVER-count', () => {
    // A key stranded by the D7a cleanup path names an entry that is gone. It is
    // still in the map. Counting keys would publish money against an entry the
    // member does not owe for.
    expect(Object.keys(map).length).toBe(2);
    expect(paidEntryCountOf(map, ['u1'])).toBe(1);
  });

  it('🛑 IGNORES a MALFORMED row, exactly as derivePaidStatus does', () => {
    // The realistic arrival is a writer doing `paidEntries[id] = serverTimestamp()`.
    // Counting keys would make the count and the summary disagree about the same
    // document, which is the drift the whole field risks.
    const broken = { u1: { paidAt: 1 }, 'e2:u1': null } as unknown as PaidEntryMap;
    expect(Object.keys(broken).length).toBe(2);
    expect(paidEntryCountOf(broken, ['u1', 'e2:u1'])).toBe(1);
  });

  it('a duplicated or blank liable id cannot inflate the count', () => {
    expect(paidEntryCountOf(map, ['u1', 'u1', '', '  '])).toBe(1);
  });
});

describe('collectedBaseDues — can only ever raise collected, never lower it', () => {
  it('PAID collects the WHOLE fee, byte-identically to before this ticket', () => {
    expect(collectedBaseDues(member(3, 3, 75, 'PAID'), 75)).toBe(75);
    // ...and does so even with no mirrored count at all, which is every record
    // written before this ticket.
    expect(collectedBaseDues(member(3, undefined, 75, 'PAID'), 75)).toBe(75);
    // ...and even with a count that disagrees. PAID is the summary's word.
    expect(collectedBaseDues(member(3, 1, 75, 'PAID'), 75)).toBe(75);
  });

  it('🛑 THE DEFECT: an UNPAID member who paid for some entries now collects their share', () => {
    // The demonstrated case from the finding: owes 50, paid 25, reported 0.
    expect(collectedBaseDues(member(2, 1, 50), 50)).toBe(25);
    expect(collectedBaseDues(member(3, 2, 75), 75)).toBe(50);
  });

  it('ABSENT count falls back to today\'s all-or-nothing behaviour — nothing regresses pre-backfill', () => {
    expect(collectedBaseDues(member(3, undefined, 75), 75)).toBe(0);
    expect(collectedBaseDues(member(3, 0, 75), 75)).toBe(0);
  });

  it('FLOORS the share, matching calculatePoolPot — never over-report money', () => {
    // 1 of 3 entries on a $50 total is $16.66; publishing $17 would be money
    // nobody paid.
    expect(collectedBaseDues(member(3, 1, 50), 50)).toBe(16);
    expect(collectedBaseDues(member(3, 2, 50), 50)).toBe(33);
  });

  it('🛑 THE CLAMP — a stored count that OUTRAN its map cannot collect more than the fee', () => {
    // A stale mirror, or an entry deleted after the count was stamped. Without
    // the clamp, 9-of-2 entries on a $50 fee computes $225 — money nobody paid,
    // on a world-readable figure.
    expect(collectedBaseDues(member(2, 9, 50), 50)).toBe(50);
    expect(collectedBaseDues(member(2, 2, 50), 50)).toBe(50);
    // ⚠️ THIS TEST WAS INERT IN ITS FIRST FORM, and mutation testing is what
    // said so. The helper carried a SECOND clamp (`Math.min(fee, …)`) that was
    // unreachable given this one — and while both stood, each absorbed the
    // other's mutation, so removing either left every test green. The redundant
    // clamp was deleted rather than the assertion weakened.
    expect(collectedBaseDues(member(3, 10, 90), 90)).toBe(90);
  });

  it('junk and negatives are absence, never a credit', () => {
    expect(collectedBaseDues(member(2, -1, 50), 50)).toBe(0);
    expect(collectedBaseDues(member(2, NaN, 50), 50)).toBe(0);
    // Infinity fails `Number.isFinite`, so it reads as ABSENCE and collects
    // nothing — the safe direction. A clamp would have collected the whole fee
    // off a corrupt value; the finiteness guard refuses to guess instead.
    expect(collectedBaseDues(member(2, Infinity, 50), 50)).toBe(0);
    expect(collectedBaseDues({ ...member(2, 1, 50), playableEntryCount: 0, role: 'MANAGER' } as MemberRecord, 0)).toBe(0);
  });

  it('COLLECTED NEVER FALLS — the non-regression argument, over a spread of shapes', () => {
    for (const liable of [1, 2, 3, 5]) {
      for (const fee of [0, 10, 25, 50, 99]) {
        for (const paid of [undefined, 0, 1, 2, 99]) {
          for (const status of ['PAID', 'UNPAID']) {
            const before = status === 'PAID' ? fee : 0;   // the old all-or-nothing read
            const after = collectedBaseDues(member(liable, paid, fee, status), fee);
            expect(after).toBeGreaterThanOrEqual(before);
            expect(after).toBeLessThanOrEqual(fee);
          }
        }
      }
    }
  });
});

describe('memberDues — the shared reader the pot chain runs through', () => {
  it('the finding, end to end: owes 50, paid one of two entries', () => {
    const d = memberDues(member(2, 1, 50), { poolType: 'NFL_PICKEM', entryFee: 25 });
    expect(d.expected).toBe(50);
    expect(d.collected).toBe(25);   // was 0
  });

  it('rebuy dues still add on top and are untouched by this change', () => {
    const m = { ...member(2, 1, 50), rebuyOwed: 20, rebuyPaid: 20 } as MemberRecord;
    const d = memberDues(m, { poolType: 'NFL_PICKEM', entryFee: 25 });
    expect(d.expected).toBe(70);
    expect(d.collected).toBe(45);
  });

  it('🛑 SQUARES IS UNTOUCHED — its unit model already prices partial payment', () => {
    const sq = { uid: 'u1', role: 'PARTICIPANT', unitsOwned: 4, unitsPaid: 1, paidStatus: 'UNPAID' } as unknown as MemberRecord;
    const d = memberDues(sq, { poolType: 'SQUARES', entryFee: 0, costPerSquare: 10 });
    expect(d.expected).toBe(40);
    expect(d.collected).toBe(10);
  });
});

describe('poolRoster — the two client surfaces read the SAME helper', () => {
  const pool = { participantIds: ['u1'], ownerId: 'boss', settings: { entryFee: 25 } };

  it('D5: Outstanding falls by what was actually paid, so it cannot contradict the pot', () => {
    // Leaving this on the all-or-nothing read is how the ledger says a member
    // owes $50 while the pot says $25 of it is collected.
    expect(memberOutstanding(row(member(2, 1, 50)), { entryFee: 25, rebuyCost: 25 })).toBe(25);
    expect(memberOutstanding(row(member(2, undefined, 50)), { entryFee: 25, rebuyCost: 25 })).toBe(50);
    expect(memberOutstanding(row(member(2, 2, 50, 'PAID')), { entryFee: 25, rebuyCost: 25 })).toBe(0);
  });

  it('🛑 D5 THROUGH THE REAL PATH — a row from buildPoolRoster carries what the helper needs (codex r1 P1)', () => {
    // THE TEST ABOVE WAS INERT AGAINST THIS DEFECT, and codex found it. It hands
    // `memberOutstanding` a raw Member Record, but the Buy-In Ledger hands it a
    // RosterRow — and the builder copied neither `paidEntryCount` nor
    // `playableEntryCount`. So the helper saw no count and a liability of 1, and
    // the ledger showed the WHOLE fee outstanding while the pot beside it
    // reported the partial payment. Testing the helper is not testing the wiring.
    const m = { ...member(2, 1, 50), uid: 'u1', userName: 'A', joinedAt: 1 } as unknown as MemberRecord;
    const rows = buildPoolRoster({ pool, members: [m], entries: [] });
    const built = rows.find(r => r.uid === 'u1')!;
    expect(built.paidEntryCount).toBe(1);
    expect(built.playableEntryCount).toBe(2);
    expect(memberOutstanding(built, { entryFee: 25, rebuyCost: 25 })).toBe(25);
    // ...and the ledger row and the pot now agree about this member's money.
    expect(rosterPotStats({ pool, members: [m], entries: [] }).collected).toBe(25);
  });

  it('Outstanding is never negative, whatever the count says', () => {
    expect(memberOutstanding(row(member(2, 99, 50)), { entryFee: 25, rebuyCost: 25 })).toBe(0);
  });

  it('the pot collects the partial share', () => {
    const stats = rosterPotStats({ pool, members: [member(2, 1, 50)], entries: [] });
    expect(stats.expected).toBe(50);
    expect(stats.collected).toBe(25);
  });

  it('🛑 D4: THE HEAD COUNT DOES NOT MOVE — a partially paid member is not a paid member', () => {
    // Only the MONEY was wrong. The "N of M paid" chip counts fully-paid
    // members, which is what it says.
    expect(rosterPotStats({ pool, members: [member(2, 1, 50)], entries: [] }).paidCount).toBe(0);
    expect(rosterPotStats({ pool, members: [member(2, 2, 50, 'PAID')], entries: [] }).paidCount).toBe(1);
    // ...and `clearedCount` ("owes nothing") does not move either: partial
    // payment lowers Outstanding without clearing it, which is the honest
    // reading and the one the chip already promises.
    expect(rosterPotStats({ pool, members: [member(2, 1, 50)], entries: [] }).clearedCount).toBe(0);
    expect(rosterPotStats({ pool, members: [member(2, 2, 50, 'PAID')], entries: [] }).clearedCount).toBe(1);
  });
});

describe('the writers — every one stamps the count in the SAME transaction (C1)', () => {
  // Behaviour is pinned by the emulator suite; these prove the CALL EXISTS at
  // each of the three sites the plan enumerates, so a fourth writer added later
  // is a visible omission rather than silent drift.
  it.each([
    ['functions/src/setPaidStatus.ts', 'paidEntryCount: nextPaidEntryCount'],
    ['functions/src/nflEntryDelete.ts', 'memberPatch.paidEntryCount = paidEntryCountOf(duesAfter, liableIdsAfter)'],
    ['functions/src/migrations/reconcilePaymentTruth.ts', 'paidEntryCount: paidEntryCountOf(nextDues, liable)'],
  ])('%s writes the mirrored count', (file, needle) => {
    expect(read(file)).toContain(needle);
  });

  it('every writer derives it through paidEntryCountOf, never by counting keys', () => {
    for (const f of [
      'functions/src/setPaidStatus.ts',
      'functions/src/nflEntryDelete.ts',
      'functions/src/migrations/reconcilePaymentTruth.ts',
    ]) {
      const src = read(f);
      expect(src).toContain('paidEntryCountOf');
      expect(src).not.toMatch(/paidEntryCount\s*[:=]\s*Object\.keys/);
    }
  });

  it('nflEntryDelete stamps the count OUTSIDE the `if (storedDues)` guard', () => {
    // The dues write is conditional so a member who never had a dues document
    // does not gain an empty one (R3). The COUNT is not: deleting an entry
    // shrinks the liable set either way, and a stale count above a shrunken
    // liability OVER-reports money.
    const src = read('functions/src/nflEntryDelete.ts');
    const stamp = src.indexOf('memberPatch.paidEntryCount =');
    const guard = src.indexOf('if (storedDues) writePoolDues(');
    expect(stamp).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(guard);
  });
});
