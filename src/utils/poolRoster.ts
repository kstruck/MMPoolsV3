// ONE definition of the commissioner roster and its money totals.
//
// Three surfaces derived these independently before this file existed:
//
//   * `NFLManagerView`'s `roster`  — participantIds + Member Records + entries,
//     the merge that makes the Member Roster panel correct.
//   * `PaymentsPanel`'s `pot`      — the dues maths, hardened over four codex
//     rounds on PLAN-PAYMENT-TRUTH P3 (legacy un-stamped rebuys, partially
//     backfilled pools, rebuyOwed as EXPECTED not collected money).
//   * `NFLManagerBentoDashboard`'s `ledgerStats` — **entries only**, which is
//     the defect this file was created to kill: a pool whose members hold
//     Member Records but no entry documents showed `$0` projected/collected and
//     "No members matching filter criteria" on the Buy-In Ledger card and in the
//     Advanced Payment Ledger modal, while the Member Roster panel on the SAME
//     page listed those members correctly. Root cause is the half of D13 that
//     P1 could not reach: `setPaidStatus.ts` mirrors display fields onto the
//     entry only `if (entrySnap.exists)`, so an entry-backed reader is blind to
//     every member who has not submitted one.
//
// Nothing here is new maths. The roster merge and the dues maths were MOVED,
// comments included, so all three surfaces answer from one place — the same
// one-definition fix as #315 (sim-pool rule), #319 (seasonType) and
// HANDOFF item 11 (NFL_SEASON_TYPES).
//
// SQUARES is deliberately out of scope: per-unit dues live in
// `shared/memberRecord.ts` `memberDues`, and no caller of this file is a
// SQUARES surface. Keep it that way rather than growing a second unit model.

export interface RosterInputs {
  /** The pool doc. Only `participantIds`, `ownerId` and `settings` are read. */
  pool: any;
  /** Member Records (`pools/{id}/members`) — roster truth, ADR 0003. */
  members: any[];
  /** Playable entries (`pools/{id}/entries`) — picks, scores, display mirrors. */
  entries: any[];
}

export interface RosterRow {
  uid: string;
  /** Undefined when neither store carries a name; callers supply their own fallback. */
  userName?: string;
  email?: string;
  /** Resolved paid status: the Member Record wins when one exists. */
  paidStatus: 'PAID' | 'UNPAID';
  hasMember: boolean;
  hasEntry: boolean;
  entry?: any;
  memberPaid?: string;
  entryPaid?: string;
  /** Payment detail. `setPaidStatus` writes these onto BOTH stores; the Member Record wins. */
  paymentMethod?: string;
  paidAt?: number | null;
  paymentNote?: string | null;
  feeOwed?: number;
  rebuyOwed?: number;
  rebuyPaid?: number;
  rebuysUsed?: number;
  status?: string;
  strikesUsed?: number;
  seasonTotal?: number;
  isOwner: boolean;
}

/** Entry docs are keyed by uid for NFL pools, but prefer `ownerUid` when present. */
const uidOf = (entry: any): string => entry?.ownerUid || entry?.id;

/**
 * Every uid that counts as a person on this pool, from all three evidence
 * sources. 'guest' is the unclaimed-square sentinel, never a person.
 *
 * codex r1: the head count used to be
 * `Math.max(members.length, participantIds.length, entries.length)`, which is
 * the roster size only when the sets nest. On a legacy or partially backfilled
 * pool where an ENTRY exists for someone absent from both `members` and
 * `participantIds`, the max undercounts — and then
 * `memberCount - members.length` is 0, so that person's base fee silently drops
 * out of `expected` while `buildPoolRoster` still lists them. The head count and
 * the roster must come from the same set or the card can disagree with itself.
 */
function rosterUids({ pool, members, entries }: RosterInputs): Set<string> {
  const uids = new Set<string>();
  const add = (uid: string | undefined) => {
    if (uid && uid !== 'guest') uids.add(uid);
  };
  for (const uid of (pool?.participantIds || [])) add(uid);
  for (const m of members || []) add(m?.uid);
  for (const e of entries || []) add(uidOf(e));
  return uids;
}

/** First defined value — `??` chains, but tolerant of a missing intermediate object. */
const pick = <T>(...vals: (T | undefined | null)[]): T | undefined => {
  for (const v of vals) if (v !== undefined) return v as T;
  return undefined;
};

/**
 * Roster = everyone who JOINED, enriched with Member Records (name +
 * authoritative paidStatus + payment detail) and entries (picks/status/score).
 * Members without an entry — including the commissioner — appear the moment
 * they join, before any pick is made (ADR 0003). Falls back gracefully to
 * entries when Member Records are absent (pre-backfill).
 *
 * Pure. Unsorted — callers sort for their own surface.
 */
export function buildPoolRoster({ pool, members, entries }: RosterInputs): RosterRow[] {
  const byUid = new Map<string, any>();
  const put = (uid: string, patch: any) => {
    // 'guest' is the unclaimed-square sentinel, never a person.
    if (!uid || uid === 'guest') return;
    byUid.set(uid, { ...(byUid.get(uid) || { uid }), ...patch, uid });
  };
  for (const uid of (pool?.participantIds || [])) put(uid, {});
  for (const m of members || []) {
    put(m.uid, {
      userName: m.userName,
      memberPaid: m.paidStatus,
      hasMember: true,
      feeOwed: m.feeOwed,
      rebuyOwed: m.rebuyOwed,
      rebuyPaid: m.rebuyPaid,
      memberPaymentMethod: m.paymentMethod,
      memberPaidAt: m.paidAt,
      memberPaymentNote: m.paymentNote,
    });
  }
  for (const e of entries || []) {
    const uid = uidOf(e);
    put(uid, {
      entry: e,
      hasEntry: true,
      entryPaid: e.paidStatus,
      // A Member Record name already put here wins — it is the roster's name.
      userName: byUid.get(uid)?.userName || e.userName || e.ownerName,
      email: e.email,
      status: e.status,
      strikesUsed: e.strikesUsed,
      rebuysUsed: e.rebuysUsed,
      seasonTotal: e.seasonTotal,
      entryPaymentMethod: e.paymentMethod,
      entryPaidAt: e.paidAt,
      entryPaymentNote: e.paymentNote,
    });
  }
  const ownerId = pool?.ownerId;
  return [...byUid.values()].map((r) => ({
    ...r,
    hasMember: !!r.hasMember,
    hasEntry: !!r.hasEntry,
    // The Member Record is authoritative when one exists; the entry is a mirror
    // that only `setPaidStatus` maintains, and only when the entry exists.
    paidStatus: (r.hasMember ? r.memberPaid || 'UNPAID' : r.entryPaid || 'UNPAID') as 'PAID' | 'UNPAID',
    paymentMethod: pick<string>(r.memberPaymentMethod, r.entryPaymentMethod),
    paidAt: pick<number | null>(r.memberPaidAt, r.entryPaidAt),
    paymentNote: pick<string | null>(r.memberPaymentNote, r.entryPaymentNote),
    isOwner: !!ownerId && r.uid === ownerId,
  }));
}

/**
 * Who has NOT submitted for a week, over the whole roster.
 *
 * WHY THIS IS A FUNCTION AND NOT AN INLINE `useMemo`. It used to be inline on
 * the commissioner Bento card and it filtered `entries`, so a member who joined
 * and never submitted — Member Record, no entry document — was in neither the
 * pending list nor the denominator. The card reported readiness over a SUBSET
 * of the pool: one submitted entry beside three joined-but-unpicked members
 * read "1 of 1 — 100%". Same root cause as the Buy-In Ledger defect (#322,
 * D13 P1): `setPaidStatus` mirrors onto the entry only `if (entrySnap.exists)`,
 * so nothing entry-backed can see an entry-less member.
 *
 * Extracted so the rule can be tested directly. The previous fix on this card
 * shipped a guard that pinned the plumbing without pinning that the fix CHANGED
 * anything, and it survived mutation; a pure function does not have that
 * problem.
 *
 * Completeness rules, unchanged from the inline version:
 *   - no entry at all      -> pending, every pool type
 *   - NFL_PICKEM           -> pending if ANY game in the week has no pick
 *   - SURVIVOR / MARGIN    -> pending if no pick stored under the week number
 *
 * A pick'em week with NO games yields nobody pending among entry holders: there
 * is nothing to pick, so calling them delinquent would be wrong.
 */
export function unsubmittedRoster(
  roster: RosterRow[],
  opts: { poolType?: string; week: number; weeklyGameIds: string[] },
): RosterRow[] {
  const { poolType, week, weeklyGameIds } = opts;
  return roster.filter((r) => {
    if (!r.hasEntry) return true;
    const picks = r.entry?.picks || {};
    if (poolType === 'NFL_PICKEM') {
      return weeklyGameIds.length > 0 && !weeklyGameIds.every((id) => !!picks[id]);
    }
    return !picks[week];
  });
}

export interface PotStats {
  /** Everyone who joined, however they are evidenced. */
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  /**
   * Members who OWE NOTHING — base dues covered (or zero) and no rebuy debt.
   *
   * Distinct from `paidCount` on purpose (codex r5). A seeded owner carries
   * `feeOwed: 0` with `paidStatus: 'UNPAID'`, and on a free pool EVERY member
   * does, so a paid-status count reports 0 cleared while Expected and
   * Outstanding are both $0. Conversely a member whose base dues are PAID can
   * still owe a rebuy (P3), so `paidCount` overstates clearance there.
   */
  clearedCount: number;
  /** Base dues actually marked PAID, plus settled rebuy dollars. */
  collected: number;
  /** Base dues owed by everyone who joined, plus rebuy dues owed. */
  expected: number;
}

/** Fee inputs read off a pool, in one place so callers cannot disagree. */
export interface DuesRates {
  entryFee: number;
  rebuyCost: number;
}

export function duesRates(pool: any): DuesRates {
  const settings = pool?.settings || {};
  // `?? 0`, never `|| 20`: a free pool has no entry fee, and inventing one
  // reports money that was never owed. The Bento ledger defaulted to 20.
  const entryFee: number = settings.entryFee ?? 0;
  return { entryFee, rebuyCost: settings.rebuyCost ?? entryFee };
}

/**
 * What ONE roster row still owes — base dues plus unsettled rebuy dues.
 *
 * codex r5: "unpaid" is not a payment STATUS on this card, it is a DEBT. A
 * seeded owner (`feeOwed: 0`, hosting is not playing) and every member of a free
 * pool carry `paidStatus: 'UNPAID'` while owing nothing, so a status-only filter
 * put them in the Buy-In Ledger's unpaid queue with a meaningless "Mark Paid"
 * button, and kept the card from ever reaching its all-clear even with Expected
 * and Outstanding Due both $0.
 *
 * Pure. Never negative — an overpaid rebuy is not a credit against base dues.
 */
export function memberOutstanding(row: RosterRow, rates: DuesRates): number {
  const fee = row.feeOwed ?? rates.entryFee;
  const base = row.paidStatus === 'PAID' ? 0 : fee;
  // Un-stamped legacy rebuys fall back to entry evidence, same rule as the pot.
  const rebuyOwed =
    typeof row.rebuyOwed === 'number'
      ? row.rebuyOwed
      : (row.rebuysUsed ?? 0) * rates.rebuyCost;
  return Math.max(0, base) + Math.max(0, rebuyOwed - (row.rebuyPaid ?? 0));
}

/**
 * Pool money totals. Prefers the Member Record roster (everyone who joined) so
 * the count and expected dues are right even before members submit entries;
 * falls back to entries pre-backfill.
 *
 * Mirrors `shared/memberRecord.ts` `memberDues`: collected = paid base fees +
 * `rebuyPaid`. An OWED rebuy is EXPECTED money, not collected money (codex r1
 * on P3 — the old maths booked every rebuy as collected the moment it happened,
 * which is defect D12 wearing a UI hat).
 *
 * Pure.
 */
export function rosterPotStats({ pool, members, entries }: RosterInputs): PotStats {
  const { entryFee, rebuyCost } = duesRates(pool);
  const memberList = members || [];
  const entryList = entries || [];

  // Same set buildPoolRoster produces rows from, so the head count and the roster
  // can never disagree.
  const uids = rosterUids({ pool, members, entries });
  const memberCount = uids.size;

  if (memberList.length > 0) {
    const entryByUid = new Map(entryList.map((e: any) => [uidOf(e), e]));
    let expected = 0;
    let collected = 0;
    let paid = 0;
    for (const m of memberList) {
      const fee = m.feeOwed ?? entryFee; // ADR 0005: a seeded owner carries 0
      // Un-stamped legacy rebuys fall back to entry evidence (codex r3);
      // a stamped value — including 0 — is trusted as-is.
      const rebuyOwed =
        typeof m.rebuyOwed === 'number'
          ? m.rebuyOwed
          : ((entryByUid.get(m.uid) as any)?.rebuysUsed ?? 0) * rebuyCost;
      expected += fee + rebuyOwed;
      if (m.paidStatus === 'PAID') {
        collected += fee;
        paid++;
      }
      collected += m.rebuyPaid ?? 0;
    }
    // Anyone on the roster with no Member Record yet still owes the fee — and
    // their entry's rebuys (codex r4: a partially backfilled pool dropped
    // unmatched entries' rebuy dues from Expected). Walked per-uid rather than as
    // a count difference, so a person evidenced only by an entry is charged
    // instead of vanishing (codex r1 on this PR).
    //
    // Their PAYMENT is read off the entry, because that is what `buildPoolRoster`
    // reads for the row it renders (codex r2 on this PR): charging them in
    // `expected` while ignoring `entry.paidStatus` made the card show a PAID row
    // and simultaneously understate Collected and Clearing Rate and overstate
    // Outstanding Due. The old entries-backed ledger did count that payment, so
    // omitting it would have been a regression, not merely an omission.
    const memberUids = new Set(memberList.map((m: any) => m.uid));
    for (const uid of uids) {
      if (memberUids.has(uid)) continue;
      const e: any = entryByUid.get(uid);
      expected += entryFee + (e?.rebuysUsed ?? 0) * rebuyCost;
      if (e?.paidStatus === 'PAID') {
        collected += entryFee;
        paid++;
      }
    }
    return {
      memberCount,
      paidCount: paid,
      unpaidCount: Math.max(0, memberCount - paid),
      clearedCount: clearedCountFor({ pool, members, entries }),
      collected,
      expected,
    };
  }

  // Pre-backfill fallback: entries carry no settlement state, so rebuys count
  // toward expected only.
  const paid = entryList.filter((e: any) => e.paidStatus === 'PAID').length;
  const totalRebuys = entryList.reduce((sum: number, e: any) => sum + (e.rebuysUsed ?? 0), 0);
  return {
    memberCount,
    paidCount: paid,
    unpaidCount: Math.max(0, memberCount - paid),
    clearedCount: clearedCountFor({ pool, members, entries }),
    collected: paid * entryFee,
    expected: memberCount * entryFee + totalRebuys * rebuyCost,
  };
}

/**
 * Members owing nothing, counted off the SAME rows the card renders rather than
 * re-derived — so "Unpaid Members (N)" and Clearing Rate can never disagree with
 * the list sitting under them.
 */
function clearedCountFor(inputs: RosterInputs): number {
  const rates = duesRates(inputs.pool);
  return buildPoolRoster(inputs).filter((r) => memberOutstanding(r, rates) === 0).length;
}

/** Dues still owed. Never negative — an overpaid rebuy must not read as a credit. */
export const outstandingDue = (pot: PotStats): number => Math.max(0, pot.expected - pot.collected);

/**
 * Share of the roster that OWES NOTHING, 0-100, integer.
 *
 * codex r5: this counted paid STATUS, so a free pool — and any pool's seeded
 * owner, who carries `feeOwed: 0` — read 0% cleared beside Outstanding Due of
 * $0. On a pool where everyone owes the same fee the two definitions agree; they
 * diverge exactly where the status is not the debt.
 */
export const clearingRate = (pot: PotStats): number =>
  pot.memberCount > 0 ? Math.round((pot.clearedCount / pot.memberCount) * 100) : 0;
