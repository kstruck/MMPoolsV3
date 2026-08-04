import { describe, it, expect } from 'vitest';
import { nflWeekLabel, nflWeekChip } from './nflWeekLabel';

describe('nflWeekLabel', () => {
    it('preseason importer week 1 is HOF Weekend, not "Preseason Week 1"', () => {
        expect(nflWeekLabel(1, 1)).toBe('HOF Weekend');
    });

    it('preseason importer week N is fan week N-1 — the off-by-one that mislabeled a live pick', () => {
        expect(nflWeekLabel(1, 2)).toBe('Preseason Week 1');
        expect(nflWeekLabel(1, 4)).toBe('Preseason Week 3');
    });

    it('regular season is unchanged raw numbering', () => {
        expect(nflWeekLabel(2, 1)).toBe('Week 1');
        expect(nflWeekLabel(2, 18)).toBe('Week 18');
    });

    it('missing seasonType is treated as regular season (server default is 2)', () => {
        expect(nflWeekLabel(undefined, 3)).toBe('Week 3');
    });

    it('string seasonType coerces like the server does', () => {
        expect(nflWeekLabel('1' as unknown as number, 2)).toBe('Preseason Week 1');
    });
});

describe('nflWeekChip', () => {
    it('mirrors the long form exactly per week', () => {
        expect(nflWeekChip(1, 1)).toBe('HOF');
        expect(nflWeekChip(1, 2)).toBe('P1');
        expect(nflWeekChip(1, 4)).toBe('P3');
        expect(nflWeekChip(2, 7)).toBe('W7');
        expect(nflWeekChip(undefined, 7)).toBe('W7');
    });
});
