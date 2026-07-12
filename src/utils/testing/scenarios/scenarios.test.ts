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
        // "g1" is the first game OF THE PICK'S WEEK (per-week ordinals — Codex
        // R1#5), never a global index: the original global-index check here
        // falsely rejected every multi-week fixture.
        for (const s of nflScenarios.filter((x) => x.poolType === 'NFL_PICKEM')) {
            const games = s.nflGames ?? [];
            for (const e of s.testEntries ?? []) {
                for (const [week, weekPicks] of Object.entries(e.pickemPicks ?? {})) {
                    const weekGames = games.filter((g) => g.week === Number(week));
                    for (const [key, team] of Object.entries(weekPicks)) {
                        const idx = parseInt(key.replace(/^g/, ''), 10) - 1;
                        const g = weekGames[idx];
                        expect(g, `${s.id}/${e.userName} wk${week} pick key ${key}`).toBeTruthy();
                        expect([g.home, g.away], `${s.id}/${e.userName} wk${week} ${key} team ${team}`).toContain(team);
                    }
                }
            }
        }
    });

    it('assertions with userName target an entry that exists (direct-write or lifecycle-op)', () => {
        for (const s of nflScenarios) {
            const names = new Set((s.testEntries ?? []).map((e) => e.userName));
            // Real-path scenarios create entries/rejections via lifecycleOps —
            // those names are valid assertion targets too.
            for (const op of s.lifecycleOps ?? []) {
                if ('userName' in op && op.userName) names.add(op.userName);
                if ('userNames' in op) op.userNames.forEach((n) => names.add(n));
            }
            for (const a of s.assertions) {
                if (a.userName) {
                    expect(names.has(a.userName), `${s.id} assertion targets "${a.userName}"`).toBe(true);
                }
            }
        }
    });

    it('lifecycleOps scenarios never mix scoreWeeks in; expectError values are non-empty', () => {
        for (const s of nflScenarios.filter((x) => (x.lifecycleOps ?? []).length > 0)) {
            expect(s.scoreWeeks ?? [], `${s.id} lifecycleOps + scoreWeeks are mutually exclusive`).toEqual([]);
            for (const op of s.lifecycleOps ?? []) {
                if ('expectError' in op && op.expectError !== undefined) {
                    expect(op.expectError.length, `${s.id} empty expectError`).toBeGreaterThan(0);
                }
            }
        }
    });
});
