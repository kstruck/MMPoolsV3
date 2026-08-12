/**
 * What a MEMBER's standings table is built from.
 *
 * The member view cannot read raw entries (ADR 0005 Phase 2 — `firestore.rules`
 * restricts them until the pool is FINAL), so it renders the server standings
 * projection instead. That projection is written by ONE writer: `scoreNFLWeek`
 * (`functions/src/nflPools.ts`). It is a snapshot of the last SCORED week.
 *
 * Using a scored-time snapshot as a live roster is what Kevin's 2026-08-11
 * walkthrough hit: a third member joined and picked, and the other members could
 * not see him at all — he had not existed when the last week was scored, and the
 * next refresh of that document is the next scoring pass, days away.
 *
 * So the roster comes from **Member Records** (`pools/{id}/members`, ADR 0003 —
 * everyone who joined, written at join AND at submit, and already readable by
 * every participant under `firestore.rules`), and the scored projection is
 * folded in only for the stats it legitimately carries. No new read surface: the
 * dashboard already subscribes to both.
 *
 * What this deliberately does NOT do: invent standings. A member with no scored
 * row is marked `unscored` so the table can render "—" instead of a fabricated
 * ALIVE / 0 strikes / 0 rebuys, which would be a claim the data does not support.
 */

import { isProvableMember } from '@shared/memberRecord';

export interface MemberStandingsInput {
    /** The pool doc. Only `participantIds` is read — membership evidence. */
    pool: any;
    /** Member Records — roster truth, once proven. */
    members: Array<{ uid?: string; userName?: string; present?: boolean }>;
    /** `pools/{id}/standings/current` rows — scored stats, never picks. */
    standingsRows: any[];
    /** The viewer's own entry document, which DOES carry their own picks. */
    ownEntry: any | null;
}

const uidOf = (row: any): string | undefined => row?.ownerUid ?? row?.id;

/**
 * One row per person in the pool: the viewer's own entry first, then everyone
 * holding a Member Record, then any scored row whose member record is missing
 * (a legacy pool that predates the roster backfill — nobody should vanish).
 */
export function buildMemberStandings({ pool, members, standingsRows, ownEntry }: MemberStandingsInput): any[] {
    // Same predicate the commissioner roster uses (`utils/poolRoster.ts:138`), for
    // the same reason: a Member Record's mere EXISTENCE proves nothing, because the
    // pre-#344 claim path was itself a way to forge one. Not redefined here —
    // `isProvableMember` is the one definition (shared/memberRecord.ts:139). (codex.)
    const proven = (members || []).filter(m => isProvableMember(pool, m as any, m?.uid || ''));
    const scoredByUid = new Map<string, any>();
    for (const row of standingsRows || []) {
        const uid = uidOf(row);
        if (uid) scoredByUid.set(uid, row);
    }

    const rows: any[] = [];
    const seen = new Set<string>();
    const push = (uid: string | undefined, row: any) => {
        if (!uid || seen.has(uid)) return;
        seen.add(uid);
        rows.push(row);
    };

    // The viewer's own row: their entry is the ONLY source of their current picks,
    // but it is not a scored result. A raw entry carries initialized values
    // (`status: 'ALIVE'`, `strikesUsed: 0`, `seasonTotal: 0`) that would render and
    // RANK as though they had been scored — so before the first scoring pass the
    // viewer would sit above every Margin player on a negative total, while every
    // other member correctly showed "—". Take the scored row when one exists and
    // graft the picks onto it; otherwise keep the entry and mark it unscored, the
    // same treatment everyone else gets. (codex.)
    const ownUid = uidOf(ownEntry);
    if (ownUid) {
        const ownScored = scoredByUid.get(ownUid);
        push(ownUid, ownScored
            ? {
                ...ownScored,
                picks: ownEntry.picks,
                confidence: ownEntry.confidence,
                weeklyTiebreakers: ownEntry.weeklyTiebreakers,
            }
            : { ...ownEntry, unscored: true });
    }

    for (const m of proven) {
        // `present: false` is a defensive read only — a real removal DELETES the
        // record (see the fallback note below) — but a caller that hands us one
        // must not have it rendered.
        if (!m?.uid || m.present === false) continue;
        const scored = scoredByUid.get(m.uid);
        // A LEADERBOARD lists competitors, not the roster. Someone who joined and
        // never submitted — the host-only commissioner is the common case, seeded
        // with a Member Record at pool creation — has no entry, and the manager's
        // own standings view (raw entries) does not list them. Showing them only to
        // members would make the two leaderboards disagree and inflate the entry
        // count. Evidence of an entry is the `hasPlayableEntry` latch (one-way, set
        // at submit, ADR 0005 Phase 4) or a scored row, which cannot exist without
        // one. The viewer's own row is handled above and needs no latch. (codex.)
        //
        // NOTE this is a STANDINGS rule, not the pick-liability rule: the roster and
        // its reminders deliberately keep an entry-less host (utils/poolRoster.ts —
        // Kevin's ruling), because "will play, hasn't yet" is indistinguishable from
        // "never will". Being owed a pick and being on the leaderboard are different
        // questions, and this file answers only the second.
        if (!scored && (m as { hasPlayableEntry?: boolean }).hasPlayableEntry !== true) continue;
        push(m.uid, scored ?? {
            id: m.uid,
            ownerUid: m.uid,
            userName: m.userName,
            // No scored week for this member yet — the table renders "—" rather
            // than inventing a status.
            unscored: true,
        });
    }

    // The projection is a fallback ONLY for a pool with no roster at all.
    //
    // A removal DELETES the Member Record — `planMembershipWrite` returns
    // `{ op: 'delete' }` (functions/src/lib/memberRecord.ts:52), it does not keep a
    // `present: false` tombstone. So for a pool that HAS Member Records, "in the
    // projection but not in the roster" and "removed since the last scoring pass"
    // are the same shape, and re-adding those rows would put a removed player back
    // on the board until the next scored week. With a populated roster the roster
    // is authoritative; the fallback exists for a legacy pool that predates the
    // backfill (or a snapshot that has not arrived yet), where dropping it would
    // empty the table. (codex, twice.)
    if (!proven.some(m => m?.uid)) {
        for (const row of standingsRows || []) push(uidOf(row), row);
    }

    return rows;
}
