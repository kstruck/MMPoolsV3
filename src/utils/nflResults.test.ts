import { describe, it, expect } from 'vitest';
import {
    weeklyMaxPoints,
    weekValueFor,
    rankByWeek,
    rankBySeason,
    scoredWeekCount,
    unwinnableGameIds,
    type ResultsRow,
    type ScoreableGame,
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

    it('is the top-K weights of an N-game slate for EVERY N and K — so the slate size need not be passed', () => {
        // codex r4 argued that on a confidence week with unwinnable games the
        // caller must pass the ORIGINAL slate size too, because the legal weight
        // range is [17-N..16]. It is not needed, and the reason is that the TOP
        // of that range is 16 whatever N is: the best case always puts the K
        // highest weights on the K winnable games, so the sum depends on K
        // alone. Its worked example ("a 16-game slate with one void displays 135
        // even though the top 15 valid weights total 120") summed the BOTTOM 15
        // weights, 1..15; the top 15 are 2..16 and total 135 — which is what
        // this function returns. Brute-forced here so the rejection is runnable
        // rather than an argument.
        for (let n = 1; n <= 16; n++) {
            const weights: number[] = [];
            for (let w = 17 - n; w <= 16; w++) weights.push(w);
            weights.sort((a, b) => b - a);
            for (let k = 0; k <= n; k++) {
                const topK = weights.slice(0, k).reduce((a, b) => a + b, 0);
                expect(weeklyMaxPoints(k, true), `N=${n} K=${k}`).toBe(topK);
            }
        }
    });

    it('falls when a game becomes unwinnable — the same fall for every player', () => {
        // Max is max POSSIBLE, not max STILL ATTAINABLE: it never moves because
        // one player's picks went wrong, but it DOES step down when a game is
        // cancelled or pushes, because those points stopped existing for
        // everybody at once. Pinned because the doc comment once claimed the
        // opposite. (qodo on PR #427.)
        expect(weeklyMaxPoints(16, false)).toBe(16);
        expect(weeklyMaxPoints(15, false)).toBe(15);   // one game cancelled
        expect(weeklyMaxPoints(16, true)).toBe(136);
        expect(weeklyMaxPoints(15, true)).toBe(135);   // the lowest weight, 1, drops out
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

/**
 * These mirror `gradePickemGames` in the scorer. If the two ever disagree, the
 * Max column claims a total the scorer cannot award — which is exactly the
 * defect codex found on the first version of this page.
 */
describe('unwinnableGameIds', () => {
    const g = (over: Partial<ScoreableGame> & { id: string }): ScoreableGame => over;

    it('counts a CANCELLED game as unwinnable whatever its scores say', () => {
        expect([...unwinnableGameIds([g({ id: 'x', status: 'CANCELLED', scores: { home: 21, away: 7 } })], false)])
            .toEqual(['x']);
    });

    it('counts a straight-up tie as unwinnable on a non-ATS pool', () => {
        const games = [g({ id: 'tie', status: 'FINAL', scores: { home: 17, away: 17 } })];
        expect(unwinnableGameIds(games, false).has('tie')).toBe(true);
    });

    it('counts an EXACT spread cover as unwinnable on an ATS pool', () => {
        // spread is relative to home: home 20 + (-3) === away 17 → PUSH.
        const push = g({ id: 'p', status: 'FINAL', scores: { home: 20, away: 17 }, spread: { value: -3 } });
        const cover = g({ id: 'c', status: 'FINAL', scores: { home: 24, away: 17 }, spread: { value: -3 } });
        const ids = unwinnableGameIds([push, cover], true);
        expect(ids.has('p')).toBe(true);
        expect(ids.has('c')).toBe(false);
    });

    it('grades an ATS pool STRAIGHT UP when the game carries no spread, like the scorer does', () => {
        const tie = g({ id: 't', status: 'FINAL', scores: { home: 17, away: 17 } });
        expect(unwinnableGameIds([tie], true).has('t')).toBe(true);
    });

    it('does NOT call an unplayed game unwinnable — Max is max POSSIBLE', () => {
        const games = [
            g({ id: 'sched', status: 'SCHEDULED' }),
            g({ id: 'live', status: 'IN_PROGRESS', scores: { home: 7, away: 7 } }),
        ];
        expect(unwinnableGameIds(games, false).size).toBe(0);
    });

    it('does NOT call a FINAL with no reported scores unwinnable — the feed may still be repaired', () => {
        const games = [
            g({ id: 'broken', status: 'FINAL' }),
            g({ id: 'half', status: 'FINAL', scores: { home: 10 } }),
        ];
        expect(unwinnableGameIds(games, false).size).toBe(0);
    });

    it('shrinks the Max denominator, confidence mode included', () => {
        const slate: ScoreableGame[] = [
            g({ id: '1', status: 'FINAL', scores: { home: 10, away: 3 } }),
            g({ id: '2', status: 'CANCELLED' }),
            g({ id: '3', status: 'FINAL', scores: { home: 14, away: 14 } }),
            g({ id: '4', status: 'SCHEDULED' }),
        ];
        const scoreable = slate.length - unwinnableGameIds(slate, false).size;
        expect(scoreable).toBe(2);
        expect(weeklyMaxPoints(scoreable, false)).toBe(2);
        // Best case in confidence mode is the two HIGHEST weights, 16 + 15.
        expect(weeklyMaxPoints(scoreable, true)).toBe(31);
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
