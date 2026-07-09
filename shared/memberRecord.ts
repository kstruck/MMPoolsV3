// Member Record roster model — shared by src/ (dashboards) and functions/ (roster
// callables + aggregate). See docs/adr/0003-unified-pool-roster-model.md.
//
// The Member Record is ONE doc per member per pool (pools/{poolId}/members/{uid}) —
// the roster + payment truth for every pool type, separate from the playable Entry.
// This file is framework-free (no firebase-admin) so both client and functions import it.

export const ROSTER_SCHEMA_VERSION = 1;

export interface MemberRecord {
  uid: string;
  poolId: string;
  userName: string;
  role?: string;                 // 'MANAGER' | 'PARTICIPANT'
  joinedAt?: number;
  paidStatus: 'PAID' | 'UNPAID'; // authoritative, commissioner-set
  paidAt?: number;
  paidBy?: string;               // actor uid who set paidStatus
  memberReportedPaid?: boolean;  // honor-system self-report; never gates play
  memberReportedAt?: number;
  unitsOwned?: number;           // SQUARES: squares owned
  unitsPaid?: number;            // SQUARES: squares paid for
  rebuyOwed?: number;            // dollars owed for rebuys (e.g. survivor)
  rebuyPaid?: number;            // dollars paid for rebuys
  // ADR 0005 Phase 4 — the SINGLE base-dues source for Profit's fee side. Never
  // inferred from entry existence. Stamped at join (participants) / first playable
  // entry (owners — hosting is not playing, so seeded owners start at 0). entryFee
  // edits (OPEN phase only) cascade-update fee-liable records so this never drifts.
  feeOwed?: number;
  feeOwedSource?: 'LIVE' | 'BACKFILL_ESTIMATE';
}

export interface RosterSummary {
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  duesExpected: number;
  duesCollected: number;
  guestUnclaimedDues: number;    // dues from unclaimed squares (no Member Record)
  rosterSchemaVersion: number;
  updatedAt?: number;
}

export interface CommissionerAggregate {
  poolsManaged: number;
  totalParticipants: number;
  duesExpected: number;
  duesCollected: number;
  totalPayouts: number;
  updatedAt?: number;
}

export interface DuesInputs {
  poolType: string;
  entryFee: number;
  costPerSquare?: number; // SQUARES per-unit price; falls back to entryFee
}

/** Dues owed/collected for one member, per pool type. Rebuy dues always add on. */
export function memberDues(m: MemberRecord, inputs: DuesInputs): { expected: number; collected: number } {
  let expected = 0;
  let collected = 0;
  if (inputs.poolType === 'SQUARES') {
    const unit = inputs.costPerSquare ?? inputs.entryFee ?? 0;
    expected += unit * (m.unitsOwned ?? 0);
    collected += unit * (m.unitsPaid ?? 0);
  } else {
    // Per-record feeOwed (ADR 0005) is the base-dues truth when stamped —
    // a seeded owner who never played carries 0. Fall back to the pool fee
    // for records that predate the stamp.
    const fee = m.feeOwed ?? inputs.entryFee ?? 0;
    expected += fee;
    if (m.paidStatus === 'PAID') collected += fee;
  }
  expected += m.rebuyOwed ?? 0;
  collected += m.rebuyPaid ?? 0;
  return { expected, collected };
}

/** A member counts as "paid" when their base dues are covered (squares: all units paid). */
export function isMemberPaid(m: MemberRecord, poolType: string): boolean {
  if (poolType === 'SQUARES') {
    const owned = m.unitsOwned ?? 0;
    return owned > 0 && (m.unitsPaid ?? 0) >= owned;
  }
  return m.paidStatus === 'PAID';
}

/** Fold a pool's Member Records into its Roster Summary. Pure. */
export function computeRosterSummary(
  members: MemberRecord[],
  inputs: DuesInputs,
  guestUnclaimedDues = 0,
): RosterSummary {
  let paidCount = 0;
  let duesExpected = 0;
  let duesCollected = 0;
  for (const m of members) {
    const d = memberDues(m, inputs);
    duesExpected += d.expected;
    duesCollected += d.collected;
    if (isMemberPaid(m, inputs.poolType)) paidCount++;
  }
  return {
    memberCount: members.length,
    paidCount,
    unpaidCount: members.length - paidCount,
    duesExpected,
    duesCollected,
    guestUnclaimedDues,
    rosterSchemaVersion: ROSTER_SCHEMA_VERSION,
  };
}

/** Fold per-pool roster summaries (+ per-pool payouts) into a commissioner rollup. Pure. */
export function foldCommissionerAggregate(
  summaries: RosterSummary[],
  payoutsByPool: number[],
): CommissionerAggregate {
  const agg: CommissionerAggregate = {
    poolsManaged: summaries.length,
    totalParticipants: 0,
    duesExpected: 0,
    duesCollected: 0,
    totalPayouts: 0,
  };
  for (const s of summaries) {
    agg.totalParticipants += s.memberCount;
    agg.duesExpected += s.duesExpected + s.guestUnclaimedDues;
    agg.duesCollected += s.duesCollected;
  }
  for (const p of payoutsByPool) agg.totalPayouts += p || 0;
  return agg;
}
