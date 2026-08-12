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

import { isProvableMember } from '@shared/memberRecord';

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
  /**
   * The Member Record's persisted play latch (`shared/memberRecord.ts`), set
   * one-way false -> true on first submit.
   *
   * ⚠️ `undefined` means UNKNOWN, not false. The field did not exist before
   * 2026-07-31, so every record written earlier lacks it and heals only when
   * `ensureMemberRecord` next touches it. Never treat absence as "has not
   * entered" — use `hasEntry` for that.
   *
   * Nothing keys on this today: it cannot separate "will play, hasn't yet" from
   * "never will". It is carried so an explicit host opt-out has a durable field
   * to key on when one exists.
   */
  hasPlayableEntry?: boolean;
  isOwner: boolean;
}

/** Entry docs are keyed by uid for NFL pools, but prefer `ownerUid` when present. */
const uidOf = (entry: any): string => entry?.ownerUid || entry?.id;

/**
 * Member Records this file will treat as roster truth.
 *
 * Until 2026-08-02 `setPaidStatus`'s claim branch would CREATE
 * `pools/{anyPool}/members/{caller}` for any authenticated caller (#344), and a
 * Member Record is roster truth. #344 shut that door and #338 stopped a forged
 * record being a REMINDER target, but neither deletes the documents already
 * minted — and this file still put every one of them on the commissioner's
 * roster list, in `memberCount`, and in the dues totals. A stranger who
 * self-added before #344 landed therefore still appeared on that pool's roster.
 *
 * ⚠️ THE TEST IS `isProvableMember`, NOT `isCanonicalMemberRecord`, and the
 * difference is the whole correctness argument. Codex round 1 on this change:
 * filtering on the canonical stamp ALONE also discards a genuine participant's
 * record when it happens to be un-stamped — and such records demonstrably exist
 * and carry real money state. `setPaidStatus`'s commissioner branch merges
 * `paidStatus: 'PAID'` WITHOUT stamping `joinedAt`, and its own comments record
 * that `reconcilePaymentTruth` promotes claim-only documents to PAID from a paid
 * entry. Dropping those means a commissioner marks someone paid and the roster
 * keeps saying UNPAID while `collected` loses the fee — hiding payment truth to
 * hide a forgery.
 *
 * The second evidence source separates them cleanly: a real participant is in
 * `participantIds` (every server join path writes it, and writing it requires
 * `isPoolManager()`), while the #344 exploit wrote ONLY the member document. So
 * the forged record still vanishes and the genuine un-stamped one keeps all of
 * its payment state.
 *
 * Neither predicate is redefined here. `isProvableMember` in
 * `shared/memberRecord.ts` is the same one `setPaidStatus` uses to admit a
 * self-report; `resolveReminderTargets` uses the canonical half directly, on
 * purpose — see the note below. A local copy is how the doors drift apart, and
 * two of them exist because the first fix left another open.
 *
 * ⚠️ WHY THIS IS DELIBERATELY LOOSER THAN THE REMINDER FILTER. #338 refuses
 * `participantIds` as a reminder-target source because it is MANAGER-WRITABLE,
 * which would make that callable an arbitrary-email primitive — a manager
 * appends any UID they know and the platform mails that person. Nothing here
 * sends anything: the consequence is a row on the manager's own roster and a fee
 * in their own dues total. A manager listing someone as a participant IS
 * membership by this system's definition; a manager mailing a stranger is not.
 *
 * ⚠️ This filter is only as good as the data reaching it. `subscribeToPoolMembers`
 * spreads the whole document (`{ uid: d.id, ...d.data() }`), so `joinedAt`
 * survives to here. A caller that PROJECTS members to a narrower shape would
 * strip the discriminator and make every genuine member look forged — the exact
 * regression codex found on #338's `sendManualReminder`. `RosterInputs.members`
 * is `any[]`, so the type system cannot catch that; the source invariant in
 * `tests/setpaidstatus-membership-guard.test.ts` does — it sits with the other
 * two doors' invariants rather than here, so the three-reader rule has one home.
 */
const provableMembers = (pool: any, members: any[] | undefined): any[] =>
  // Called explicitly rather than point-free: `filter` passes (value, index,
  // array), so a point-free predicate silently receives two extra arguments and
  // any future signature change lands on them unnoticed.
  (members || []).filter((m) => isProvableMember(pool, m, m?.uid));

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
  for (const m of provableMembers(pool, members)) add(m?.uid);
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
  for (const m of provableMembers(pool, members)) {
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
      hasPlayableEntry: m.hasPlayableEntry,
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
 * 🔨 **KEVIN'S RULING 2026-07-31: assume the pool manager is also playing, 99%
 * of the time.** So EVERYONE on the roster is expected to pick, the
 * commissioner included, and an entry-less manager is a genuine outstanding
 * pick rather than someone to exempt.
 *
 * An earlier version of this function excluded `isOwner && !hasEntry`, because
 * pool creation seeds the owner with `hasPlayableEntry: false` so that hosting
 * is not playing for DUES purposes (`ensureMemberRecord` gives such a MANAGER
 * `feeOwed: 0`). Codex showed the cost: a host who intends to play but has not
 * picked yet is indistinguishable from a host-only commissioner, so the
 * exemption let a pool read 100% while the commissioner personally had not
 * picked. Kevin's ruling settles the prior instead of guessing.
 *
 * **The dues rule is untouched.** A manager still owes nothing until they
 * commit an entry. Money liability and pick liability are different questions,
 * and conflating them produced a wrong answer in both directions.
 *
 * The genuinely host-only commissioner is the 1%: they sit in the pending list
 * until they pick. `hasPlayableEntry` is now persisted on the Member Record
 * (a one-way latch) and carried on `RosterRow`, so a future "I'm not playing"
 * opt-out has a durable field to key on — but no data available today can tell
 * "will play, hasn't yet" from "never will", so nothing is excluded on it.
 *
 * A pick'em week with NO games yields nobody pending among entry holders: there
 * is nothing to pick, so calling them delinquent would be wrong. That falls out
 * of `[].every()` being `true` — an explicit `weeklyGameIds.length > 0 &&`
 * guard was carried over from the inline version and **deleted as dead code**:
 * it survived mutation testing precisely because it can never change an answer.
 * The behaviour it looked like it protected is real and is pinned by a test.
 */
export interface PickCompletenessOpts {
  poolType?: string;
  week: number;
  weeklyGameIds: string[];
  /**
   * uid → games picked this week, from the `getPoolPicks` callable
   * (PLAN-COMMISSIONER-BLIND-PICKS D1). WHERE THE COMPLETENESS FACT COMES FROM
   * AS OF 2026-08-12: the commissioner no longer holds other members' entry
   * documents — firestore.rules stopped serving them — so `r.entry.picks` is
   * populated only for the viewer's own row and for games the server has
   * REVEALED. Counting that subset would report everyone incomplete before
   * kickoff and fire every reminder.
   *
   * The `picks` path stays as the fallback for callers that legitimately hold
   * whole entries (SUPER_ADMIN surfaces, the sim harness, these tests) and for
   * the moment before the callable's first response arrives.
   */
  pickCounts?: Record<string, number>;
}

/**
 * Has this roster row submitted everything the week asks of them?
 *
 * ONE definition, because there were two and they disagreed: this function's
 * caller `unsubmittedRoster` treated a pick'em week with no games as COMPLETE
 * (nothing to pick), while `NFLManagerView`'s inline copy marked every entry
 * holder pending on the same week and lit up "Remind all unpicked" with nothing
 * to remind anyone about. codex r1 on the commissioner-blind-picks PR. The
 * empty-slate answer here is "complete", and both surfaces now get it.
 */
export function hasCompletePicks(r: RosterRow, opts: PickCompletenessOpts): boolean {
  const { poolType, week, weeklyGameIds, pickCounts } = opts;
  if (!r.hasEntry) return false;
  if (pickCounts) {
    const need = poolType === 'NFL_PICKEM' ? weeklyGameIds.length : 1;
    return (pickCounts[r.uid] ?? 0) >= need;
  }
  const picks = r.entry?.picks || {};
  if (poolType === 'NFL_PICKEM') {
    return weeklyGameIds.every((id) => !!picks[id]);
  }
  return !!picks[week];
}

export function unsubmittedRoster(
  roster: RosterRow[],
  opts: PickCompletenessOpts,
): RosterRow[] {
  return roster.filter((r) => !hasCompletePicks(r, opts));
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
  const memberList = provableMembers(pool, members);
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
