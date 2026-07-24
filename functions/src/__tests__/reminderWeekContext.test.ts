import { describe, it, expect } from 'vitest';
import {
    getWeekContext,
    newWeekContextCache,
    checkNFLNonPickerReminders,
} from '../reminders';

/**
 * Guards for the runReminders read-amplification fix (PLAN-READS-RUNREMINDERS.md).
 *
 * Measured 2026-07-23 via Firestore Query Insights: the week lookup ran once per
 * NFL pool per run and scanned the whole remaining season (305 docs) each time —
 * ~966K reads/day, the largest single source of reads in the app. The answer
 * depends only on (season, seasonType) and `now`, so it is memoized per run.
 *
 * These tests assert the QUERY COUNT, not merely that the code still works.
 * A memo that is present but keyed wrong still passes a "does it work" test,
 * which is the class of guard this repo keeps writing by accident.
 */

type Game = { id: string; season: string; seasonType: number; week: number; startTime: number };
type Filter = [string, string, unknown];

interface Counts { future: number; week: number }

/**
 * Minimal Firestore stand-in. Counts nfl_games queries, split by whether they
 * carry the `startTime` range (the expensive whole-season scan) or the
 * equality-only week fetch.
 */
function makeDb(games: Game[], counts: Counts) {
    const build = (collectionName: string, filters: Filter[]): any => ({
        where: (field: string, op: string, value: unknown) =>
            build(collectionName, [...filters, [field, op, value]]),
        limit: () => build(collectionName, filters),
        get: async () => {
            if (collectionName !== 'nfl_games') return { docs: [], empty: true, size: 0 };
            if (filters.some(([f]) => f === 'startTime')) counts.future++;
            else counts.week++;
            const matched = games.filter(g =>
                filters.every(([f, op, v]) => {
                    const actual = (g as any)[f];
                    return op === '>' ? actual > (v as number) : actual === v;
                }),
            );
            return {
                docs: matched.map(g => ({ id: g.id, data: () => g })),
                empty: matched.length === 0,
                size: matched.length,
            };
        },
    });

    return {
        collection: (name: string) => ({
            ...build(name, []),
            // pools/{id}/entries — never reached in these tests, which bail at
            // the send-window check, but present so a regression surfaces as a
            // failed assertion rather than a TypeError.
            doc: () => ({
                collection: () => ({ get: async () => ({ docs: [], empty: true, size: 0 }) }),
            }),
        }),
    } as any;
}

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** Kickoffs far enough out that no reminder tier fires (T-36h / T-4h). */
const GAMES: Game[] = [
    { id: 'g5a', season: '2026', seasonType: 2, week: 5, startTime: NOW + 30 * DAY },
    { id: 'g5b', season: '2026', seasonType: 2, week: 5, startTime: NOW + 31 * DAY },
    { id: 'g6a', season: '2026', seasonType: 2, week: 6, startTime: NOW + 37 * DAY },
    // Preseason, same season year — must not be confused with seasonType 2.
    { id: 'p1a', season: '2026', seasonType: 1, week: 1, startTime: NOW + 20 * DAY },
    // A different season year.
    { id: 'x1a', season: '2027', seasonType: 2, week: 1, startTime: NOW + 300 * DAY },
    // Already kicked off — must be excluded by the startTime filter.
    { id: 'g4a', season: '2026', seasonType: 2, week: 4, startTime: NOW - DAY },
];

const nflPool = (id: string, season: string, seasonType: number) =>
    ({ id, type: 'NFL_PICKEM', season, seasonType, status: 'OPEN', settings: {} }) as any;

describe('getWeekContext', () => {
    it('resolves the next week and returns that week\'s full slate', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const ctx = await getWeekContext(makeDb(GAMES, counts), '2026', 2, NOW, newWeekContextCache());

        // Week 4 already kicked off, so the next week is 5 — not 4, not 6.
        expect(ctx?.week).toBe(5);
        expect(ctx?.weekGames.map(g => g.id).sort()).toEqual(['g5a', 'g5b']);
    });

    it('keeps preseason and regular season apart on the same season year', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const ctx = await getWeekContext(makeDb(GAMES, counts), '2026', 1, NOW, newWeekContextCache());
        expect(ctx?.week).toBe(1);
        expect(ctx?.weekGames.map(g => g.id)).toEqual(['p1a']);
    });

    it('returns null when the season has no future games', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const ctx = await getWeekContext(makeDb(GAMES, counts), '2099', 2, NOW, newWeekContextCache());
        expect(ctx).toBeNull();
    });
});

describe('runReminders week-lookup memoization', () => {
    it('issues ONE whole-season scan for many pools sharing (season, seasonType)', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const db = makeDb(GAMES, counts);
        const cache = newWeekContextCache();

        for (const pool of [
            nflPool('a', '2026', 2),
            nflPool('b', '2026', 2),
            nflPool('c', '2026', 2),
        ]) {
            await checkNFLNonPickerReminders(db, pool, NOW, cache);
        }

        // Before the fix this was 3 and 3. This assertion IS the fix.
        expect(counts.future).toBe(1);
        expect(counts.week).toBe(1);
    });

    it('still queries per SEASON — a memo keyed on nothing would pass the test above', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const db = makeDb(GAMES, counts);
        const cache = newWeekContextCache();

        await checkNFLNonPickerReminders(db, nflPool('a', '2026', 2), NOW, cache);
        await checkNFLNonPickerReminders(db, nflPool('b', '2027', 2), NOW, cache);

        expect(counts.future).toBe(2);
    });

    it('still queries per SEASONTYPE — a memo keyed on season alone would remind the wrong slate', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const db = makeDb(GAMES, counts);
        const cache = newWeekContextCache();

        await checkNFLNonPickerReminders(db, nflPool('a', '2026', 2), NOW, cache);
        await checkNFLNonPickerReminders(db, nflPool('b', '2026', 1), NOW, cache);

        expect(counts.future).toBe(2);
    });

    it('does not let a numeric season poison a string season (Firestore equality is typed)', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const db = makeDb(GAMES, counts);
        const cache = newWeekContextCache();

        // Games are stored with string seasons. A pool persisted with numeric
        // 2026 matches nothing and resolves null — its own pre-existing problem.
        // It must not take the string-season pools down with it.
        await checkNFLNonPickerReminders(db, nflPool('numeric', 2026 as any, 2), NOW, cache);
        const ctx = await getWeekContext(db, '2026', 2, NOW, cache);

        expect(ctx?.week).toBe(5);
        expect(counts.future).toBe(2);
    });

    it('evicts a FAILED lookup so the next pool retries, instead of caching the rejection', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const good = makeDb(GAMES, counts);
        let failNext = true;
        const flaky = {
            collection: (name: string) => {
                if (name === 'nfl_games' && failNext) {
                    failNext = false;
                    const boom = {
                        where: () => boom,
                        limit: () => boom,
                        get: async () => { throw new Error('transient Firestore error'); },
                    };
                    return boom;
                }
                return good.collection(name);
            },
        } as any;
        const cache = newWeekContextCache();

        // First pool hits the transient failure; its own try/catch swallows it.
        await checkNFLNonPickerReminders(flaky, nflPool('a', '2026', 2), NOW, cache);
        // Second pool must get a real answer, not the cached rejection.
        const ctx = await getWeekContext(flaky, '2026', 2, NOW, cache);

        expect(ctx?.week).toBe(5);
    });

    it('does NOT cache across runs — a module-level memo would send stale-week reminders', async () => {
        const counts: Counts = { future: 0, week: 0 };
        const db = makeDb(GAMES, counts);

        // No cache argument: each call stands alone, as every non-runReminders
        // caller does. Two separate "runs" must both hit Firestore.
        await checkNFLNonPickerReminders(db, nflPool('a', '2026', 2), NOW, undefined);
        await checkNFLNonPickerReminders(db, nflPool('a', '2026', 2), NOW + 60_000, undefined);

        expect(counts.future).toBe(2);
    });
});
