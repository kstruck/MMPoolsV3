import { describe, it, expect } from 'vitest';
import { sortGridRows } from './picksGridSort';

const rows = [
    { id: 'c', userName: 'Cara', weeklyPoints: { 2: 12 } },
    { id: 'a', userName: 'Abe', weeklyPoints: { 2: 9 } },
    { id: 'z', userName: 'Zed' },                       // unscored this week
    { id: 'b', userName: 'Bo', weeklyPoints: { 2: 12 } },
] as any[];

describe('sortGridRows', () => {
    it("'name' is alphabetical regardless of score", () => {
        expect(sortGridRows(rows, 'name', 2, false).map(r => r.id)).toEqual(['a', 'b', 'c', 'z']);
    });
    it("'score' is best first, ties alphabetical, unscored LAST", () => {
        expect(sortGridRows(rows, 'score', 2, false).map(r => r.id)).toEqual(['b', 'c', 'a', 'z']);
    });
    it('an unscored week degrades to alphabetical, not a shuffle', () => {
        expect(sortGridRows(rows, 'score', 3, false).map(r => r.id)).toEqual(['a', 'b', 'c', 'z']);
    });
    it('Margin reads weeklyScores, negatives included', () => {
        const m = [
            { id: 'p', userName: 'P', weeklyScores: { 1: -14 } },
            { id: 'q', userName: 'Q', weeklyScores: { 1: 20 } },
        ] as any[];
        expect(sortGridRows(m, 'score', 1, true).map(r => r.id)).toEqual(['q', 'p']);
    });
    it('does not mutate the input', () => {
        const copy = [...rows];
        sortGridRows(rows, 'score', 2, false);
        expect(rows).toEqual(copy);
    });
});
