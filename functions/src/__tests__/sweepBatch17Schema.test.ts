import { describe, it, expect } from 'vitest';
import { markEntryPaidStatusSchema } from '../schemas/tournamentAdmin';
import { calculatePlayoffScoresSchema } from '../schemas/playoffEntries';
import { backfillMemberRecordsSchema, backfillPublishedWeeksSchema, reconcilePaymentTruthSchema } from '../schemas/migrations';
import { importNFLScheduleSchema } from '../schemas/nflSchedule';
import { searchUsersByEmailSchema } from '../schemas/userManagement';
import { recomputeMyProfileSchema } from '../schemas/userProfile';
import { fixPoolScoresSchema } from '../schemas/scoreUpdates';
import { claimMySquaresSchema } from '../schemas/participantOps';
import { syncAllUsersSchema, recalculateGlobalStatsSchema } from '../schemas/noInputAdmin';

// SWEEP-LATER batch 17 — the last 10 callables in the fleet.
// Each schema is pinned against the REAL client payload (grepped from src/), not
// an idealised one. The recurring lesson from batches 5-16 is that a .strict()
// schema breaks production when it disagrees with what the frontend actually
// sends — including keys sent as explicit `undefined`.

describe('markEntryPaidStatus', () => {
  it('accepts the documented shape', () => {
    expect(markEntryPaidStatusSchema.safeParse({ poolId: 'p1', entryId: 'e1', isPaid: true }).success).toBe(true);
  });
  it('REQUIRES isPaid — omission used to silently mean UNPAID', () => {
    // Handler does `isPaid ? 'PAID' : 'UNPAID'`, so an absent flag un-marked the
    // entry. Safe to require: this callable has zero frontend callers.
    expect(markEntryPaidStatusSchema.safeParse({ poolId: 'p1', entryId: 'e1' }).success).toBe(false);
  });
  it('rejects unknown fields', () => {
    expect(markEntryPaidStatusSchema.safeParse({ poolId: 'p', entryId: 'e', isPaid: true, x: 1 }).success).toBe(false);
  });
});

describe('calculatePlayoffScores', () => {
  it('accepts a poolId', () => {
    expect(calculatePlayoffScoresSchema.safeParse({ poolId: 'p1' }).success).toBe(true);
  });
  it('rejects an empty poolId rather than passing it to Firestore', () => {
    // Previously an absent poolId reached `db.collection('pools').doc(poolId)`
    // and threw a raw Firestore error rather than an HttpsError.
    expect(calculatePlayoffScoresSchema.safeParse({}).success).toBe(false);
    expect(calculatePlayoffScoresSchema.safeParse({ poolId: '' }).success).toBe(false);
  });
});

describe('backfillMemberRecords — dry-run must default SAFE at the schema layer', () => {
  it('defaults dryRun to TRUE when omitted', () => {
    const r = backfillMemberRecordsSchema.parse({});
    expect(r.dryRun).toBe(true);
  });
  it('only an explicit false arms it', () => {
    expect(backfillMemberRecordsSchema.parse({ dryRun: false }).dryRun).toBe(false);
  });
  it("accepts OperationsPanel's real WIRE payload — the first-page cursor arrives as NULL", () => {
    // The old version of this test asserted `startAfter: undefined` — the shape
    // the panel's SOURCE writes. But the Firebase JS SDK's callable serializer
    // encodes an explicit-undefined property as NULL on the wire, so the server
    // never sees undefined; it sees null. That gap failed the FIRST page of the
    // D25 prod dry run (2026-07-27) with "expected string, received null" — the
    // test was green while guarding a payload that cannot occur in production.
    expect(backfillMemberRecordsSchema.safeParse({ dryRun: true, includeFinished: false, limit: 100, startAfter: null }).success).toBe(true);
    // null parses AS first-page: the handler's `if (startAfter)` gate must see undefined.
    expect(backfillMemberRecordsSchema.parse({ startAfter: null }).startAfter).toBeUndefined();
    // The pre-serializer shape stays accepted too (firebase-functions-test sends it).
    expect(backfillMemberRecordsSchema.safeParse({ dryRun: true, includeFinished: false, limit: 100, startAfter: undefined }).success).toBe(true);
    expect(backfillMemberRecordsSchema.safeParse({ dryRun: false, includeFinished: true, limit: 100, startAfter: 'poolAbc' }).success).toBe(true);
    // A real cursor still cannot be junk.
    expect(backfillMemberRecordsSchema.safeParse({ startAfter: '' }).success).toBe(false);
    expect(backfillMemberRecordsSchema.safeParse({ startAfter: 42 }).success).toBe(false);
  });

  it('backfillPublishedWeeks accepts the identical null first-page cursor (same panel shape)', () => {
    expect(backfillPublishedWeeksSchema.safeParse({ dryRun: true, limit: 200, startAfter: null }).success).toBe(true);
    expect(backfillPublishedWeeksSchema.parse({ startAfter: null }).startAfter).toBeUndefined();
    expect(backfillPublishedWeeksSchema.safeParse({ startAfter: 42 }).success).toBe(false);
  });
  it('caps limit at the handler ceiling', () => {
    expect(backfillMemberRecordsSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  // PLAN-PAYMENT-TRUTH P4 (Kevin's Q3). `includeAll` conflated "process finished
  // pools?" with "process sim pools?"; it is split so the sim exclusion can no
  // longer be switched off by any input.
  it('defaults includeFinished to FALSE when omitted — the narrow sweep', () => {
    expect(backfillMemberRecordsSchema.parse({}).includeFinished).toBe(false);
  });
  it('only an explicit true widens the sweep over finished pools', () => {
    expect(backfillMemberRecordsSchema.parse({ includeFinished: true }).includeFinished).toBe(true);
  });
  it('REJECTS the retired includeAll flag rather than ignoring it', () => {
    // strictObject, so a stale caller fails loudly instead of silently getting
    // the narrow sweep it did not ask for. Nothing in src/ sent it — the
    // Operations button never passed it, which IS defect D25.
    expect(backfillMemberRecordsSchema.safeParse({ includeAll: true }).success).toBe(false);
  });
});

describe('importNFLSchedule', () => {
  it("accepts SuperAdmin's real payload", () => {
    // dbService.ts:1485 — { season: string; seasonType: number; weeks?: number[] }
    expect(importNFLScheduleSchema.safeParse({ season: '2026', seasonType: 1, weeks: [1, 2, 3, 4] }).success).toBe(true);
  });
  it('accepts a scalar week, matching the handler coercion', () => {
    expect(importNFLScheduleSchema.safeParse({ season: '2026', seasonType: 2, weeks: 5 }).success).toBe(true);
  });
  it('accepts an empty object — every field has a load-bearing handler default', () => {
    expect(importNFLScheduleSchema.safeParse({}).success).toBe(true);
  });
  it('REJECTS a nonsense seasonType before it reaches a destructive delete', () => {
    // importNFLSeason() batch-deletes every nfl_games doc matching
    // season+seasonType. The handler did a bare parseInt with no range check.
    expect(importNFLScheduleSchema.safeParse({ seasonType: 9 }).success).toBe(false);
    expect(importNFLScheduleSchema.safeParse({ seasonType: 0 }).success).toBe(false);
  });
});

describe('searchUsersByEmail', () => {
  it('accepts the real payload from both callers', () => {
    expect(searchUsersByEmailSchema.safeParse({ prefix: 'ke', limit: 25 }).success).toBe(true);
    expect(searchUsersByEmailSchema.safeParse({ prefix: 'ke', limit: 10 }).success).toBe(true);
  });
  it('does NOT normalise the prefix — it is a range lookup key', () => {
    // The handler owns .trim().toLowerCase(); normalising here too would let the
    // two drift. Assert the value survives untouched.
    expect(searchUsersByEmailSchema.parse({ prefix: '  Kev  ' }).prefix).toBe('  Kev  ');
  });
  it('rejects a limit above the handler ceiling', () => {
    expect(searchUsersByEmailSchema.safeParse({ prefix: 'a', limit: 51 }).success).toBe(false);
  });
});

describe('recomputeMyProfile — omitting uid MEANS "myself"', () => {
  it('accepts an empty object (the self case)', () => {
    expect(recomputeMyProfileSchema.safeParse({}).success).toBe(true);
  });
  it('accepts an explicit uid (the SUPER_ADMIN case)', () => {
    expect(recomputeMyProfileSchema.safeParse({ uid: 'someUid' }).success).toBe(true);
  });
});

describe('fixPoolScores — omitting poolId MEANS "every pool"', () => {
  it('accepts {} — the OperationsPanel global sweep', () => {
    // OperationsPanel.tsx:178 — call('fixPoolScores') -> {}
    expect(fixPoolScoresSchema.safeParse({}).success).toBe(true);
  });
  it('accepts an explicit undefined poolId — dbService always sends the key', () => {
    // dbService.fixPoolScores(poolId?) -> fn({ poolId }) — key present, value
    // undefined. An absent-key-only optional would reject this real call.
    expect(fixPoolScoresSchema.safeParse({ poolId: undefined }).success).toBe(true);
  });
  it('accepts a targeted poolId', () => {
    expect(fixPoolScoresSchema.safeParse({ poolId: 'pool123' }).success).toBe(true);
  });
});

describe('claimMySquares — guestDeviceKey is a LOOKUP KEY', () => {
  it('accepts the real dbService payload', () => {
    expect(claimMySquaresSchema.safeParse({ poolId: 'p1', guestDeviceKey: 'abc123' }).success).toBe(true);
  });
  it('does NOT trim guestDeviceKey', () => {
    // reserveSquare stores the key untrimmed and claimMySquares matches it with
    // ===. Trimming here would silently stop matching those squares — the exact
    // regression shipped in #194 and fixed in #195.
    expect(claimMySquaresSchema.parse({ poolId: 'p1', guestDeviceKey: ' k ' }).guestDeviceKey).toBe(' k ');
  });
  it('allows an omitted key — currently a no-op, not an error', () => {
    expect(claimMySquaresSchema.safeParse({ poolId: 'p1' }).success).toBe(true);
  });
});

describe('no-input callables must accept BOTH null and {}', () => {
  // dbService calls recalcFn() with no argument at all, which arrives as
  // request.data === null; OperationsPanel sends {}. A bare z.strictObject({})
  // rejects null and the callable never runs — shipped as a real bug in #180.
  it.each([
    ['syncAllUsers', syncAllUsersSchema],
    ['recalculateGlobalStats', recalculateGlobalStatsSchema],
  ])('%s accepts null, undefined and {}', (_name, schema) => {
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });
  it.each([
    ['syncAllUsers', syncAllUsersSchema],
    ['recalculateGlobalStats', recalculateGlobalStatsSchema],
  ])('%s still rejects unknown fields', (_name, schema) => {
    expect(schema.safeParse({ rogue: 1 }).success).toBe(false);
  });
});

describe('reconcilePaymentTruth — dry-run must default SAFE at the schema layer (P2)', () => {
  it('defaults dryRun to TRUE when omitted, and only explicit false arms it', () => {
    expect(reconcilePaymentTruthSchema.parse({}).dryRun).toBe(true);
    expect(reconcilePaymentTruthSchema.parse({ dryRun: false }).dryRun).toBe(false);
  });
  it('takes the wire-shape null cursor as first-page (JS SDK undefined→null, #296)', () => {
    expect(reconcilePaymentTruthSchema.safeParse({ dryRun: true, limit: 25, startAfter: null }).success).toBe(true);
    expect(reconcilePaymentTruthSchema.parse({ startAfter: null }).startAfter).toBeUndefined();
    expect(reconcilePaymentTruthSchema.safeParse({ startAfter: 'poolAbc' }).success).toBe(true);
  });
  it('rejects junk cursors, out-of-range limits and unknown fields', () => {
    expect(reconcilePaymentTruthSchema.safeParse({ startAfter: '' }).success).toBe(false);
    expect(reconcilePaymentTruthSchema.safeParse({ startAfter: 42 }).success).toBe(false);
    expect(reconcilePaymentTruthSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(reconcilePaymentTruthSchema.safeParse({ rogue: 1 }).success).toBe(false);
  });
});
