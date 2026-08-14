import { describe, it, expect } from 'vitest';
import {
    weeklyMaxPoints,
    weekValueFor,
    rankByWeek,
    rankBySeason,
    scoredWeekCount,
    type ResultsRow,
} from './nflResults';

/**
 * The Results pages are pure display over the standings projection, so the only
 * things that can be WRONG are the arithmetic and the ordering. Those are what
 * this file pins.
 *
 * `nflResults` imports nothing, deliberately — no `serverClock` stub is needed
 * here (contrast `nflPending.test.ts`), and the ranking rules stay testable
 * without a render.
 */

const row = (over: Partial<ResultsRow> & { id: string }): ResultsRow => ({ userName: over.id, ...over });

describe('weeklyMaxPoints', () => {
    it('standard scoring is one point per game — NOT settings.pointsPerPick', () => {
        // `scorePickemEntry` hardcodes `points += 1`; `pointsPerPick` exists in
        // the create schema and NO scorer reads it. If that ever changes, this
        // is the test that should fail and send someone to the Max column.
        expect(weeklyMaxPoints(16, false)).toBe(16);
        expect(weeklyMaxPoints(13, false)).toBe(13);
    });

    it('confidence scoring sums the whole 17-N..16 weight range', () => {
        expect(weeklyMaxPoints(16, true)).toBe(136);  // 1+2+...+16
        expect(weeklyMaxPoints(13, true)).toBe(130);  // 4+5+...+16
        expect(weeklyMaxPoints(1, true)).toBe(16);    // the only weight is 16
    });

    it('matches a brute-force sum of the weight range for every legal slate size', () => {
        for (let n = 1; n <= 16; n++) {
            let sum = 0;
            for (let w = 17 - n; w <= 16; w++) sum += w;
            expect(weeklyMaxPoints(n, true)).toBe(sum);
        }
    });

    it('is 0 on an empty or nonsensical slate rather than NaN', () => {
        expect(weeklyMaxPoints(0, true)).toBe(0);
        expect(weeklyMaxPoints(0, false)).toBe(0);
        expect(weeklyMaxPoints(-3, true)).toBe(0);
    });
});

describe('weekValueFor — 0 is a played week, absent is not', () => {
    it('returns a genuine 0 rather than null', () => {
        expect(weekValueFor(row({ id: 'a', weeklyPoints: { 3: 0 } }), 3, false)).toBe(0);
        expect(weekValueFor(row({ id: 'a', weeklyScores: { 3: 0 } }), 3, true)).toBe(0);
    });

    it('returns null when the scorer has not published the week', () => {
        expect(weekValueFor(row({ id: 'a', weeklyPoints: { 2: 9 } }), 3, false)).toBeNull();
        expect(weekValueFor(row({ id: 'a' }), 3, false)).toBeNull();
    });

    it("reads weeklyScores for Margin and weeklyPoints for Pick'em, never the other", () => {
        const both = row({ id: 'a', weeklyPoints: { 1: 5 }, weeklyScores: { 1: -14 } });
        expect(weekValueFor(both, 1, false)).toBe(5);
        expect(weekValueFor(both, 1, true)).toBe(-14);
    });
});

describe('rankByWeek', () => {
    it('gives tied scores the SAME place and skips the next (1, 1, 3)', () => {
        const ranked = rankByWeek([
            row({ id: 'a', userName: 'Ann', weeklyPoints: { 1: 10 } }),
            row({ id: 'b', userName: 'Bob', weeklyPoints: { 1: 12 } }),
            row({ id: 'c', userName: 'Cat', weeklyPoints: { 1: 12 } }),
        ], 1, false);
        expect(ranked.map(r => [r.row.userName, r.place])).toEqual([
            ['Bob', 1], ['Cat', 1], ['Ann', 3],
        ]);
    });

    it('sorts a real 0 ABOVE a not-yet-scored week', () => {
        const ranked = rankByWeek([
            row({ id: 'nothing', userName: 'Nil' }),
            row({ id: 'zero', userName: 'Zed', weeklyPoints: { 1: 0 } }),
        ], 1, false);
        expect(ranked[0].row.userName).toBe('Zed');
        expect(ranked[0].place).toBe(1);
        expect(ranked[1].place).toBeNull();
    });

    it('sorts a NEGATIVE margin above a not-yet-scored week', () => {
        const ranked = rankByWeek([
            row({ id: 'nothing', userName: 'Nil' }),
            row({ id: 'neg', userName: 'Neg', weeklyScores: { 1: -14 } }),
        ], 1, true);
        expect(ranked[0].row.userName).toBe('Neg');
        expect(ranked[0].value).toBe(-14);
        expect(ranked[1].place).toBeNull();
    });

    it('puts unscored members last with no place, whatever their stale fields say', () => {
        const ranked = rankByWeek([
            row({ id: 'u', userName: 'Unscored', unscored: true, weeklyPoints: { 1: 999 } }),
            row({ id: 's', userName: 'Scored', weeklyPoints: { 1: 1 } }),
        ], 1, false);
        expect(ranked[0].row.userName).toBe('Scored');
        expect(ranked[1].place).toBeNull();
        expect(ranked[1].value).toBeNull();
    });

    it('does not mutate the array it is given', () => {
        const rows = [
            row({ id: 'a', userName: 'Ann', weeklyPoints: { 1: 1 } }),
            row({ id: 'b', userName: 'Bob', weeklyPoints: { 1: 9 } }),
        ];
        rankByWeek(rows, 1, false);
        expect(rows.map(r => r.id)).toEqual(['a', 'b']);
    });

    it('returns every row exactly once — nobody vanishes from the table', () => {
        const rows = [
            row({ id: 'a', weeklyPoints: { 1: 3 } }),
            row({ id: 'b' }),
            row({ id: 'c', unscored: true }),
            row({ id: 'd', weeklyPoints: { 1: 3 } }),
        ];
        expect(rankByWeek(rows, 1, false).map(r => r.row.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('numbers a three-way tie 1,1,1 and lands the next player at 4', () => {
        const ranked = rankByWeek([
            row({ id: 'a', userName: 'Ann', weeklyPoints: { 1: 5 } }),
            row({ id: 'b', userName: 'Bob', weeklyPoints: { 1: 5 } }),
            row({ id: 'c', userName: 'Cat', weeklyPoints: { 1: 5 } }),
            row({ id: 'd', userName: 'Dan', weeklyPoints: { 1: 2 } }),
        ], 1, false);
        expect(ranked.map(r => r.place)).toEqual([1, 1, 1, 4]);
    });
});

describe('rankBySeason', () => {
    it("ranks Pick'em on totalScore and Margin on seasonTotal, sharing tied places", () => {
        expect(rankBySeason([
            row({ id: 'a', userName: 'Ann', totalScore: 40 }),
            row({ id: 'b', userName: 'Bob', totalScore: 55 }),
            row({ id: 'c', userName: 'Cat', totalScore: 55 }),
        ], false).map(r => [r.row.userName, r.place])).toEqual([
            ['Bob', 1], ['Cat', 1], ['Ann', 3],
        ]);

        expect(rankBySeason([
            row({ id: 'a', userName: 'Ann', seasonTotal: -20 }),
            row({ id: 'b', userName: 'Bob', seasonTotal: 3 }),
        ], true).map(r => r.row.userName)).toEqual(['Bob', 'Ann']);
    });

    it('treats a season total of 0 as scored and an unscored row as unranked', () => {
        const ranked = rankBySeason([
            row({ id: 'u', userName: 'Unscored', unscored: true, totalScore: 99 }),
            row({ id: 'z', userName: 'Zero', totalScore: 0 }),
        ], false);
        expect(ranked[0].row.userName).toBe('Zero');
        expect(ranked[0].place).toBe(1);
        expect(ranked[1].place).toBeNull();
    });

    it('does NOT apply the Margin five-level cascade — a tie in the total shows as a tie', () => {
        // The standings table breaks Margin ties on negativeBurden / positiveWeeks /
        // bestWeek. This page deliberately does not: the season-prize tiebreak is a
        // money question specified in PLAN-WEEKLY-PRIZES, and a display that invents
        // an order the rules page has never published would pre-empt Kevin's ruling.
        expect(rankBySeason([
            row({ id: 'a', userName: 'Ann', seasonTotal: 10 }),
            row({ id: 'b', userName: 'Bob', seasonTotal: 10 }),
        ], true).map(r => r.place)).toEqual([1, 1]);
    });

    it('returns every row exactly once', () => {
        const rows = [
            row({ id: 'a', totalScore: 3 }),
            row({ id: 'b', unscored: true }),
            row({ id: 'c' }),
        ];
        expect(rankBySeason(rows, false).map(r => r.row.id).sort()).toEqual(['a', 'b', 'c']);
    });
});

describe('scoredWeekCount', () => {
    it('counts zero and negative weeks as played', () => {
        const r = row({ id: 'a', weeklyScores: { 1: -14, 2: 0, 4: 7 } });
        expect(scoredWeekCount(r, [1, 2, 3, 4, 5], true)).toBe(3);
    });

    it('counts only weeks the caller asked about', () => {
        const r = row({ id: 'a', weeklyScores: { 1: 3, 9: 4 } });
        expect(scoredWeekCount(r, [1, 2, 3], true)).toBe(1);
    });

    it('counts nothing for a member the scorer has never published', () => {
        expect(scoredWeekCount(row({ id: 'a' }), [1, 2, 3], true)).toBe(0);
    });
});
