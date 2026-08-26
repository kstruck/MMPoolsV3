// Member Record roster model — shared by src/ (dashboards) and functions/ (roster
// callables + aggregate). See docs/adr/0003-unified-pool-roster-model.md.
//
// The Member Record is ONE doc per member per pool (pools/{poolId}/members/{uid}) —
// the roster + payment truth for every pool type, separate from the playable Entry.
// This file is framework-free (no firebase-admin) so both client and functions import it.

/**
 * 1 → 2 on 2026-08-21: `RosterSummary.playerUids` (PLAN-MEMBER-PICK-PROGRESS D7).
 * Purely additive — no reader is required to consume it and no backfill is run.
 */
export const ROSTER_SCHEMA_VERSION = 2;

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
  /**
   * Weeks this member has saved AT LEAST ONE pick for, ascending.
   *
   * The whole point of this field is to let the standings table say "Hidden"
   * instead of "No selection" for a player whose picks the viewer may not read
   * yet (PLAN-COMMISSIONER-BLIND-PICKS D1). It says only THAT a pick exists —
   * never how many, and never which — because this record is readable by every
   * participant (`firestore.rules` members block). A per-week COUNT here would
   * tell the whole pool how far through their sheet each player is; that
   * reading belongs to the commissioner only and comes from `getPoolPicks`.
   *
   * Union-only: weeks are added, never removed. A member cannot un-pick, and
   * losing membership deletes the record outright.
   *
   * ⚠️ ABSENT until this member's first submit — including on every record
   * written before 2026-08-12. `undefined` means "the answer is unknown" and
   * MUST render as "—", never as "No selection"; `[]` would mean "picked no
   * week", and nothing writes that. The join path deliberately does NOT seed it,
   * because that path also backfills a Member Record for a legacy participant
   * who may already have weeks of picks — same unknown-is-not-false discipline
   * as `hasPlayableEntry` above, and the same trap.
   *
   * Fix-forward, per Kevin's ruling: there is no backfill, so on a legacy record
   * the weeks picked before its owner's next submit stay unknown, and once that
   * submit lands they read "No selection".
   */
  pickedWeeks?: number[];
  /**
   * PLAN-MULTI-ENTRY D2. How many of this member's entries have committed at
   * least one pick — the multiplier on `feeOwed` (K3). A one-way COUNTER,
   * derived transactionally from the owner's entry docs (never trusted from a
   * stored value under retries) and never lowered (deleting an entry is out of
   * scope — K7). `hasPlayableEntry` stays `count > 0` so every reader is
   * unchanged. ABSENT on every record written before T2: readers treat
   * `undefined` as `hasPlayableEntry ? 1 : 0` (`memberLiableEntries`).
   */
  playableEntryCount?: number;
  /**
   * PLAN-MULTI-ENTRY D2/D6 — the authorization-safe roster of this member's
   * entries: existence + index + display name, NEVER picks and never per-entry
   * weeks (a participant-readable record must not say which entry has a pick
   * for an unrevealed week — that completeness is the commissioner's, via
   * `getPoolPicks.counts`). Keyed by entry id (`entryIdFor`). Rebuilt from the
   * owner's entry docs on every submit that touches them, so a legacy record
   * gains entry #1 the first time its owner submits under multi-entry.
   */
  entries?: Record<string, { entryIndex: number; name?: string }>;
  /**
   * PLAN-MULTI-ENTRY-DUES D1 — which of this member's entries have been PAID
   * for, keyed by entry id (`entryIdFor`).
   *
   * 🛑 PRESENCE IS THE PAID SIGNAL. There is deliberately **no `paid: boolean`**
   * (D1b): an id present in this map is paid, absent is not. Un-marking DELETES
   * the key — never `{paid: false}` and never `{}`. With a boolean, `{paid:false}`
   * and an absent key would be two spellings of one fact and every reader would
   * have to handle both; an `{}` value with no boolean would read as PAID, which
   * is the failure a boolean is meant to prevent and does not.
   *
   * ⚠️ ABSENT on every record written before this ticket. `undefined` means "no
   * per-entry detail recorded" — NOT "nothing is paid". Readers fall back to
   * `paidStatus`, which is still the stored summary. Same unknown-is-not-false
   * discipline as `hasPlayableEntry` and `pickedWeeks` above.
   *
   * ⚠️ Entry ids contain `:` (`e2:uid`), so a nested delete needs
   * `new FieldPath('paidEntries', entryId)` rather than a dotted string path.
   */
  paidEntries?: Record<string, { paidAt?: number; method?: string; note?: string }>;
}

/**
 * How many entries this member is LIABLE for — the multiplier on the entry
 * fee (PLAN-MULTI-ENTRY D2) and the unit `pool.entryCount` sums (D8).
 *
 * `max(joinLiability, playableEntryCount)`: an ordinary member owes ONE fee
 * from the moment they join, whether or not they ever pick (today's contract —
 * `feeOwed` is stamped at join, never inferred from entry existence); a seeded
 * MANAGER owes 0 until their first playable entry (hosting is not playing).
 * Additional entries count only once they have committed a pick.
 *
 * Legacy defaults: `playableEntryCount` absent ⇒ `hasPlayableEntry ? 1 : 0`;
 * a MANAGER whose record predates the latch but carries `feeOwed > 0` was
 * charged for playing, so counts 1.
 */
export function memberLiableEntries(
  m: Pick<MemberRecord, 'role' | 'feeOwed' | 'hasPlayableEntry' | 'playableEntryCount'>,
): number {
  const joinLiability = m.role === 'MANAGER' ? 0 : 1;
  return Math.max(joinLiability, memberPlayedEntries(m));
}

/** The "played" half of `memberLiableEntries`: entries that have committed a pick, with the legacy defaults above. */
export function memberPlayedEntries(
  m: Pick<MemberRecord, 'role' | 'feeOwed' | 'hasPlayableEntry' | 'playableEntryCount'>,
): number {
  return typeof m.playableEntryCount === 'number'
    ? m.playableEntryCount
    : (m.hasPlayableEntry === true || (m.role === 'MANAGER' && (m.feeOwed ?? 0) > 0) ? 1 : 0);
}

/**
 * PLAN-MULTI-ENTRY-DUES D1 — the entry ids this member is LIABLE for: the rows
 * the ledger charges, and the exact set `derivePaidStatus` requires to be paid.
 *
 * 🛑 `pickedEntryIds` IS AN ARGUMENT, AND THAT IS AN AUTHORIZATION DECISION.
 * Liability is "this entry has committed a pick", and the Member Record does not
 * carry that per entry — `entries` is documented above as "NEVER picks and never
 * per-entry weeks", because a participant-readable record must not say which
 * entry has a pick for an unrevealed week (commissioner-blind picks).
 * `playableEntryCount` is a COUNT, not a set, so with entries 1 and 2 and one
 * pick between them the liable id is unknowable from the record alone.
 *
 * So the caller supplies the ids from its own transactional read of the entry
 * documents — `ownerStateAfter` returns them for exactly this — and they are
 * never written back to the record. Storing a per-entry `liable` flag would be
 * the forbidden bit itself: early in a season, when only week 1 exists and is
 * unrevealed, "entry X is liable" and "entry X picked week 1" are the same
 * statement. If a ticket concludes it needs that, STOP and ask Kevin (D11).
 *
 * 🛑 `pickedEntryIds` IS THE AUTHORITY, AND IS NOT INTERSECTED WITH `entries`.
 * It is read from the entry documents; `entries` is a mirror rebuilt on submit
 * and is ABSENT on legacy records. Intersecting would drop liable ids whenever
 * the mirror is stale — making a member owe LESS and derive PAID more easily,
 * which is the money-lie direction. The docs win.
 *
 * The empty-set fallback is D1's synthetic id: a participant owes one fee from
 * the moment they JOIN, before any entry document exists, and entry #1's id is
 * the bare `uid` (parent plan D1) — so they get exactly one payable row rather
 * than none. A seeded MANAGER who has never played has `memberLiableEntries` 0
 * and is liable for NOTHING, which is what keeps `derivePaidStatus` from
 * turning them green (N1/R2).
 */
export function liableEntryIds(
  // NOTE the absence of `entries`. It is NOT in this Pick because this function
  // does not read the mirror, per the paragraph above — the type is the cheapest
  // place for that decision to be visible, and listing a field we ignore would
  // invite the intersection back in.
  m: Pick<MemberRecord, 'role' | 'feeOwed' | 'hasPlayableEntry' | 'playableEntryCount'>,
  uid: string,
  pickedEntryIds: readonly string[],
): string[] {
  const picked = sanitizeEntryIds(pickedEntryIds).sort();
  if (picked.length > 0) return picked;
  return memberLiableEntries(m) > 0 ? [uid] : [];
}

/**
 * Distinct, non-blank entry ids. Used by BOTH helpers below and above, and that
 * duplication is the point (codex r3 #1, r4 #3).
 *
 * 🛑 `derivePaidStatus` SANITIZES ITS OWN ARGUMENT rather than trusting
 * `liableEntryIds` to have done it, because it is exported and any writer may
 * build a list by hand. Two concrete bypasses, both of which produced a false
 * PAID before this existed:
 *
 * - **duplicates defeat the count guard.** `['u1','u1']` has length 2, so a
 *   member owing two entries passes the `>= memberLiableEntries` check while ONE
 *   real row is paid.
 * - **a blank id can be paid off.** `liable: ['']` with a `paidEntries['']` key
 *   satisfies the presence test against a row that cannot exist — a Firestore
 *   document id is never empty, so one arriving here is caller garbage.
 *
 * Both shrink the set, which moves the answer toward UNPAID: the safe direction
 * for money, and never a false PAID.
 */
function sanitizeEntryIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(id => typeof id === 'string' && id.length > 0);
}

/**
 * Is `id` marked paid in this map? Presence of a WELL-FORMED row (D1b).
 *
 * ⚠️ `hasOwnProperty`, NOT `id in paid`. `in` walks the prototype chain, so an id
 * colliding with an `Object.prototype` key would read as paid against a map that
 * never mentioned it.
 *
 * ⚠️ AND THE VALUE MUST BE AN OBJECT (codex r5 #1). `{}` IS paid — D1b is
 * explicit that there is no `paid: boolean` and metadata is optional — but a
 * `null` value is not a row, it is malformed data, and Firestore will happily
 * store one. The realistic way it arrives is a writer that "un-marks" by writing
 * a falsy value instead of DELETING the key, which is the exact mistake D1b
 * forbids; reading that as PAID would report money collected that was just
 * disclaimed. Malformed money data fails closed.
 */
function isPaidRow(paid: Record<string, unknown>, id: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(paid, id)) return false;
  const row = paid[id];
  if (typeof row !== 'object' || row === null) return false;
  // 🛑 A PLAIN OBJECT, not merely "an object" (codex r5 #1, r6, r7 #1).
  // `typeof` says 'object' for `null`, arrays, AND every class instance the
  // Firestore SDKs hand back — `Timestamp`, `GeoPoint`, `DocumentReference`.
  // The realistic arrival is a writer doing `paidEntries[id] = serverTimestamp()`
  // instead of `{ paidAt }`: schema-wrong, and it would read as a payment.
  //
  // Checking the prototype rejects that whole class at once, and — this is why
  // it is done this way — WITHOUT importing anything. This module is
  // deliberately framework-free so the client can bundle it; `instanceof
  // Timestamp` would drag `firebase-admin` in and break that. A map field
  // deserialises to a plain object in both SDKs, so a real row always passes.
  const proto = Object.getPrototypeOf(row);
  return proto === Object.prototype || proto === null;
}

/**
 * PLAN-MULTI-ENTRY-DUES D1 — the STORED summary `paidStatus`, recomputed from
 * the per-entry map. Pure; every writer calls this rather than deciding for
 * itself, so the stored flag and the map cannot disagree (D1a).
 *
 * 🛑 THE EMPTY-SET TRAP, WHICH IS WHY THE GUARD IS FIRST. `[].every(...)` is
 * `true`, so a naive `every` reports a member with NO liable entries as PAID —
 * turning every seeded commissioner green. They are UNPAID today, with
 * `feeOwed: 0`, and roster chips render that. `liableEntryIds` returns `[]` for
 * exactly that member, so this guard is the whole of N1/R2.
 *
 * ⚠️ `hasOwnProperty`, NOT `id in paidEntries`. `in` walks the prototype chain,
 * so an id colliding with an `Object.prototype` key would read as paid against a
 * map that never mentioned it. Entry ids are `uid` / `eN:uid` and should never
 * collide, which is the argument for the cheap check rather than against it.
 */
export function derivePaidStatus(
  m: Pick<MemberRecord, 'role' | 'feeOwed' | 'hasPlayableEntry' | 'playableEntryCount' | 'paidEntries'>,
  liable: readonly string[],
): 'PAID' | 'UNPAID' {
  // Sanitized HERE, not trusted from the caller — see `sanitizeEntryIds`.
  const ids = sanitizeEntryIds(liable);
  if (ids.length === 0) return 'UNPAID';
  // 🛑 FEWER ROWS THAN THE FEE COVERS CAN NEVER DERIVE PAID (codex r3 #2/#3).
  // `feeOwed` is `entryFee x memberLiableEntries(m)`, so if the caller's entry
  // evidence yields FEWER liable rows than the stored counter, paying every row
  // shown would settle less money than the member owes and still report PAID.
  // That is the money lie this whole plan exists to remove, arriving through the
  // back door: a writer that reads a partial entry set (`reconcilePaymentTruth`
  // reads ONE entry doc, D1a) or passes `[]` for a member who has played.
  // Fail closed. A legitimate caller never trips this - the picked ids ARE
  // `playableEntryCount` when both come from the same transactional read, and
  // the synthetic-uid fallback is exactly 1 when `memberLiableEntries` is 1.
  // Evidence LARGER than the counter is allowed: the entry docs outrank a stale
  // or absent stored count, and more rows owed is the safe direction.
  if (ids.length < memberLiableEntries(m)) return 'UNPAID';
  const paid = m.paidEntries;
  if (!paid) return 'UNPAID';
  return ids.every(id => isPaidRow(paid, id)) ? 'PAID' : 'UNPAID';
}

/**
 * D8 — `pool.entryCount` for an NFL pool that never had one, derived from the
 * Member Records' liabilities. Only CANONICAL records count: a forged
 * `{memberReportedPaid}` doc (#344) is not a member and owes nothing.
 */
export function deriveEntryCount(members: Array<Record<string, unknown>>): number {
  let n = 0;
  for (const m of members) {
    if (!isCanonicalMemberRecord(m as { joinedAt?: unknown })) continue;
    n += memberLiableEntries(m as unknown as MemberRecord);
  }
  return n;
}

export interface RosterSummary {
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  duesExpected: number;
  duesCollected: number;
  guestUnclaimedDues: number;    // dues from unclaimed squares (no Member Record)
  /**
   * The pool's ELIGIBLE PLAYERS — canonical member uids, minus a host who is not
   * playing. Schema 2. `PLAN-MEMBER-PICK-PROGRESS` D7.
   *
   * 🛑 THIS IS THE DENOMINATOR OF "12 of 16 players have their picks in", AND
   * IT IS NOT `memberCount`. Adversarial review rewrote the predicate that builds
   * it five times, and every wrong version reported that everyone was done when
   * they were not. Before changing it, read `eligiblePlayerUids` below and
   * `PLAN-MEMBER-PICK-PROGRESS-REVIEW-LOG.md`.
   *
   * ABSENT on a schema-1 document, and `getPoolPicks` treats absent as "we cannot
   * answer" — it reports `{complete: 0, total: 0}` and the client shows nothing,
   * rather than guessing from a source that is incomplete or forgeable. No
   * backfill: `recomputeRosterSummary` runs on every membership change, so a live
   * pool gains the field on its next join, leave or payment edit.
   */
  playerUids?: string[];
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

/**
 * The pool's ELIGIBLE PLAYERS: whose completed picks the pool-wide progress
 * fraction counts, and out of how many. `PLAN-MEMBER-PICK-PROGRESS` D7. Pure.
 *
 * 🛑 FIVE ROUNDS OF ADVERSARIAL REVIEW REWROTE THIS PREDICATE, AND EVERY WRONG
 * VERSION FAILED THE SAME WAY — by reporting that everyone was done when somebody
 * was not. All five are recorded here so none can be re-derived from its own
 * plausibility:
 *
 *   ❌ the owners of entry documents  — misses a player who joined and has never
 *      picked, so a pool where four people have not started reads "12 of 12".
 *   ❌ `pool.participantIds`          — a manager could historically write
 *      arbitrary uids into it and the rules fix evicted nobody.
 *   ❌ `members.length` alone         — gives no uid set, so a DEPARTED member's
 *      complete entry silently covers for a current member's missing one.
 *   ❌ `hasPlayableEntry` alone       — the latch is `false` for a non-playing
 *      host AND for a member who joined and has not picked yet. Filtering on it
 *      drops the second population, which is the first failure again.
 *   ❌ every commissioner            — `coManagers` are canonical members PROMOTED
 *      to co-commissioner, and `managerUid` can be a distinct principal who
 *      plays. Excluding them drops real players.
 *
 * What survives: **canonical records only, minus the HOST record while its latch
 * is explicitly false.** Only the pool's own creator is put on a roster for a
 * reason other than playing (`nflPools.ts` seeds them `hasPlayableEntry: false`
 * — "Hosting is not playing"), so it is the only uid this may drop — and only
 * while that latch says so. A host who does play flips the latch on their first
 * submission and rejoins by the normal route.
 *
 * `=== false`, never falsy: an UNDEFINED latch on a legacy record is not evidence
 * of anything, and that member stays in. Same unknown-is-not-false discipline
 * `lib/memberRecord.ts` keeps for the field itself.
 */
export function eligiblePlayerUids(
  members: MemberRecord[],
  /**
   * The pool's creator: `ownerId || createdByUid || managerUid`, the repo's
   * established owner precedence (`billing.ts:401`). Both ends of that chain are
   * load-bearing — see `lib/rosterSummary.ts` for why neither `managerUid` first
   * nor `createdByUid` omitted is safe.
   */
  hostUid: string | undefined,
): string[] {
  return members
    .filter(isCanonicalMemberRecord)
    .filter((m) => !(!!hostUid && m.uid === hostUid && m.hasPlayableEntry === false))
    .map((m) => m.uid);
}

/** Fold a pool's Member Records into its Roster Summary. Pure. */
export function computeRosterSummary(
  members: MemberRecord[],
  inputs: DuesInputs,
  guestUnclaimedDues = 0,
  /** `ownerId || createdByUid || managerUid` — drives `playerUids` (D7). */
  hostUid?: string,
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
    playerUids: eligiblePlayerUids(members, hostUid),
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
