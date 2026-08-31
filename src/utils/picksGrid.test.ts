import { describe, it, expect } from 'vitest';
import { picksGridCell, weeklyPickCell, majorityFor } from './picksGrid';
import type { NFLGame } from '../types';

/**
 * The Current Picks grid's only real risk is showing a pick to someone the
 * server did not reveal it to, or telling a commissioner "no pick" about a pick
 * that is merely still hidden. Both are cell-rule bugs, so the cell rule is
 * pinned here rather than grepped for in the component.
 */

const game = (over: Partial<NFLGame> & { id: string }): NFLGame => ({
    espnGameId: over.id,
    week: 1,
    season: '2026',
    seasonType: 2,
    homeTeam: { id: 'h', name: 'Home', abbreviation: 'ARI' },
    awayTeam: { id: 'a', name: 'Away', abbreviation: 'CAR' },
    startTime: 1_000,
    status: 'SCHEDULED',
    ...over,
} as NFLGame);

const G1 = game({ id: 'g1' });
const G2 = game({ id: 'g2' });

describe('picksGridCell — the reveal boundary is the SERVER\'s allowlist', () => {
    it('an unrevealed game is HIDDEN even when a pick is somehow in hand', () => {
        // Defence in depth. `getPoolPicks` should never hand back an unrevealed
        // pick, but if a future edit widened it, this cell still refuses.
        expect(picksGridCell({
            game: G1,
            entry: { picks: { g1: 'CAR' } },
            isOwnRow: false,
            revealedGameIds: new Set(['g2']),
        })).toEqual({ kind: 'HIDDEN' });
    });

    it('no reveal loaded at all hides every other row', () => {
        expect(picksGridCell({
            game: G1,
            entry: { picks: { g1: 'CAR' } },
            isOwnRow: false,
            revealedGameIds: undefined,
        })).toEqual({ kind: 'HIDDEN' });
    });

    it('the viewer\'s OWN row is never gated — their entry is the source', () => {
        expect(picksGridCell({
            game: G1,
            entry: { picks: { g1: 'CAR' } },
            isOwnRow: true,
            revealedGameIds: undefined,
        })).toEqual({ kind: 'PICK', team: 'CAR', result: null });
    });

    it('a REVEALED game with no pick is NO_PICK, and an unrevealed one never collapses into it', () => {
        const revealed = new Set(['g1']);
        expect(picksGridCell({ game: G1, entry: {}, isOwnRow: false, revealedGameIds: revealed }))
            .toEqual({ kind: 'NO_PICK' });
        expect(picksGridCell({ game: G2, entry: {}, isOwnRow: false, revealedGameIds: revealed }))
            .toEqual({ kind: 'HIDDEN' });
    });

    it('grades a concluded pick the way the scorer does, straight-up and ATS', () => {
        const finalGame = game({ id: 'g1', status: 'FINAL', scores: { home: 20, away: 24 } });
        // `spread.value` is HOME-relative, so +7 is the home team getting seven.
        const ats = { ...finalGame, spread: { value: 7, locked: true } } as NFLGame;
        const cell = (pick: string, pickMode?: string) => picksGridCell({
            game: pickMode === 'ATS' ? ats : finalGame,
            entry: { picks: { g1: pick } },
            isOwnRow: true,
            revealedGameIds: undefined,
            pickMode,
        });
        expect(cell('CAR')).toMatchObject({ result: 'W' });   // away won outright
        expect(cell('ARI')).toMatchObject({ result: 'L' });
        // Home lost by 4 while getting 7, so it covers and ATS flips both verdicts.
        expect(cell('ARI', 'ATS')).toMatchObject({ result: 'W' });
        expect(cell('CAR', 'ATS')).toMatchObject({ result: 'L' });
    });

    it('records NO result on a FINAL the feed reported no scores for', () => {
        // 🛑 REGRESSION GUARD ON THE CELL — this is the surface the defect
        // actually reached, and the one nothing pinned.
        //
        // `gradePick` used to fall straight to `scores?.home ?? 0`, so a
        // scoreless FINAL read 0-0. Straight-up that is a harmless PUSH, but in
        // ATS the spread moves the adjusted home score off the tie and the cell
        // printed a confident W or L — in this pool's colours — for a game
        // `gradePickemGames` refuses to grade at all (engine defect NFL7-3). The
        // member's grid then contradicted their own standings.
        //
        // The gate is in `gradePick` (#578) and parity with the real scorer is
        // proved in `tests/pickem-result-parity.test.ts`. Neither exercises
        // `picksGridCell`, so a future edit that re-derived the result INSIDE
        // the cell would pass both and still bring the defect back here.
        //
        // A FINAL landing before its scores is the ordinary shape of the ESPN
        // feed, not a corner case.
        const cell = (scores: unknown) => picksGridCell({
            game: {
                ...game({ id: 'g1', status: 'FINAL' }),
                scores,
                spread: { value: -6.5, locked: true },
            } as NFLGame,
            entry: { picks: { g1: 'ARI' } },
            isOwnRow: true,
            revealedGameIds: undefined,
            pickMode: 'ATS',
        });
        // Both fields must be finite. A half-written payload is what a partial
        // feed update looks like, and it is not a 24-0 game.
        expect(cell(undefined)).toEqual({ kind: 'PICK', team: 'ARI', result: null });
        expect(cell({ home: 24 })).toEqual({ kind: 'PICK', team: 'ARI', result: null });
        expect(cell({ away: 17 })).toEqual({ kind: 'PICK', team: 'ARI', result: null });

        // ⚠️ The pick is still SHOWN. "Not graded yet" is not "no pick" — the
        // team name stays, only the verdict waits.
        expect(cell(undefined).kind).toBe('PICK');

        // And a genuine 0-0 FINAL is a different fact, still graded: the check
        // is finite-ness, not truthiness. ARI is home, laying 6.5, so 0-0 is a
        // loss against the spread.
        expect(cell({ home: 0, away: 0 })).toEqual({ kind: 'PICK', team: 'ARI', result: 'L' });
    });

    it('carries the confidence weight only in confidence mode, and keeps a stored 0', () => {
        const args = {
            game: G1,
            entry: { picks: { g1: 'CAR' }, confidence: { g1: 0 } },
            isOwnRow: true,
            revealedGameIds: undefined,
        };
        expect(picksGridCell({ ...args, confidenceMode: true })).toEqual({
            kind: 'PICK', team: 'CAR', result: null, confidence: 0,
        });
        expect(picksGridCell(args)).toEqual({ kind: 'PICK', team: 'CAR', result: null });
    });

    it('omits the weight rather than inventing 0 when confidence mode stored nothing', () => {
        expect(picksGridCell({
            game: G1,
            entry: { picks: { g1: 'CAR' } },
            isOwnRow: true,
            revealedGameIds: undefined,
            confidenceMode: true,
        })).toEqual({ kind: 'PICK', team: 'CAR', result: null });
    });
});

describe('majorityFor', () => {
    it('names the side with more of the pool, either way round', () => {
        expect(majorityFor({ awayPct: 70, homePct: 30, total: 10 }, G1)).toEqual({ kind: 'LEAD', team: 'CAR', pct: 70 });
        expect(majorityFor({ awayPct: 30, homePct: 70, total: 10 }, G1)).toEqual({ kind: 'LEAD', team: 'ARI', pct: 70 });
    });

    it('an exactly even split is a TIE, not a null — it is not handed to the home team', () => {
        // 🛑 REGRESSION GUARD. A tie used to return `null`, and the grid renders
        // `null` as "—" — the same glyph its legend spends on "revealed, and
        // that player picked nothing". A 2-2 pool then read as a row that had
        // failed to load (measured live 2026-08-21 on four games of one week).
        expect(majorityFor({ awayPct: 50, homePct: 50, total: 2 }, G1)).toEqual({ kind: 'TIE', pct: 50 });
        expect(majorityFor({ awayPct: 50, homePct: 50, total: 2 }, G1)).not.toBeNull();
    });

    it('an absent, empty or malformed aggregate reports no majority rather than 0%', () => {
        expect(majorityFor(undefined, G1)).toBeNull();
        expect(majorityFor({ total: 0 }, G1)).toBeNull();
        expect(majorityFor({ awayPct: 60, total: 5 }, G1)).toBeNull();
    });
});

describe('weeklyPickCell — Survivor/Margin, where weekRevealed is the allowlist', () => {
    const entry = { picks: { '1': 'KC', '2': 'SF' } };

    it('renders a pick only when THIS week is fully revealed', () => {
        expect(weeklyPickCell({ week: 1, entry, isOwnRow: false, reveal: { week: 1, weekRevealed: true } }))
            .toEqual({ kind: 'PICK', team: 'KC', result: null });
        expect(weeklyPickCell({ week: 1, entry, isOwnRow: false, reveal: { week: 1, weekRevealed: false } }))
            .toEqual({ kind: 'HIDDEN' });
    });

    it("🛑 ANOTHER week's response can never admit this one", () => {
        // The exact multi-week leak: week 1 revealed, week 2 open. Handing the
        // week-2 column week 1's response must NOT print SF.
        expect(weeklyPickCell({ week: 2, entry, isOwnRow: false, reveal: { week: 1, weekRevealed: true } }))
            .toEqual({ kind: 'HIDDEN' });
    });

    it('a missing response is HIDDEN, never a pick and never a no-pick', () => {
        expect(weeklyPickCell({ week: 1, entry, isOwnRow: false, reveal: undefined }))
            .toEqual({ kind: 'HIDDEN' });
    });

    it("the viewer's own row is never gated", () => {
        expect(weeklyPickCell({ week: 2, entry, isOwnRow: true, reveal: undefined }))
            .toEqual({ kind: 'PICK', team: 'SF', result: null });
    });

    it('a revealed week with no pick is NO_PICK, and it never carries a grade', () => {
        expect(weeklyPickCell({ week: 3, entry, isOwnRow: false, reveal: { week: 3, weekRevealed: true } }))
            .toEqual({ kind: 'NO_PICK' });
    });
});
