// Runnable self-check for the Member Record roster math. Node's built-in assert,
// no framework — `npx tsx shared/__tests__/memberRecord.selfcheck.ts`.
import assert from 'node:assert';
import {
  memberDues,
  isMemberPaid,
  computeRosterSummary,
  foldCommissionerAggregate,
  ROSTER_SCHEMA_VERSION,
  type MemberRecord,
} from '../memberRecord';

const base = (over: Partial<MemberRecord>): MemberRecord => ({
  uid: 'u', poolId: 'p', userName: 'U', paidStatus: 'UNPAID', ...over,
});

// 1. Non-squares: expected = fee, collected only when PAID.
assert.deepStrictEqual(
  memberDues(base({ paidStatus: 'UNPAID' }), { poolType: 'NFL_PICKEM', entryFee: 20 }),
  { expected: 20, collected: 0 }, 'unpaid pickem owes fee, collects nothing');
assert.deepStrictEqual(
  memberDues(base({ paidStatus: 'PAID' }), { poolType: 'NFL_PICKEM', entryFee: 20 }),
  { expected: 20, collected: 20 }, 'paid pickem collects fee');

// 2. Squares: dues scale by units owned/paid, not a flat fee.
assert.deepStrictEqual(
  memberDues(base({ unitsOwned: 5, unitsPaid: 3 }), { poolType: 'SQUARES', entryFee: 0, costPerSquare: 10 }),
  { expected: 50, collected: 30 }, 'squares dues scale by units');

// 3. Rebuy dues add on top of base dues.
assert.deepStrictEqual(
  memberDues(base({ paidStatus: 'PAID', rebuyOwed: 15, rebuyPaid: 15 }), { poolType: 'NFL_SURVIVOR', entryFee: 25 }),
  { expected: 40, collected: 40 }, 'rebuy dues add on');

// 4. isMemberPaid.
assert.strictEqual(isMemberPaid(base({ unitsOwned: 4, unitsPaid: 4 }), 'SQUARES'), true, 'squares fully paid');
assert.strictEqual(isMemberPaid(base({ unitsOwned: 4, unitsPaid: 2 }), 'SQUARES'), false, 'squares partial unpaid');
assert.strictEqual(isMemberPaid(base({ unitsOwned: 0 }), 'SQUARES'), false, 'squares zero owned not paid');
assert.strictEqual(isMemberPaid(base({ paidStatus: 'PAID' }), 'NFL_MARGIN'), true, 'margin paidStatus');

// 5. computeRosterSummary rollup + schema version.
const s = computeRosterSummary(
  [base({ uid: 'a', paidStatus: 'PAID' }), base({ uid: 'b', paidStatus: 'UNPAID' }), base({ uid: 'c', paidStatus: 'PAID' })],
  { poolType: 'NFL_PICKEM', entryFee: 20 }, 7);
assert.strictEqual(s.memberCount, 3, 'member count');
assert.strictEqual(s.paidCount, 2, 'paid count');
assert.strictEqual(s.unpaidCount, 1, 'unpaid count');
assert.strictEqual(s.duesExpected, 60, 'dues expected');
assert.strictEqual(s.duesCollected, 40, 'dues collected');
assert.strictEqual(s.guestUnclaimedDues, 7, 'guest bucket carried');
assert.strictEqual(s.rosterSchemaVersion, ROSTER_SCHEMA_VERSION, 'schema version stamped');

// 6. foldCommissionerAggregate sums incl. guest dues + payouts.
const s1 = computeRosterSummary([base({ paidStatus: 'PAID' })], { poolType: 'NFL_PICKEM', entryFee: 20 }, 5);
const s2 = computeRosterSummary([base({ paidStatus: 'UNPAID' })], { poolType: 'NFL_PICKEM', entryFee: 10 });
const agg = foldCommissionerAggregate([s1, s2], [100, 0]);
assert.strictEqual(agg.poolsManaged, 2, 'pools managed');
assert.strictEqual(agg.totalParticipants, 2, 'participants');
assert.strictEqual(agg.duesExpected, 35, 'expected incl guest bucket');
assert.strictEqual(agg.duesCollected, 20, 'collected');
assert.strictEqual(agg.totalPayouts, 100, 'payouts');

console.log('memberRecord.selfcheck: all assertions passed');
