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
            ownEntry: null,
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['kevin', 'ron']);
    });

    it('marks a member with no scored row `unscored` instead of inventing standings', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson')],
            standingsRows: [],
            ownEntry: null,
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
            ownEntry: own,
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
            ownEntry: null,
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
            ownEntry: null,
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
            ownEntry: null,
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
            ownEntry: null,
        });
        expect(withRoster.map(r => r.ownerUid)).toEqual(['kevin']);
    });

    it('drops a member marked not present, and tolerates empty inputs', () => {
        expect(buildMemberStandings({
            pool: POOL,
            members: [member('gone', 'Removed', { present: false })],
            standingsRows: [],
            ownEntry: null,
        })).toEqual([]);
        // A REMOVED player: the same transaction that deletes the Member Record also
        // drops the uid from participantIds, so the projection's stale copy of them
        // must not resurrect them.
        expect(buildMemberStandings({
            pool: { participantIds: ['kevin'] },
            members: [member('gone', 'Removed', { present: false })],
            standingsRows: [scored('gone', 'Removed')],
            ownEntry: null,
        })).toEqual([]);
        expect(buildMemberStandings({ pool: POOL, members: [], standingsRows: [], ownEntry: null })).toEqual([]);
    });

    // codex: a Member Record's existence proves nothing — the pre-#344 claim path
    // could forge one. Same predicate the commissioner roster uses.
    it('ignores an unproven Member Record, and still shows the legacy projection', () => {
        const rows = buildMemberStandings({
            pool: { participantIds: ['kevin'] },
            members: [member('kevin', 'Kevin Struck'), member('forged', 'Forged Member')],
            standingsRows: [scored('kevin', 'Kevin Struck')],
            ownEntry: null,
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['kevin']);

        // A forged record cannot suppress a legitimate scored participant either:
        // the projection row is kept on its own evidence, participantIds.
        const onlyForged = buildMemberStandings({
            pool: { participantIds: ['legacy'] },
            members: [member('forged', 'Forged Member')],
            standingsRows: [scored('legacy', 'Legacy Player')],
            ownEntry: null,
        });
        expect(onlyForged.map(r => r.ownerUid)).toEqual(['legacy']);

        // And a pool doc with NO participantIds at all (legacy shape, or a snapshot
        // that has not arrived) still shows the projection rather than an empty table.
        const noIds = buildMemberStandings({
            pool: {},
            members: [],
            standingsRows: [scored('legacy', 'Legacy Player')],
            ownEntry: null,
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
            ownEntry: own,
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
            ownEntry: null,
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['ron']);
    });

    it('keeps a member whose latch is unset but who HAS been scored', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [{ uid: 'kevin', userName: 'Kevin Struck' }], // pre-latch record
            standingsRows: [scored('kevin', 'Kevin Struck')],
            ownEntry: null,
        });
        expect(rows.map(r => r.ownerUid)).toEqual(['kevin']);
    });

    it('lists the viewer first', () => {
        const own = { id: 'johnny', ownerUid: 'johnny', userName: 'Johnny Football' };
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('aaron', 'Aaron A'), member('johnny', 'Johnny Football')],
            standingsRows: [],
            ownEntry: own,
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
            ownEntry: null,
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
            ownEntry: null,
        });
        expect('pickedWeeks' in rows[0]).toBe(true);
        expect(rows[0].pickedWeeks).toBeUndefined();
    });

    it('an empty marker is preserved as [] — "has picked no week"', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson', { pickedWeeks: [] })],
            standingsRows: [],
            ownEntry: null,
        });
        expect(rows[0].pickedWeeks).toEqual([]);
    });

    it('grafts server-revealed picks onto another member\'s row', () => {
        const rows = buildMemberStandings({
            pool: POOL,
            members: [member('ron', 'Ron Johnson', { pickedWeeks: [4] })],
            standingsRows: [scored('ron', 'Ron Johnson')],
            ownEntry: null,
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
            ownEntry: null,
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
            ownEntry: own,
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
            ownEntry: null,
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
            ownEntry: null,
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
        const args = { pool: POOL, members: [member('kevin', 'Kevin Struck')], standingsRows: input, ownEntry: null };
        buildMemberStandings({ ...args, reveal: { week: 4, picks: { kevin: { 4: 'KC' } }, confidence: {}, tiebreakers: {} } });
        const week5 = buildMemberStandings({ ...args, reveal: { week: 5, picks: { kevin: { 5: 'SF' } }, confidence: {}, tiebreakers: {} } });
        expect(week5[0].picks).toEqual({ 5: 'SF' });
    });
});
