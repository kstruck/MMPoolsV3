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
  /**
   * Has this uid ever committed a playable Entry in this pool?
   *
   * A ONE-WAY LATCH: `false` at create, upgraded to `true` on first submit, and
   * never lowered. A member cannot un-submit, and losing membership deletes the
   * record outright (`present: false`), so there is no case that clears it.
   *
   * It was previously computed inside `planMembershipWrite` and THROWN AWAY —
   * only its effect on `feeOwed` survived, so nothing could ask the Member
   * Record "has this person ever entered?" without also joining the entries
   * collection. Persisted 2026-07-31 so roster surfaces can answer from one
   * store, and so the fee stamping is auditable after the fact.
   *
   * ⚠️ ABSENT on every record written before that date. Readers MUST treat
   * `undefined` as "unknown", not as `false`, and fall back to entry evidence.
   * `ensureMemberRecord` heals records on touch, so the field fills in over
   * time without a backfill.
   */
  hasPlayableEntry?: boolean;
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

/**
 * Was this Member Record written by a SERVER join path, or could a client have
 * conjured it?
 *
 * The discriminator is `joinedAt`. Every path that CREATES a record stamps it
 * (`planMembershipWrite`, `poolCreation`, `bracketPools`, the NFL join and rebuy
 * paths, `backfillMemberRecords`), and no client path can write it: firestore.rules
 * says `allow create, delete: if false` on this collection and restricts `update`
 * to `memberReportedPaid`/`memberReportedAt`.
 *
 * Those two fields are exactly what the pre-2026-08-02 `setPaidStatus` claim bug
 * wrote when it created a record for a non-member (#344). So a document carrying
 * ONLY them is a forgery, and every surface that treats a Member Record as roster
 * truth must be able to tell the difference — otherwise fixing the write path
 * leaves the records it already minted in force.
 *
 * PRESENCE, not `typeof === 'number'`: `backfillMemberRecords` stamps
 * `pool.createdAt || Date.now()`, and a legacy `createdAt` may be a Firestore
 * Timestamp. A type check there would reject real backfilled members.
 *
 * Lives here rather than in either caller so the two cannot drift: this is the
 * same predicate `isProvableMember` uses to admit a self-report and
 * `resolveReminderTargets` uses to admit a reminder target. If they ever
 * disagreed, one of the two doors would be open.
 */
export function isCanonicalMemberRecord(
  record: { joinedAt?: unknown } | undefined | null,
): boolean {
  const joinedAt = record?.joinedAt;
  return joinedAt !== undefined && joinedAt !== null;
}

/**
 * The literal string squares.ts inserts into `participantIds` for an anonymous
 * reservation. It is a sentinel, never a person.
 */
export const GUEST_SENTINEL = 'guest';

/**
 * Is `uid` a PROVABLE member of this pool? Two checks, both on data the caller
 * has already read — no extra query. See PLAN-SETPAIDSTATUS-MEMBERSHIP §4.
 *
 * ⚠️ There is no third check. Draft 4 accepted claimed-square ownership
 * (`pool.squares[*].reservedByUid === uid`) and review round 5 removed it as
 * ATTACKER-SETTABLE: `firestore.rules` makes every pool document world-readable,
 * so anyone with the pool id can read a `guestDeviceKey` off it and have
 * `claimMySquares` stamp `reservedByUid` for them. Reintroducing a
 * squares-ownership branch here restores the exact authorization route the plan
 * rejected.
 *
 * Callers pass plain data, not snapshots, so the rule is unit-testable.
 *
 * Both document parameters are raw document data (`Record<string, unknown>`),
 * not narrow shapes: this is an authorization predicate and it must accept — and
 * refuse — a document carrying NONE of the fields it looks for. A
 * `{ joinedAt?: unknown }` parameter made the forged-record case
 * (`{ memberReportedPaid, memberReportedAt }`) a TS2559 compile error, i.e. the
 * type declared the most important input impossible. It is not; it is the one
 * this guard exists for. (codex r1)
 *
 * ⚠️ LIVES IN `shared/` AND IS USED BY THREE DOORS. It began functions-side as
 * the `setPaidStatus` write guard; it moved here when the commissioner ROSTER
 * needed the same question answered (`src/utils/poolRoster.ts`). Do not copy the
 * two-evidence rule into a caller — the whole reason `isCanonicalMemberRecord`
 * sits beside it is that two doors with two copies is how one of them ends up
 * open.
 */
export function isProvableMember(
  pool: Record<string, unknown> | undefined,
  memberRecord: Record<string, unknown> | undefined,
  uid: string,
): boolean {
  // The sentinel is not an account. Rejected up front rather than only inside
  // the participantIds check: an authenticated user whose Firebase uid is the
  // literal string `guest` would otherwise be admitted to every pool holding a
  // single anonymous square reservation.
  if (!uid || uid === GUEST_SENTINEL) return false;

  // Evidence 1 — a CANONICAL Member Record. Mere existence proves nothing,
  // because the claim path this guard protects is itself a way to create one:
  // accepting existence would ratify a record forged before the fix.
  if (isCanonicalMemberRecord(memberRecord)) return true;

  // Evidence 2 — the pool's own cross-type membership set. Every join path
  // writes it, and writing it needs `isPoolManager()`, so no self-add. A manager
  // listing someone as a participant IS membership.
  const ids = pool?.participantIds;
  return Array.isArray(ids) && ids.includes(uid);
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
