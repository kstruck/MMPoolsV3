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

// NFL season-pool scenario contract: games addressable, picks reference real
// game keys and weeks, assertions target entries that exist.
describe('NFL scenario data contract', () => {
    const nflScenarios = Object.values(SCENARIOS).filter(
        (s) => s.poolType === 'NFL_PICKEM' || s.poolType === 'NFL_SURVIVOR' || s.poolType === 'NFL_MARGIN',
    );

    it('registry contains the starter NFL scenarios', () => {
        expect(nflScenarios.length).toBeGreaterThanOrEqual(3);
    });

    it('every NFL scenario has games and scoreWeeks covered by those games', () => {
        for (const s of nflScenarios) {
            const games = s.nflGames ?? [];
            expect(games.length, `${s.id} nflGames`).toBeGreaterThan(0);
            const gameWeeks = new Set(games.map((g) => g.week));
            for (const w of s.scoreWeeks ?? []) {
                expect(gameWeeks.has(w), `${s.id} scores week ${w} with no games`).toBe(true);
            }
        }
    });

    it('pickem picks reference existing game keys; teams belong to the keyed game', () => {
        for (const s of nflScenarios.filter((x) => x.poolType === 'NFL_PICKEM')) {
            const games = s.nflGames ?? [];
            for (const e of s.testEntries ?? []) {
                for (const weekPicks of Object.values(e.pickemPicks ?? {})) {
                    for (const [key, team] of Object.entries(weekPicks)) {
                        const idx = parseInt(key.replace(/^g/, ''), 10) - 1;
                        const g = games[idx];
                        expect(g, `${s.id}/${e.userName} pick key ${key}`).toBeTruthy();
                        expect([g.home, g.away], `${s.id}/${e.userName} ${key} team ${team}`).toContain(team);
                    }
                }
            }
        }
    });

    it('assertions with userName target an entry that exists', () => {
        for (const s of nflScenarios) {
            const names = new Set((s.testEntries ?? []).map((e) => e.userName));
            for (const a of s.assertions) {
                if (a.userName) {
                    expect(names.has(a.userName), `${s.id} assertion targets "${a.userName}"`).toBe(true);
                }
            }
        }
    });
});
