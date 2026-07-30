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

export interface PotStats {
  /** Everyone who joined, however they are evidenced. */
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  /** Base dues actually marked PAID, plus settled rebuy dollars. */
  collected: number;
  /** Base dues owed by everyone who joined, plus rebuy dues owed. */
  expected: number;
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
  const settings = pool?.settings || {};
  // `?? 0`, never `|| 20`: a free pool has no entry fee, and inventing one
  // reports money that was never owed. The Bento ledger defaulted to 20.
  const entryFee: number = settings.entryFee ?? 0;
  const rebuyCost: number = settings.rebuyCost ?? entryFee;
  const memberList = members || [];
  const entryList = entries || [];

  const realParticipants = ((pool?.participantIds || []) as string[]).filter((id) => id && id !== 'guest');
  const memberCount = Math.max(memberList.length, realParticipants.length, entryList.length);

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
    // Participants who joined but have no Member Record yet still owe the fee —
    // and their entry's rebuys (codex r4: a partially backfilled pool dropped
    // unmatched entries' rebuy dues from Expected).
    expected += Math.max(0, memberCount - memberList.length) * entryFee;
    const memberUids = new Set(memberList.map((m: any) => m.uid));
    for (const e of entryList as any[]) {
      if (!memberUids.has(uidOf(e))) expected += (e.rebuysUsed ?? 0) * rebuyCost;
    }
    return { memberCount, paidCount: paid, unpaidCount: Math.max(0, memberCount - paid), collected, expected };
  }

  // Pre-backfill fallback: entries carry no settlement state, so rebuys count
  // toward expected only.
  const paid = entryList.filter((e: any) => e.paidStatus === 'PAID').length;
  const totalRebuys = entryList.reduce((sum: number, e: any) => sum + (e.rebuysUsed ?? 0), 0);
  return {
    memberCount,
    paidCount: paid,
    unpaidCount: Math.max(0, memberCount - paid),
    collected: paid * entryFee,
    expected: memberCount * entryFee + totalRebuys * rebuyCost,
  };
}

/** Dues still owed. Never negative — an overpaid rebuy must not read as a credit. */
export const outstandingDue = (pot: PotStats): number => Math.max(0, pot.expected - pot.collected);

/** Share of the roster whose base dues are marked PAID, 0-100, integer. */
export const clearingRate = (pot: PotStats): number =>
  pot.memberCount > 0 ? Math.round((pot.paidCount / pot.memberCount) * 100) : 0;
