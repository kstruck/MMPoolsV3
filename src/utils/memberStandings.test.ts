import { describe, it, expect } from 'vitest';

import { buildMemberStandings } from './memberStandings';

/**
 * The defect these pin (Kevin's 2026-08-11 walkthrough, second report): a third
 * member joined the pool and picked, and the other MEMBERS could not see him at
 * all — only the commissioner could. The member view was built from
 * `standings/current`, which `scoreNFLWeek` writes and nothing else, so it is a
 * snapshot of the last SCORED week being used as a live roster.
 */

// Membership evidence. `isProvableMember` accepts a record whose uid is in the
// pool's participantIds — the same predicate the commissioner roster applies, so
// a forged Member Record cannot put a stranger on the board.
const POOL = {
    participantIds: [
        'kevin', 'ron', 'johnny', 'aaron',
        'gone', 'legacy', 'removed',
    ],
};

// A member who has submitted: the one-way latch set at submit time.
const member = (uid: string, userName: string, extra: Record<string, unknown> = {}) =>
    ({ uid, userName, hasPlayableEntry: true, ...extra });

const scored = (uid: string, userName: string, extra: Record<string, unknown> = {}) =>
    ({ id: uid, ownerUid: uid, userName, status: 'ALIVE', strikesUsed: 0, rebuysUsed: 0, ...extra });

describe('buildMemberStandings', () => {
    it('shows a member who joined AFTER the last scored week', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('kevin', 'Kevin Struck'), member('ron', 'Ron Johnson')],
            standingsRows: [scored('kevin', 'Kevin Struck')], // written before Ron joined
            ownEntries: [],
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['kevin', 'ron']);
    });

    /**
     * PLAN-MULTI-ENTRY-DUES P2-T4 (codex r1 on the delete callable).
     *
     * 🛑 THE GHOST COMPETITOR. `deleteNFLEntry` removes a member's last entry, so
     * their roster map goes empty and `playableEntryCount` goes to 0. If the
     * `hasPlayableEntry` LATCH were left `true` — which is what "one-way" used to
     * mean — this function would still include them (line 234), and
     * `ownedEntryIds` treats an EMPTY map as a legacy record with one entry keyed
     * by the uid (line 111). Net effect: a row for an entry that no longer
     * exists, visible to every member, until scoring starts.
     */
    it('a member whose LAST entry was deleted gets no ghost row', () => {
        // MUST NOT catch: the post-delete shape the callable writes.
        const deleted = { uid: 'ron', userName: 'Ron Johnson', hasPlayableEntry: false, entries: {}, playableEntryCount: 0 };
        expect(buildMemberStandings({
            pool: POOL, members: [deleted], standingsRows: [], ownEntries: [],
        })).toHaveLength(0);

        // MUST catch: the same record with the latch left ON — the bug. One row
        // appears, keyed by the uid, for an entry that was deleted.
        const stale = { ...deleted, hasPlayableEntry: true };
        const ghost = buildMemberStandings({
            pool: POOL, members: [stale], standingsRows: [], ownEntries: [],
        });
        expect(ghost).toHaveLength(1);
        expect(ghost[0].id).toBe('ron');
    });

    it('marks a member with no scored row `unscored` instead of inventing standings', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson')],
            standingsRows: [],
            ownEntries: [],
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].unscored).toBe(true);
        // The row must NOT claim a status, a strike count or a rebuy count.
        expect(rows[0].status).toBeUndefined();
        expect(rows[0].strikesUsed).toBeUndefined();
        expect(rows[0].rebuysUsed).toBeUndefined();
    });

    it("uses the viewer's own entry for their own row, so their live picks render", () => {
        const own = { id: 'johnny', ownerUid: 'johnny', userName: 'Johnny Football', picks: { 2: 'ATL' } };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('johnny', 'Johnny Football'), member('kevin', 'Kevin Struck')],
            standingsRows: [scored('johnny', 'Johnny Football'), scored('kevin', 'Kevin Struck')],
            ownEntries: [own],
        });
        expect(rows[0].ownerUid).toBe('johnny');
        expect(rows[0].picks).toEqual({ 2: 'ATL' }); // grafted onto the scored row
        expect(rows[0].unscored).toBeUndefined();    // a scored row exists for them
        expect(rows.filter(r => r.ownerUid === 'johnny')).toHaveLength(1); // never doubled
    });

    it('prefers the scored row for everyone else, so real stats survive', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('kevin', 'Kevin Struck')],
            standingsRows: [scored('kevin', 'Kevin Struck', { strikesUsed: 2, status: 'ELIMINATED' })],
            ownEntries: [],
        });
        expect(rows[0].strikesUsed).toBe(2);
        expect(rows[0].status).toBe('ELIMINATED');
        expect(rows[0].unscored).toBeUndefined();
    });

    it('keeps a scored participant whose Member Record has not been backfilled', () => {
        // qodo: a PARTIALLY backfilled pool — Kevin has a record, the legacy player
        // does not, and both are still listed as participants. Neither may vanish.
        const rows = buildMemberStandings({
            pool: { participantIds: ['kevin', 'legacy'] },
            members: [member('kevin', 'Kevin Struck')],
            standingsRows: [scored('kevin', 'Kevin Struck'), scored('legacy', 'Legacy Player')],
            ownEntries: [],
        });
        expect(rows.map(r => r.ownerUid).sort()).toEqual(['kevin', 'legacy']);
    });

    it('falls back to the projection ONLY when there is no roster at all', () => {
        // Legacy pool, pre-roster-backfill: scored rows exist, Member Records do not.
        // Dropping the fallback here would empty the table.
        const noRoster = buildMemberStandings({
            pool: POOL,
            members: [],
            standingsRows: [scored('kevin', 'Kevin Struck'), scored('legacy', 'Legacy Player')],
            ownEntries: [],
        });
        expect(noRoster.map(r => r.ownerUid).sort()).toEqual(['kevin', 'legacy']);

        // codex, twice: a removal DELETES the Member Record (planMembershipWrite
        // returns { op: 'delete' }), so with a populated roster "in the projection
        // but not on the roster" IS the removed case. Re-adding it would put a
        // removed player back on the board until the next scored week.
        const withRoster = buildMemberStandings({
            pool: { participantIds: ['kevin'] }, // 'removed' is no longer a participant
            members: [member('kevin', 'Kevin Struck')],
            standingsRows: [scored('kevin', 'Kevin Struck'), scored('removed', 'Removed Player')],
            ownEntries: [],
        });
        expect(withRoster.map(r => r.ownerUid)).toEqual(['kevin']);
    });

    it('drops a member marked not present, and tolerates empty inputs', () => {
        expect(buildMemberStandings({
            pool: POOL,
            members: [member('gone', 'Removed', { present: false })],
            standingsRows: [],
            ownEntries: [],
        })).toEqual([]);
        // A REMOVED player: the same transaction that deletes the Member Record also
        // drops the uid from participantIds, so the projection's stale copy of them
        // must not resurrect them.
        expect(buildMemberStandings({
            pool: { participantIds: ['kevin'] },
            members: [member('gone', 'Removed', { present: false })],
            standingsRows: [scored('gone', 'Removed')],
            ownEntries: [],
        })).toEqual([]);
        expect(buildMemberStandings({ pool: POOL, members: [], standingsRows: [], ownEntries: [] })).toEqual([]);
    });

    // codex: a Member Record's existence proves nothing — the pre-#344 claim path
    // could forge one. Same predicate the commissioner roster uses.
    it('ignores an unproven Member Record, and still shows the legacy projection', () => {
        const rows = buildMemberStandings({
            pool: { participantIds: ['kevin'] },
            members: [member('kevin', 'Kevin Struck'), member('forged', 'Forged Member')],
            standingsRows: [scored('kevin', 'Kevin Struck')],
            ownEntries: [],
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['kevin']);

        // A forged record cannot suppress a legitimate scored participant either:
        // the projection row is kept on its own evidence, participantIds.
        const onlyForged = buildMemberStandings({
            pool: { participantIds: ['legacy'] },
            members: [member('forged', 'Forged Member')],
            standingsRows: [scored('legacy', 'Legacy Player')],
            ownEntries: [],
        });
        expect(onlyForged.map(r => r.ownerUid)).toEqual(['legacy']);

        // And a pool doc with NO participantIds at all (legacy shape, or a snapshot
        // that has not arrived) still shows the projection rather than an empty table.
        const noIds = buildMemberStandings({
            pool: {},
            members: [],
            standingsRows: [scored('legacy', 'Legacy Player')],
            ownEntries: [],
        });
        expect(noIds.map(r => r.ownerUid)).toEqual(['legacy']);
    });

    // codex: a raw entry carries initialized ALIVE / 0 / 0 values. Before the first
    // scoring pass those are not results, and ranking them as such would put the
    // viewer above scored players on a negative total.
    it("marks the viewer's own row unscored when no scored row exists, but keeps their picks", () => {
        const own = {
            id: 'ron', ownerUid: 'ron', userName: 'Ron Johnson',
            status: 'ALIVE', strikesUsed: 0, picks: { 2: 'PIT' },
        };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson')],
            standingsRows: [],
            ownEntries: [own],
        });
        expect(rows[0].unscored).toBe(true);
        expect(rows[0].picks).toEqual({ 2: 'PIT' });
    });

    // codex: a leaderboard lists competitors. A host seeded at pool creation has a
    // Member Record and no entry, and the manager's own standings (raw entries) do
    // not list them — showing them only to members would make the two disagree.
    it('leaves out someone who joined but never submitted', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [
                member('ron', 'Ron Johnson'),
                { uid: 'kevin', userName: 'Kevin Struck', hasPlayableEntry: false }, // host, no entry
            ],
            standingsRows: [],
            ownEntries: [],
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['ron']);
    });

    it('keeps a member whose latch is unset but who HAS been scored', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [{ uid: 'kevin', userName: 'Kevin Struck' }], // pre-latch record
            standingsRows: [scored('kevin', 'Kevin Struck')],
            ownEntries: [],
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['kevin']);
    });

    it('lists the viewer first', () => {
        const own = { id: 'johnny', ownerUid: 'johnny', userName: 'Johnny Football' };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('aaron', 'Aaron A'), member('johnny', 'Johnny Football')],
            standingsRows: [],
            ownEntries: [own],
        });
        expect(rows[0].ownerUid).toBe('johnny');
    });
});

/**
 * PLAN-COMMISSIONER-BLIND-PICKS T4 — what the row carries so the standings cell
 * can tell "picked, you may not see it" from "has not picked" from "unknowable".
 */
describe('buildMemberStandings — pickedWeeks marker and the reveal graft', () => {
    it('copies pickedWeeks onto the row', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson', { pickedWeeks: [1, 2] })],
            standingsRows: [],
            ownEntries: [],
        });
        expect(rows[0].pickedWeeks).toEqual([1, 2]);
    });

    /**
     * ⚠️ ABSENT MUST STAY ABSENT. A record written before the marker existed
     * cannot answer the question, and the cell renders "—" for that. Coercing it
     * to `[]` here would make the table say "No selection" about a member whose
     * pick is simply not knowable — the exact lie #413 removed from that cell.
     */
    it('leaves an absent marker absent rather than defaulting it to []', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson')],   // legacy record, no field
            standingsRows: [],
            ownEntries: [],
        });
        expect('pickedWeeks' in rows[0]).toBe(true);
        expect(rows[0].pickedWeeks).toBeUndefined();
    });

    it('an empty marker is preserved as [] — "has picked no week"', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson', { pickedWeeks: [] })],
            standingsRows: [],
            ownEntries: [],
        });
        expect(rows[0].pickedWeeks).toEqual([]);
    });

    it('grafts server-revealed picks onto another member\'s row', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson', { pickedWeeks: [4] })],
            standingsRows: [scored('ron', 'Ron Johnson')],
            ownEntries: [],
            reveal: { week: 4, picks: { ron: { 4: 'KC' } }, confidence: {}, tiebreakers: { ron: 41 } },
        });
        expect(rows[0].picks).toEqual({ 4: 'KC' });
        expect(rows[0].weeklyTiebreakers).toEqual({ 4: 41 });
    });

    it('grafts NOTHING when the server revealed nothing — the boundary is not widened here', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson', { pickedWeeks: [4] })],
            standingsRows: [scored('ron', 'Ron Johnson')],
            ownEntries: [],
            reveal: { week: 4, picks: {}, confidence: {}, tiebreakers: {} },
        });
        expect(rows[0].picks).toBeUndefined();
    });

    it('never overwrites the viewer\'s OWN grafted picks with the reveal', () => {
        // The commissioner who plays: their own entry is the source of their own
        // picks, and it holds the whole sheet — including games the reveal has
        // not opened. This is the regression PLAN §7 risk 1 names.
        const own = { id: 'johnny', ownerUid: 'johnny', userName: 'Johnny Football', picks: { 4: 'SF', 5: 'DAL' } };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('johnny', 'Johnny Football', { pickedWeeks: [4, 5] })],
            standingsRows: [],
            ownEntries: [own],
            reveal: { week: 4, picks: { johnny: { 4: 'KC' } }, confidence: {}, tiebreakers: {} },
        });
        expect(rows[0].picks).toEqual({ 4: 'SF', 5: 'DAL' });
    });

    /**
     * 🛑 RENDER-PHASE SAFETY. `NFLPoolDashboard` calls this from a `useMemo`,
     * so it runs DURING render — and its inputs are React state. The grafting
     * pass writes `pickedWeeks` / `picks` / `confidence` / `weeklyTiebreakers`
     * onto every row it returns, so returning a `standingsRows` element by
     * reference would mutate state during render.
     *
     * It is also wrong independently of React: the pick merge is ADDITIVE, so a
     * row object reused across weeks accumulates the picks of every week it was
     * ever grafted for and nothing removes them. (qodo, re-review of PR #430.)
     */
    it('never mutates the standingsRows it was given', () => {
        const row = scored('kevin', 'Kevin Struck');
        const before = JSON.parse(JSON.stringify(row));
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('kevin', 'Kevin Struck', { pickedWeeks: [4] })],
            standingsRows: [row],
            ownEntries: [],
            reveal: { week: 4, picks: { kevin: { 4: 'KC' } }, confidence: {}, tiebreakers: {} },
        });
        // The returned row carries the graft...
        expect(rows[0].picks).toEqual({ 4: 'KC' });
        expect(rows[0].pickedWeeks).toEqual([4]);
        // ...and the caller's object is untouched, by value AND by identity.
        expect(row).toEqual(before);
        expect(rows[0]).not.toBe(row);
    });

    it('a row reached through the participant fallback is cloned too', () => {
        // Same hazard, different loop: this row has no Member Record and is
        // pushed straight from the projection.
        const row = scored('legacy', 'Legacy Player');
        const before = JSON.parse(JSON.stringify(row));
        const rows = buildMemberStandings({
            pool: POOL,
            members: [],
            standingsRows: [row],
            ownEntries: [],
            reveal: { week: 4, picks: { legacy: { 4: 'KC' } }, confidence: {}, tiebreakers: {} },
        });
        expect(rows[0].picks).toEqual({ 4: 'KC' });
        expect(row).toEqual(before);
        expect(rows[0]).not.toBe(row);
    });

    it('two consecutive weeks do not accumulate picks on the same object', () => {
        // The additive-merge half of the same defect: run week 4, then week 5,
        // over the SAME input array, exactly as a week change does.
        const input = [scored('kevin', 'Kevin Struck')];
        const args = { pool: POOL, members: [member('kevin', 'Kevin Struck')], standingsRows: input, ownEntries: [] };
        buildMemberStandings({ ...args, reveal: { week: 4, picks: { kevin: { 4: 'KC' } }, confidence: {}, tiebreakers: {} } });
        const week5 = buildMemberStandings({ ...args, reveal: { week: 5, picks: { kevin: { 5: 'SF' } }, confidence: {}, tiebreakers: {} } });
        expect(week5[0].picks).toEqual({ 5: 'SF' });
    });
});

describe('weeklyReveals — the multi-week grid must not print "no pick" for a revealed week', () => {
    /**
     * codex P1 on the implementation. `reveal` is the SELECTED week only, so a
     * Survivor/Margin grid drawing weeks 1..4 saw another member's picks map
     * holding week 4 and nothing else — and rendered weeks 1-3 as "—", i.e.
     * "they made no pick", about weeks that had revealed long ago.
     */
    it('grafts picks from every cached week, not just the selected one', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('kevin', 'Kevin Struck'), member('ron', 'Ron Johnson')],
            standingsRows: [],
            ownEntries: [],
            reveal: { week: 3, picks: { ron: { 3: 'KC' } }, confidence: {}, tiebreakers: {} },
            weeklyReveals: [
                { week: 1, picks: { ron: { 1: 'SF' } }, confidence: {}, tiebreakers: {} },
                { week: 2, picks: { ron: { 2: 'DAL' } }, confidence: {}, tiebreakers: {} },
            ],
        });
        const ron = rows.find(r => r.ownerUid === 'ron');
        expect(ron.picks).toEqual({ 1: 'SF', 2: 'DAL', 3: 'KC' });
    });

    it('leaves rows untouched when no extra weeks are supplied (the Pick’em path)', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson')],
            standingsRows: [],
            ownEntries: [],
            reveal: { week: 3, picks: { ron: { 3: 'KC' } }, confidence: {}, tiebreakers: {} },
        });
        expect(rows.find(r => r.ownerUid === 'ron').picks).toEqual({ 3: 'KC' });
    });

    it('still never overwrites the viewer’s OWN picks', () => {
        const own = { id: 'johnny', ownerUid: 'johnny', userName: 'Johnny Football', picks: { 1: 'SF' } };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('johnny', 'Johnny Football')],
            standingsRows: [],
            ownEntries: [own],
            reveal: null,
            weeklyReveals: [{ week: 1, picks: { johnny: { 1: 'KC' } }, confidence: {}, tiebreakers: {} }],
        });
        expect(rows[0].picks).toEqual({ 1: 'SF' });
    });
});

/**
 * PLAN-MULTI-ENTRY T4 — ONE ROW PER ENTRY.
 *
 * This is the behaviour test §0b.6 promised as the compensating check for the
 * regex guard in `tests/nfl-surface-invariants.test.ts`: an alias
 * (`const key = row.ownerUid`) is out of a regex's reach, and two rows sharing
 * an `ownerUid` is the thing that actually breaks when one appears. It was
 * written red-then-green with this ticket, exactly as the plan says.
 *
 * The roster of a member's entries comes from the Member Record `entries` map
 * (D2) — the authorization-safe list a participant may read — never from the
 * entry documents, which participants cannot read.
 */
describe('buildMemberStandings — one row per ENTRY (PLAN-MULTI-ENTRY T4/D6)', () => {
    // Kevin holds two entries; the second is named. Note `hasPlayableEntry` and
    // `pickedWeeks` stay PER MEMBER — the record carries no per-entry weeks.
    const twoEntryMember = {
        uid: 'kevin',
        userName: 'Kevin Struck',
        hasPlayableEntry: true,
        playableEntryCount: 2,
        entries: {
            kevin: { entryIndex: 1 },
            'e2:kevin': { entryIndex: 2, name: 'Kevin B' },
        },
    };

    it('emits two rows for one uid, distinct by entry id', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [twoEntryMember, member('ron', 'Ron Johnson')],
            standingsRows: [scored('kevin', 'Kevin Struck'), { ...scored('e2:kevin', 'Kevin Struck'), ownerUid: 'kevin', entryName: 'Kevin B' }],
            ownEntries: [],
        });
        const kevins = rows.filter(r => r.ownerUid === 'kevin');
        expect(kevins).toHaveLength(2);
        expect(kevins.map(r => r.id)).toEqual(['kevin', 'e2:kevin']);   // entryIndex order
        expect(rows).toHaveLength(3);
    });

    it("gives an UNSCORED second entry its own placeholder row, carrying the entry's name", () => {
        // The second entry exists in the roster map but the last scoring pass
        // predates it — precisely the case the projection alone cannot answer.
        const rows = buildMemberStandings({
            pool: POOL,
            members: [twoEntryMember],
            standingsRows: [scored('kevin', 'Kevin Struck')],
            ownEntries: [],
        });
        expect(rows).toHaveLength(2);
        const second = rows[1];
        expect(second.id).toBe('e2:kevin');
        expect(second.ownerUid).toBe('kevin');
        expect(second.entryName).toBe('Kevin B');
        expect(second.unscored).toBe(true);
        // It must NOT claim a status, a strike count or a rebuy count.
        expect(second.status).toBeUndefined();
        expect(second.strikesUsed).toBeUndefined();
    });

    it('renders BOTH of the viewer\'s own entries, each with its own picks', () => {
        const own1 = { id: 'kevin', ownerUid: 'kevin', userName: 'Kevin Struck', entryIndex: 1, picks: { 2: 'ATL' } };
        const own2 = { id: 'e2:kevin', ownerUid: 'kevin', userName: 'Kevin Struck', entryIndex: 2, entryName: 'Kevin B', picks: { 2: 'BUF' } };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [twoEntryMember],
            standingsRows: [],
            // Deliberately out of index order: the fold must not depend on the
            // order Firestore returned the query in.
            ownEntries: [own2, own1],
        });
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.id).sort()).toEqual(['e2:kevin', 'kevin']);
        expect(rows.find(r => r.id === 'kevin')!.picks).toEqual({ 2: 'ATL' });
        expect(rows.find(r => r.id === 'e2:kevin')!.picks).toEqual({ 2: 'BUF' });
    });

    it('grafts revealed picks per ENTRY — the two rows do not get the same sheet', () => {
        // 🛑 THE REGRESSION THIS PINS. A uid-keyed graft hands every one of a
        // player's rows the SAME picks, so entry #2 renders entry #1's sheet —
        // worse than rendering nothing, because it is a confident lie.
        const rows = buildMemberStandings({
            pool: POOL,
            members: [twoEntryMember],
            standingsRows: [scored('kevin', 'Kevin Struck'), { ...scored('e2:kevin', 'Kevin Struck'), ownerUid: 'kevin' }],
            ownEntries: [],
            reveal: {
                week: 2,
                picks: { kevin: { 2: 'ATL' }, 'e2:kevin': { 2: 'BUF' } },
                confidence: {},
                tiebreakers: { kevin: 41, 'e2:kevin': 55 },
            },
        });
        expect(rows.find(r => r.id === 'kevin')!.picks).toEqual({ 2: 'ATL' });
        expect(rows.find(r => r.id === 'e2:kevin')!.picks).toEqual({ 2: 'BUF' });
        expect(rows.find(r => r.id === 'kevin')!.weeklyTiebreakers).toEqual({ 2: 41 });
        expect(rows.find(r => r.id === 'e2:kevin')!.weeklyTiebreakers).toEqual({ 2: 55 });
    });

    it('copies the member-level pickedWeeks onto EVERY row that member holds', () => {
        // D2 — `pickedWeeks` is the UNION across a member's entries and stays
        // per member on purpose: a per-entry map on a participant-readable
        // record would leak which specific entry has an unrevealed week's pick.
        const rows = buildMemberStandings({
            pool: POOL,
            members: [{ ...twoEntryMember, pickedWeeks: [1, 2] }],
            standingsRows: [scored('kevin', 'Kevin Struck'), { ...scored('e2:kevin', 'Kevin Struck'), ownerUid: 'kevin' }],
            ownEntries: [],
        });
        expect(rows.map(r => r.pickedWeeks)).toEqual([[1, 2], [1, 2]]);
    });

    it('a Member Record with NO entries map is one row keyed by the uid (every pool today)', () => {
        // The legacy shape. Returning zero rows here would empty the standings
        // table of every pool in production.
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson')],
            standingsRows: [],
            ownEntries: [],
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('ron');
        expect(rows[0].ownerUid).toBe('ron');
        expect(rows[0].unscored).toBe(true);
    });

    it('an empty entries map falls back to the one uid-keyed row too', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [{ uid: 'ron', userName: 'Ron Johnson', hasPlayableEntry: true, entries: {} }],
            standingsRows: [],
            ownEntries: [],
        });
        expect(rows.map(r => r.id)).toEqual(['ron']);
    });

    it('a scored second entry whose OWNER left the roster is dropped, not kept by entry id', () => {
        // Membership is a question about the PERSON. Asking `participantIds`
        // for `e2:gone` would answer "no" for every extra entry of every member,
        // so the check reads `ownerUid` while the row stays keyed by its id.
        const rows = buildMemberStandings({
            pool: { participantIds: ['kevin'] },
            members: [],
            standingsRows: [
                { ...scored('e2:kevin', 'Kevin Struck'), ownerUid: 'kevin' },
                { ...scored('e2:stranger', 'Stranger'), ownerUid: 'stranger' },
            ],
            ownEntries: [],
        });
        expect(rows.map(r => r.id)).toEqual(['e2:kevin']);
    });
});
