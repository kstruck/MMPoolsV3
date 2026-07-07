import { describe, it, expect } from 'vitest';
import { generateEntries, generateControlEntries } from './testEntryGenerator';
import { getCorrectPicks } from './tournament2025';

// Guards the E2E winner assertion: AllChalk must never be able to exactly tie
// PerfectBracket (same picks + same tiebreaker), or the pool winner comes down
// to unstable sort order between two perfect entries.
describe('generateControlEntries', () => {
    const controls = generateControlEntries();
    const allChalk = controls.find(c => c.userName === 'AllChalk')!;
    const allUpset = controls.find(c => c.userName === 'AllUpset')!;
    const correct = getCorrectPicks();

    it('AllChalk is seed-based, not a copy of the correct results', () => {
        const wrongPicks = Object.entries(allChalk.picks)
            .filter(([slot, team]) => correct[slot] && correct[slot] !== team);
        // 2025 had real upsets, so a pure-chalk bracket must miss some games
        expect(wrongPicks.length).toBeGreaterThan(0);
    });

    it('AllChalk does not share PerfectBracket exact tiebreaker (128)', () => {
        expect(allChalk.tiebreakerPrediction).not.toBe(128);
    });

    it('AllChalk and AllUpset disagree wherever seeds differ', () => {
        const seedOf = (id: string) => {
            const m = id.match(/^[A-Za-z]+(\d+)-/);
            return m ? parseInt(m[1], 10) : 99;
        };
        for (const [slot, chalkPick] of Object.entries(allChalk.picks)) {
            const upsetPick = allUpset.picks[slot];
            if (upsetPick && seedOf(chalkPick) !== seedOf(upsetPick)) {
                expect(seedOf(chalkPick)).toBeLessThan(seedOf(upsetPick));
            }
        }
    });

    it('PerfectBracket picks every game correctly and differs from AllChalk', () => {
        const [perfect] = generateEntries(0, { includePerfectBracket: true });
        expect(perfect.userName).toBe('PerfectBracket');
        expect(perfect.picks).toEqual(correct);
        expect(perfect.picks).not.toEqual(allChalk.picks);
    });
});
