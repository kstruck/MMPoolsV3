import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    SCOREBOARD_SPAN_MAX_DAYS,
    buildScoreboardDayUrl,
    enumerateScoreboardDates,
    fetchScoreboardSpanEvents,
    formatScoreboardDate,
} from '../lib/espnScoreboardSpan';

/**
 * Guard for the 2026-09-15 ESPN date-RANGE break: `?dates=YYYYMMDD-YYYYMMDD`
 * now answers HTTP 400 `{"code":400,"message":"Failed to get events endpoint."}`
 * while a single `?dates=YYYYMMDD` still answers 200. Measured live that day;
 * the 2025 tournament span replayed one-day-at-a-time returned all 67 games.
 *
 * Two things are pinned here, because both were true bugs:
 *  1. the URL SHAPE — one date, never a range;
 *  2. a failed day does not take the rest of the span down with it.
 */

const NCAA = 'basketball/mens-college-basketball';

/** The exact URL measured returning HTTP 200 on 2026-09-15. */
const KNOWN_GOOD_PATH =
    '/basketball/mens-college-basketball/scoreboard?dates=20260317&limit=200&groups=100';

const jsonResponse = (body: unknown): Response =>
    ({ ok: true, status: 200, statusText: 'OK', json: async () => body } as Response);

/** ESPN's actual reply to a range request since 2026-09-15. */
const rangeBreakResponse = (): Response =>
    ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ code: 400, message: 'Failed to get events endpoint.' }),
    } as Response);

const event = (id: string) => ({ id });

/** Drop comments so prose about the broken range form is not read as code. */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Every `dates=` query value in the source that contains a `-`, i.e. every
 * remaining date RANGE. A single `YYYYMMDD` never contains a hyphen, so this
 * catches `dates=${start}-${end}`, `dates=20260315-20260410`, and the
 * near-miss `dates=${y}0315-${y}0410` alike — the first version of this guard
 * matched only the first two and let the third through.
 */
function dateParamValues(src: string): string[] {
    const offenders: string[] = [];
    const re = /dates=([^&`\s)]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripComments(src))) !== null) {
        if (m[1].includes('-')) offenders.push(m[0]);
    }
    return offenders;
}

describe('ESPN scoreboard URL shape (2026-09-15 range break)', () => {
    it('builds the single-date URL that ESPN still answers 200', () => {
        const url = buildScoreboardDayUrl({ leaguePath: NCAA, date: '20260317', limit: 200, groups: 100 });
        expect(url.endsWith(KNOWN_GOOD_PATH)).toBe(true);
    });

    it('never emits a dates= RANGE, which is the form that 400s', () => {
        const url = buildScoreboardDayUrl({ leaguePath: NCAA, date: '20260317', limit: 200, groups: 100 });
        expect(url).not.toMatch(/dates=\d{8}-\d{8}/);
        expect(url).toMatch(/dates=\d{8}(&|$)/);
    });

    it('refuses a range handed in as the date', () => {
        expect(() =>
            buildScoreboardDayUrl({ leaguePath: NCAA, date: '20260315-20260410', limit: 200, groups: 100 }),
        ).toThrow(/single YYYYMMDD/);
    });

    it('carries the conference group id through unchanged', () => {
        const url = buildScoreboardDayUrl({ leaguePath: NCAA, date: '20260305', limit: 50, groups: 8 });
        expect(url).toContain('?dates=20260305&limit=50&groups=8');
    });

    it('the range guard itself catches every shape of range', () => {
        // Proven by mutation: the FIRST version of this guard passed when a
        // `dates=${y}0315-${y}0410` literal was pasted back into espnBracket.ts.
        expect(dateParamValues('`?dates=${start}-${end}&limit=200`')).toHaveLength(1);
        expect(dateParamValues('"?dates=20260315-20260410&limit=200"')).toHaveLength(1);
        expect(dateParamValues('`?dates=${y}0315-${y}0410&limit=200`')).toHaveLength(1);
        // ...and does not cry wolf on the single-date form or on prose.
        expect(dateParamValues('`?dates=${date}&limit=200`')).toEqual([]);
        expect(dateParamValues('`?dates=20260317&limit=200`')).toEqual([]);
        expect(dateParamValues('// a range is ?dates=YYYYMMDD-YYYYMMDD and now 400s')).toEqual([]);
        expect(dateParamValues('/* ?dates=20260315-20260410 used to work */')).toEqual([]);
    });

    it('espnBracket.ts no longer builds a scoreboard date range', () => {
        const src = readFileSync(join(__dirname, '..', 'espnBracket.ts'), 'utf8');
        expect(dateParamValues(src)).toEqual([]);
    });
});

describe('enumerateScoreboardDates', () => {
    it('is inclusive of both ends and ascending', () => {
        expect(enumerateScoreboardDates('20260315', '20260318')).toEqual([
            '20260315', '20260316', '20260317', '20260318',
        ]);
    });

    it('covers the real NCAA tournament span', () => {
        const dates = enumerateScoreboardDates('20260315', '20260410');
        expect(dates).toHaveLength(27);
        expect(dates[0]).toBe('20260315');
        expect(dates[dates.length - 1]).toBe('20260410');
    });

    it('crosses a month boundary', () => {
        expect(enumerateScoreboardDates('20260330', '20260402')).toEqual([
            '20260330', '20260331', '20260401', '20260402',
        ]);
    });

    it('handles a leap day', () => {
        expect(enumerateScoreboardDates('20280228', '20280301')).toEqual([
            '20280228', '20280229', '20280301',
        ]);
    });

    it('accepts a single-day span', () => {
        expect(enumerateScoreboardDates('20260317', '20260317')).toEqual(['20260317']);
    });

    it('rejects a reversed span', () => {
        expect(() => enumerateScoreboardDates('20260410', '20260315')).toThrow(/ends before it starts/);
    });

    it('rejects a date that is not on the calendar', () => {
        expect(() => enumerateScoreboardDates('20260231', '20260301')).toThrow(/not a real calendar date/);
    });

    it('rejects a malformed date', () => {
        expect(() => enumerateScoreboardDates('2026-03-15', '20260318')).toThrow(/YYYYMMDD/);
    });

    it('caps the span so a typo cannot fan out into thousands of requests', () => {
        expect(() => enumerateScoreboardDates('20260101', '20261231')).toThrow(
            new RegExp(`${SCOREBOARD_SPAN_MAX_DAYS}-day cap`),
        );
    });

    it('formatScoreboardDate round-trips UTC', () => {
        expect(formatScoreboardDate(Date.UTC(2026, 2, 17))).toBe('20260317');
    });
});

describe('fetchScoreboardSpanEvents', () => {
    it('unions every day, one request per day, no range request', async () => {
        const seen: string[] = [];
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const u = String(url);
            seen.push(u);
            const date = /dates=(\d{8})/.exec(u)?.[1] ?? '';
            return jsonResponse({ events: [event(`g-${date}`)] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260318', limit: 200, groups: 100 },
            { fetchImpl },
        );

        expect(seen).toHaveLength(4);
        expect(seen.every((u) => !/dates=\d{8}-\d{8}/.test(u))).toBe(true);
        expect(result.events.map((e) => e.id)).toEqual([
            'g-20260315', 'g-20260316', 'g-20260317', 'g-20260318',
        ]);
        expect(result.failedDates).toEqual([]);
    });

    it('a 400 on ONE day does not lose the other days', async () => {
        const failed: string[] = [];
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const date = /dates=(\d{8})/.exec(String(url))?.[1] ?? '';
            if (date === '20260317') return rangeBreakResponse();
            return jsonResponse({ events: [event(`g-${date}`)] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260318', limit: 200, groups: 100 },
            { fetchImpl, onDayFailed: (d) => failed.push(d) },
        );

        expect(result.events.map((e) => e.id)).toEqual(['g-20260315', 'g-20260316', 'g-20260318']);
        expect(result.failedDates).toEqual(['20260317']);
        expect(failed).toEqual(['20260317']);
    });

    it('a thrown network error on one day is also survivable', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const date = /dates=(\d{8})/.exec(String(url))?.[1] ?? '';
            if (date === '20260316') throw new Error('socket hang up');
            return jsonResponse({ events: [event(`g-${date}`)] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260317', limit: 200, groups: 100 },
            { fetchImpl },
        );

        expect(result.events.map((e) => e.id)).toEqual(['g-20260315', 'g-20260317']);
        expect(result.failedDates).toEqual(['20260316']);
    });

    it('a day with no games contributes nothing and is NOT a failure', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const date = /dates=(\d{8})/.exec(String(url))?.[1] ?? '';
            if (date === '20260316') return jsonResponse({ events: [] });
            if (date === '20260317') return jsonResponse({});
            return jsonResponse({ events: [event(`g-${date}`)] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260318', limit: 200, groups: 100 },
            { fetchImpl },
        );

        expect(result.events.map((e) => e.id)).toEqual(['g-20260315', 'g-20260318']);
        expect(result.failedDates).toEqual([]);
    });

    it('throws when EVERY day fails, so an outage is never read as "no games"', async () => {
        const fetchImpl = vi.fn(async () => rangeBreakResponse()) as unknown as typeof fetch;

        await expect(
            fetchScoreboardSpanEvents<{ id: string }>(
                { leaguePath: NCAA, start: '20260315', end: '20260318', limit: 200, groups: 100 },
                { fetchImpl },
            ),
        ).rejects.toThrow(/failed on all 4 days/);
    });

    it('de-duplicates a game that ESPN lists on two adjacent days', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const date = /dates=(\d{8})/.exec(String(url))?.[1] ?? '';
            if (date === '20260315') return jsonResponse({ events: [event('4011'), event('4012')] });
            return jsonResponse({ events: [event('4012'), event('4013')] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260316', limit: 200, groups: 100 },
            { fetchImpl },
        );

        expect(result.events.map((e) => e.id)).toEqual(['4011', '4012', '4013']);
    });

    it('keeps date order even when later days resolve first', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const date = /dates=(\d{8})/.exec(String(url))?.[1] ?? '';
            // Earlier dates settle LAST.
            const delay = date === '20260315' ? 20 : date === '20260316' ? 10 : 0;
            await new Promise((r) => setTimeout(r, delay));
            return jsonResponse({ events: [event(`g-${date}`)] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260317', limit: 200, groups: 100 },
            { fetchImpl },
        );

        expect(result.events.map((e) => e.id)).toEqual(['g-20260315', 'g-20260316', 'g-20260317']);
    });

    it('reports every requested date so a partial span is auditable', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            const date = /dates=(\d{8})/.exec(String(url))?.[1] ?? '';
            if (date === '20260316' || date === '20260318') return rangeBreakResponse();
            return jsonResponse({ events: [event(`g-${date}`)] });
        }) as unknown as typeof fetch;

        const result = await fetchScoreboardSpanEvents<{ id: string }>(
            { leaguePath: NCAA, start: '20260315', end: '20260318', limit: 200, groups: 100 },
            { fetchImpl },
        );

        expect(result.requestedDates).toEqual(['20260315', '20260316', '20260317', '20260318']);
        expect(result.failedDates).toEqual(['20260316', '20260318']);
    });
});
