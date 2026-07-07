import { describe, it, expect } from 'vitest';
import { SCENARIOS } from './index';

// Guards the 0-entries failure class: bracketSimulator writes
// `tieBreakerPrediction: entry.tiebreakerPrediction` into addDoc, and Firestore
// rejects the whole document if any field is undefined. The runner must map the
// scenario JSONs' `tiebreakerPrediction` through (it once renamed it to
// `tiebreaker`, silently zeroing every bracket test), and the scenarios must
// keep providing it.
describe('bracket scenario data contract', () => {
    const bracketScenarios = Object.values(SCENARIOS).filter(
        (s) => s.poolType === 'BRACKET' && !s.isE2E,
    );

    it('registry contains the 8 non-E2E bracket scenarios', () => {
        expect(bracketScenarios.length).toBeGreaterThanOrEqual(8);
    });

    it('every bracket test entry carries a numeric tiebreakerPrediction', () => {
        for (const s of bracketScenarios) {
            for (const e of s.testEntries || []) {
                expect(
                    typeof e.tiebreakerPrediction,
                    `${s.id} / ${e.userName} tiebreakerPrediction`,
                ).toBe('number');
            }
        }
    });

    it('every bracket test entry has picks', () => {
        for (const s of bracketScenarios) {
            for (const e of s.testEntries || []) {
                expect(e.picks && Object.keys(e.picks).length, `${s.id} / ${e.userName} picks`).toBeTruthy();
            }
        }
    });
});
