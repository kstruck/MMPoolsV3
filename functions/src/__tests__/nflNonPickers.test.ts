import { describe, it, expect } from 'vitest';
import { nflReminderTier, nflNonPickerUids, entryHasPicked } from '../lib/nflNonPickers';

/**
 * The two pure rules behind the automated NFL non-picker reminder.
 *
 * The roster rule exists because of 2026 regular-season Week 1: four live NFL
 * pools, a clean runReminders pass every 15 minutes through both send windows,
 * and ZERO reminders written — every member who had joined but not yet
 * submitted had no entry document, and the reminder only ever looked at
 * entries. These tests pin the roster as the source of targets so an
 * "entries-only" rewrite cannot come back looking correct.
 */

const POLL_MINUTES = 15;

describe('nflReminderTier', () => {
    it('fires the 24H tier one day out and the 4H tier as last call', () => {
        expect(nflReminderTier(24)).toBe('24H');
        expect(nflReminderTier(20)).toBe('24H');
        expect(nflReminderTier(18.01)).toBe('24H');
        expect(nflReminderTier(4)).toBe('4H');
        expect(nflReminderTier(0.25)).toBe('4H');
    });

    it('is silent outside the windows, including the old T-36h band and after lock', () => {
        expect(nflReminderTier(36)).toBeNull();
        expect(nflReminderTier(30)).toBeNull();
        expect(nflReminderTier(24.01)).toBeNull();
        expect(nflReminderTier(18)).toBeNull();
        expect(nflReminderTier(10)).toBeNull();
        expect(nflReminderTier(0)).toBeNull();
        expect(nflReminderTier(-1)).toBeNull();
    });

    it('every window is wider than the 15-minute poll, so no lock can fall between two polls', () => {
        // Simulate a lock at an arbitrary offset from the poll grid and assert
        // each tier is observed at least once — the same guard
        // reminderBracketCadence.test.ts keeps for bracket pools.
        for (let offsetMin = 0; offsetMin < POLL_MINUTES; offsetMin += 1) {
            const seen = new Set<string>();
            for (let t = 48 * 60; t >= 0; t -= POLL_MINUTES) {
                const hours = (t + offsetMin) / 60;
                const tier = nflReminderTier(hours);
                if (tier) seen.add(tier);
            }
            expect([...seen].sort()).toEqual(['24H', '4H']);
        }
    });
});

describe('entryHasPicked', () => {
    it("pick'em needs EVERY game of the week", () => {
        const ids = ['g1', 'g2', 'g3'];
        expect(entryHasPicked('NFL_PICKEM', { id: 'e', picks: { g1: 'SEA', g2: 'KC', g3: 'BUF' } }, 1, ids)).toBe(true);
        expect(entryHasPicked('NFL_PICKEM', { id: 'e', picks: { g1: 'SEA', g2: 'KC' } }, 1, ids)).toBe(false);
        expect(entryHasPicked('NFL_PICKEM', { id: 'e', picks: null }, 1, ids)).toBe(false);
    });

    it('survivor and margin key picks by week, and accept a string key (Firestore map keys are strings)', () => {
        expect(entryHasPicked('NFL_SURVIVOR', { id: 'e', picks: { 1: 'SEA' } }, 1, [])).toBe(true);
        expect(entryHasPicked('NFL_MARGIN', { id: 'e', picks: { '3': 'KC' } }, 3, [])).toBe(true);
        expect(entryHasPicked('NFL_SURVIVOR', { id: 'e', picks: { 2: 'SEA' } }, 1, [])).toBe(false);
    });
});

const WEEK = 1;
const GAME_IDS = ['g1', 'g2'];
const member = (id: string, extra: Partial<{ role: string; joinedAt: unknown }> = {}) =>
    ({ id, userName: id, joinedAt: 1_700_000_000_000, ...extra });
const full = { g1: 'SEA', g2: 'KC' };

describe('nflNonPickerUids — targets come from the roster', () => {
    it('a member who joined and never submitted (no entry document) IS a non-picker', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [member('joined-never-picked'), member('picked')],
            entries: [{ id: 'picked', ownerUid: 'picked', picks: full }],
        });
        expect([...out]).toEqual(['joined-never-picked']);
    });

    it('an entries-only view would have missed them — the regression this file exists for', () => {
        // Same pool, but the roster read is dropped: the result must be EMPTY,
        // which is exactly the silent Week-1 outcome. If this assertion ever
        // fails the roster read has become redundant, and that is worth knowing.
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [],
            entries: [{ id: 'picked', ownerUid: 'picked', picks: full }],
        });
        expect(out.size).toBe(0);
    });

    it('an entry with a partial sheet is a non-picker; a complete sheet is not', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [member('partial'), member('done')],
            entries: [
                { id: 'partial', ownerUid: 'partial', picks: { g1: 'SEA' } },
                { id: 'done', ownerUid: 'done', picks: full },
            ],
        });
        expect([...out]).toEqual(['partial']);
    });

    it('a hosting-only commissioner (MANAGER record, no entry) is NOT chased — hosting is not playing', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [member('host', { role: 'MANAGER' }), member('player')],
            entries: [],
        });
        expect([...out]).toEqual(['player']);
    });

    it('a commissioner who plays is judged on their entry like anyone else', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [member('host', { role: 'MANAGER' })],
            entries: [{ id: 'host', ownerUid: 'host', picks: { g1: 'SEA' } }],
        });
        expect([...out]).toEqual(['host']);
    });

    it('a non-canonical Member Record (no joinedAt) is not a target unless an entry vouches for it', () => {
        // The #344 forged-record guard, inherited from resolveReminderTargets.
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [member('forged', { joinedAt: undefined }), member('forged-but-entered', { joinedAt: undefined })],
            entries: [{ id: 'forged-but-entered', ownerUid: 'forged-but-entered', picks: {} }],
        });
        expect([...out]).toEqual(['forged-but-entered']);
    });

    it('multi-entry: one unfinished entry makes the owner a non-picker; reminded once', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [member('multi')],
            entries: [
                { id: 'multi', ownerUid: 'multi', picks: full },
                { id: 'e2:multi', ownerUid: 'multi', picks: {} },
            ],
        });
        expect([...out]).toEqual(['multi']);
    });

    it('survivor: eliminated entries are not live; a uid whose only entry is eliminated owes nothing', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_SURVIVOR', week: 3, weekGameIds: GAME_IDS,
            members: [member('out'), member('alive-unpicked'), member('alive-picked'), member('never')],
            entries: [
                { id: 'out', ownerUid: 'out', status: 'ELIMINATED', picks: {} },
                { id: 'alive-unpicked', ownerUid: 'alive-unpicked', status: 'ALIVE', picks: { 1: 'SEA', 2: 'KC' } },
                { id: 'alive-picked', ownerUid: 'alive-picked', status: 'ALIVE', picks: { 1: 'SEA', 2: 'KC', 3: 'BUF' } },
            ],
        });
        expect([...out].sort()).toEqual(['alive-unpicked', 'never']);
    });

    it('margin: keyed by week, no elimination concept', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_MARGIN', week: 2, weekGameIds: GAME_IDS,
            members: [member('a'), member('b')],
            entries: [
                { id: 'a', ownerUid: 'a', picks: { 1: 'SEA' } },
                { id: 'b', ownerUid: 'b', picks: { 1: 'SEA', 2: 'KC' } },
            ],
        });
        expect([...out]).toEqual(['a']);
    });

    it('an entry whose owner has no Member Record is still a target (entries vouch for themselves)', () => {
        const out = nflNonPickerUids({
            poolType: 'NFL_PICKEM', week: WEEK, weekGameIds: GAME_IDS,
            members: [],
            entries: [{ id: 'legacy', ownerUid: 'legacy', picks: {} }],
        });
        expect([...out]).toEqual(['legacy']);
    });
});
