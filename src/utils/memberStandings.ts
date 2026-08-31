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
    /**
     * Member Records — roster truth, once proven.
     *
     * `entries` is the ENTRY ROSTER (PLAN-MULTI-ENTRY D2): entry id → index +
     * display name, written by the submit transaction, carrying no picks and no
     * per-entry weeks. It is what makes one row per entry possible for a member
     * whose extra entry has never been scored — a participant may not read
     * other members' entry documents, and the standings projection is a
     * snapshot of the last scored week.
     */
    members: Array<{
        uid?: string;
        userName?: string;
        present?: boolean;
        pickedWeeks?: number[];
        /** The one-way latch set at submit time (ADR 0005 Phase 4) — per MEMBER. */
        hasPlayableEntry?: boolean;
        entries?: Record<string, { entryIndex?: number; name?: string }>;
    }>;
    /** `pools/{id}/standings/current` rows — scored stats, never picks. */
    standingsRows: any[];
    /**
     * EVERY entry document the viewer owns (PLAN-MULTI-ENTRY T4/D6) — the only
     * source of their own current picks. One element for a single-entry member,
     * which is every member until `MULTI_ENTRY_WIZARD_ENABLED` flips.
     */
    ownEntries: any[];
    /**
     * `getPoolPicks` output, when the viewer is a commissioner
     * (PLAN-COMMISSIONER-BLIND-PICKS T2). `null`/absent for ordinary members —
     * the callable refuses them, and this file must build the same rows either
     * way. Only what the SERVER decided was revealed is grafted on; this
     * function never widens the boundary.
     */
    reveal?: PoolPicksReveal | null;
    /**
     * ADDITIONAL revealed weeks whose PICKS are grafted too — Survivor and
     * Margin only, where the grid draws many weeks at once.
     *
     * 🛑 WITHOUT THIS THE MULTI-WEEK GRID LIES. `reveal` is the SELECTED week,
     * so another member's `picks` map would hold that one week and nothing
     * else — and every earlier column, however long since revealed, would
     * render as "—", i.e. *"they made no pick"*. A fabricated claim, and the
     * exact defect class this whole feature exists to avoid. (codex P1.)
     *
     * ⚠️ Only `picks` is taken. `confidence` is a pick'em concept and
     * `weeklyTiebreakers` belong to the week that produced them; merging those
     * across weeks would attribute one week's prediction to another.
     *
     * Grafting a week here does NOT decide whether a cell renders — the cell
     * re-checks its own week's `weekRevealed` (`weeklyPickCell`). Two
     * independent gates, which is what a future edit would have to defeat.
     */
    weeklyReveals?: PoolPicksReveal[];
}

/** The subset of `getPoolPicks`' response this file reads. */
export interface PoolPicksReveal {
    week: number;
    picks: Record<string, Record<string, string>>;
    confidence: Record<string, Record<string, number>>;
    tiebreakers: Record<string, number>;
}

/**
 * Which entry ids does this Member Record hold (PLAN-MULTI-ENTRY D6)?
 *
 * The roster map when there is one, in a STABLE order — `entryIndex` then id,
 * so entry #1 leads and the table does not reshuffle between snapshots because
 * Firestore returned an object's keys differently.
 *
 * ⚠️ A RECORD WITH NO MAP IS NOT A RECORD WITH NO ENTRY. Every Member Record
 * written before multi-entry lacks the field, and the answer for those is
 * exactly one entry whose id is the uid (D1) — which is byte-for-byte the row
 * this file emitted before T4. Returning `[]` there would empty the standings
 * table of every pool in production.
 */
function ownedEntryIds(m: MemberStandingsInput['members'][number]): string[] {
    const map = m?.entries;
    if (!map || typeof map !== 'object') return m?.uid ? [m.uid] : [];
    const ids = Object.keys(map);
    if (ids.length === 0) return m?.uid ? [m.uid] : [];
    return ids.sort((a, b) => {
        const ai = typeof map[a]?.entryIndex === 'number' ? (map[a].entryIndex as number) : 1;
        const bi = typeof map[b]?.entryIndex === 'number' ? (map[b].entryIndex as number) : 1;
        return ai - bi || a.localeCompare(b);
    });
}

/** The entry's own display name from the roster map, when it has one (§0b.4). */
function entryNameOf(m: MemberStandingsInput['members'][number], entryId: string): string | undefined {
    const name = m?.entries?.[entryId]?.name;
    return typeof name === 'string' && name ? name : undefined;
}

/**
 * 🛑 THE ROW IDENTITY IS THE ENTRY, NOT THE PLAYER (PLAN-MULTI-ENTRY §0b.1).
 *
 * `id` FIRST and `ownerUid` only as the legacy fallback — the reverse of what
 * this file did until T4. For entry #1 the two are the same string (D1), which
 * is exactly why the uid-keyed form survived so long: it was right on every
 * pool that existed. Under multi-entry it silently MERGES a player's rows,
 * because a Map keyed by uid keeps whichever entry it saw last.
 *
 * `ownerUid` still decides two things and only two: the profile link, and
 * "is this me" highlighting — which correctly lights up ALL of the viewer's
 * entries. `tests/nfl-surface-invariants.test.ts` is the guard.
 */
const idOf = (row: any): string | undefined => row?.id ?? row?.ownerUid;

/**
 * One row per ENTRY in the pool: the viewer's own entries first, then every
 * entry of everyone holding a Member Record, then any scored row whose member
 * record is missing (a legacy pool that predates the roster backfill — nobody
 * should vanish).
 */
export function buildMemberStandings({ pool, members, standingsRows, ownEntries, reveal, weeklyReveals }: MemberStandingsInput): any[] {
    // Same predicate the commissioner roster uses (`utils/poolRoster.ts:138`), for
    // the same reason: a Member Record's mere EXISTENCE proves nothing, because the
    // pre-#344 claim path was itself a way to forge one. Not redefined here —
    // `isProvableMember` is the one definition (shared/memberRecord.ts:139). (codex.)
    const proven = (members || []).filter(m => isProvableMember(pool, m as any, m?.uid || ''));
    const scoredByEntry = new Map<string, any>();
    for (const row of standingsRows || []) {
        const entryId = idOf(row);
        if (entryId) scoredByEntry.set(entryId, row);
    }

    const rows: any[] = [];
    const seen = new Set<string>();
    /**
     * 🛑 EVERY CALLER MUST HAND THIS A ROW IT OWNS — never a `standingsRows`
     * element by reference.
     *
     * The grafting pass at the bottom MUTATES the rows it is given
     * (`row.pickedWeeks = …`, `row.picks = { …row.picks, …revealed }`), and
     * `standingsRows` is React state. Pushing a snapshot's object by reference
     * therefore mutated state — and since this function is now called from a
     * render-phase `useMemo` (codex r6), that became a render-phase mutation of
     * state, which React forbids outright.
     *
     * It was already wrong before that: the merge is additive, so a row object
     * that survives across weeks ACCUMULATES the picks of every week it has been
     * grafted for, and nothing ever removes them. The clone bounds each pass to
     * the week it was built for. (qodo #1, re-review of PR #430.)
     */
    const push = (entryId: string | undefined, row: any) => {
        if (!entryId || seen.has(entryId)) return;
        seen.add(entryId);
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
    //
    // EVERY entry the viewer owns, each as its own row. The reveal grafting pass
    // below skips these ids: a viewer's own picks come from their own entry
    // documents, which they may always read, not from the reveal response.
    const ownIds = new Set<string>();
    for (const own of ownEntries || []) {
        const ownId = idOf(own);
        if (!ownId) continue;
        ownIds.add(ownId);
        const ownScored = scoredByEntry.get(ownId);
        push(ownId, ownScored
            ? {
                ...ownScored,
                picks: own.picks,
                confidence: own.confidence,
                weeklyTiebreakers: own.weeklyTiebreakers,
            }
            : { ...own, unscored: true });
    }

    for (const m of proven) {
        // `present: false` is a defensive read only — a real removal DELETES the
        // record (see the fallback note below) — but a caller that hands us one
        // must not have it rendered.
        if (!m?.uid || m.present === false) continue;
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
        //
        // ⚠️ THE LATCH IS READ ONCE, PER MEMBER, BEFORE THE PER-ENTRY LOOP. It
        // is a per-MEMBER fact ("has this person ever submitted"), so asking it
        // per entry would be asking a question the record does not answer.
        const anyScored = ownedEntryIds(m).some(id => scoredByEntry.has(id));
        if (!anyScored && m.hasPlayableEntry !== true) continue;

        // ONE ROW PER ENTRY (PLAN-MULTI-ENTRY D6). The ids come from the Member
        // Record's `entries` roster — the authorization-safe list, readable by
        // every participant and carrying no picks — so a member's SECOND entry
        // gets a row the first time it exists, not the first time it is scored.
        // A record with no roster map is a legacy one: exactly one row, keyed by
        // the uid, which is entry #1's id (D1) and is byte-for-byte today's
        // behaviour.
        for (const entryId of ownedEntryIds(m)) {
            const scored = scoredByEntry.get(entryId);
            // `{ ...scored }`, never `scored` — see the cloning note above `push`.
            push(entryId, scored ? { ...scored } : {
                id: entryId,
                ownerUid: m.uid,
                userName: m.userName,
                ...(entryNameOf(m, entryId) ? { entryName: entryNameOf(m, entryId) } : {}),
                // No scored week for this entry yet — the table renders "—"
                // rather than inventing a status.
                unscored: true,
            });
        }
    }

    // A scored player with no Member Record: keep them IF the pool still lists them
    // as a participant.
    //
    // Two reviewers pulled this in opposite directions and `participantIds` is what
    // settles it. codex: a removal DELETES the Member Record
    // (`planMembershipWrite` → `{ op: 'delete' }`), so on a rostered pool "in the
    // projection, not on the roster" looks exactly like "removed", and re-adding
    // those rows puts a removed player back on the board. qodo: gating the whole
    // fallback on "the roster is empty" hides scored participants in a PARTIALLY
    // backfilled pool, where some records exist and some do not.
    //
    // Both are right about their case, and neither needs guessing, because the same
    // transaction that deletes the record also does
    // `participantIds: arrayRemove(uid)` (functions/src/lib/memberRecord.ts:173-176).
    // So membership survives a missing Member Record but does NOT survive a removal.
    // Per row, not all-or-nothing.
    const participantIds: unknown = pool?.participantIds;
    const stillAParticipant = (uid: string) =>
        Array.isArray(participantIds) && participantIds.includes(uid);
    for (const row of standingsRows || []) {
        const entryId = idOf(row);
        // MEMBERSHIP IS STILL A QUESTION ABOUT THE PERSON, so it is asked of
        // `ownerUid` — the row's OWNER — while the row itself is keyed by its
        // entry id. Reading `participantIds` for an entry id would drop every
        // extra entry of every member.
        const owner = row?.ownerUid ?? entryId;
        // No participantIds at all (a legacy pool doc, or a snapshot that has not
        // arrived): fall back to showing the projection rather than an empty table.
        // Cloned, same as the loop above — this `row` IS a `standingsRows`
        // element and the grafting pass below writes to it.
        if (entryId && (stillAParticipant(owner) || !Array.isArray(participantIds))) push(entryId, { ...row });
    }

    // ONE grafting pass, after every row exists, so the marker and any revealed
    // pick reach a row whichever of the three loops above produced it.
    //
    // `pickedWeeks` is copied verbatim — including when it is ABSENT, which is
    // the whole point. `undefined` means "unknown" (no submit has landed since
    // the field existed) and the table renders "—"; a present array means the
    // answer is known, so a week missing from it renders "No selection".
    // Coercing one to the other here would put the lie back
    // (shared/memberRecord.ts).
    //
    // ⚠️ `pickedWeeks` IS PER MEMBER AND STAYS SO (D2). It is the UNION across a
    // member's entries, deliberately: a per-entry map on a participant-readable
    // record would tell the pool which specific entry has a pick for an
    // unrevealed week, which is pre-reveal completeness the commissioner alone
    // is entitled to (CONTEXT.md §Pick Reveal). So it is looked up by OWNER and
    // written onto every row that owner holds. Per-entry completeness travels
    // only in `getPoolPicks.counts`, which is reveal-gated.
    const pickedByOwner = new Map<string, number[] | undefined>();
    for (const m of members || []) {
        if (m?.uid) pickedByOwner.set(m.uid, m.pickedWeeks);
    }
    for (const row of rows) {
        const entryId = idOf(row);
        if (!entryId) continue;
        const owner = row?.ownerUid ?? entryId;
        if (pickedByOwner.has(owner)) row.pickedWeeks = pickedByOwner.get(owner);
        if (ownIds.has(entryId)) continue;

        // 🛑 THE REVEAL MAPS ARE KEYED BY ENTRY ID (T3 / D5), so these lookups
        // are by `entryId` and never by the owner. A uid key would hand every
        // one of a player's rows the SAME picks — the second entry rendering
        // the first entry's sheet, which is worse than rendering nothing.
        //
        // Every OTHER revealed week's picks, for the multi-week grid. Merged
        // before the selected week below so the selected week wins on a key
        // collision — it is the freshest response for that week.
        for (const r of weeklyReveals || []) {
            const wp = r.picks?.[entryId];
            if (wp) row.picks = { ...(row.picks || {}), ...wp };
        }

        if (!reveal) continue;
        // Merge, never replace: the own row above already grafted real picks, and
        // a scored row may carry nothing. Only server-revealed keys arrive here.
        const revealedPicks = reveal.picks?.[entryId];
        if (revealedPicks) row.picks = { ...(row.picks || {}), ...revealedPicks };
        const revealedConfidence = reveal.confidence?.[entryId];
        if (revealedConfidence) row.confidence = { ...(row.confidence || {}), ...revealedConfidence };
        const tb = reveal.tiebreakers?.[entryId];
        if (tb !== undefined) row.weeklyTiebreakers = { ...(row.weeklyTiebreakers || {}), [reveal.week]: tb };
    }

    return rows;
}
