import type { NFLGame } from '../types';
import type { PicksGridCell } from './picksGrid';

/**
 * W-L and Max for one row of the Current Picks grid (PLAN-SPLIT-POT-SETTLEMENT
 * Part B, Kevin 2026-10-08).
 *
 * 🛑 THIS GRADES NOTHING AND REVEALS NOTHING. Every result comes from a cell
 * `picksGridCell` already built (and `gradePick` already graded, parity-pinned to
 * the scorer by `tests/pickem-result-parity.test.ts`), and every cell is already
 * gated by the server's reveal allowlist. This module only COUNTS cells. It must
 * never read a pick the grid is not already showing — an unrevealed pick is a
 * `HIDDEN` cell, and it contributes nothing but the one fact the Set column
 * already discloses: HOW MANY picks the player has saved.
 *
 * Max = points already earned + points still winnable this week.
 *
 *   earned     standard → wins; confidence → Σ weight over won picks
 *   remaining  every pick on a game that has not concluded (its weight, or 1),
 *              PLUS, on a row whose picks are not all revealed, the picks the
 *              reveal has not shown yet (`setCount − revealed picks`, ×1 each)
 *
 * `max` is `null` — printed "?" — whenever the answer would be a guess:
 *   - another player's row and the reveal has not arrived (`COUNT_UNKNOWN`);
 *   - confidence scoring and some of their picks are unrevealed, so their
 *     weights are unknowable (`WEIGHTS_HIDDEN`);
 *   - a confidence pick with no stored weight (`WEIGHT_MISSING`).
 *
 * PUSH and VOID earn nothing and are nobody's mistake: excluded from W-L and
 * from Max. A FINAL the feed reported no scores for stays ungraded (`null`) and
 * is excluded from Max too — the scorer is still refusing to grade it, so it is
 * neither earned nor winnable.
 *
 * Pure and clock-free: no `now`, no lock arithmetic. Whether a game is over is
 * the game's own `status`, the same field `gradePick` reads.
 */

export type MaxUnknownReason = 'COUNT_UNKNOWN' | 'WEIGHTS_HIDDEN' | 'WEIGHT_MISSING';

export interface GridRowTally {
    wins: number;
    losses: number;
    earned: number;
    /** The most this row can finish the week with: `earned` + still winnable. `null` when unknowable. */
    max: number | null;
    maxUnknown?: MaxUnknownReason;
}

export function tallyGridRow(args: {
    weekGames: readonly NFLGame[];
    /** What the grid already computed for this row, keyed by game id. */
    cells: ReadonlyMap<string, PicksGridCell>;
    /** The Set column's number: the server's count, or the viewer's own. */
    setCount: number | undefined;
    /** The server's reveal mode, or `undefined` when the reveal has not arrived. */
    revealMode: 'WEEK' | 'PER_GAME' | undefined;
    isOwnRow: boolean;
    confidenceMode: boolean;
}): GridRowTally {
    const { weekGames, cells, setCount, revealMode, isOwnRow, confidenceMode } = args;

    let wins = 0;
    let losses = 0;
    let earned = 0;
    let remaining = 0;
    let revealedPicks = 0;
    let hiddenCells = 0;
    let weightMissing = false;

    for (const game of weekGames) {
        const cell = cells.get(game.id);
        if (!cell) continue;
        if (cell.kind === 'HIDDEN') { hiddenCells++; continue; }
        if (cell.kind !== 'PICK') continue;
        revealedPicks++;

        const weight = confidenceMode ? cell.confidence : 1;
        if (cell.result === 'W') {
            wins++;
            if (typeof weight === 'number') earned += weight; else weightMissing = true;
        } else if (cell.result === 'L') {
            losses++;
        } else if (cell.result === null && game.status !== 'FINAL' && game.status !== 'CANCELLED') {
            if (typeof weight === 'number') remaining += weight; else weightMissing = true;
        }
        // PUSH, VOID, and a scoreless FINAL: neither earned nor winnable.
    }

    const tally = { wins, losses, earned };

    if (weightMissing) return { ...tally, max: null, maxUnknown: 'WEIGHT_MISSING' };

    // The viewer's own row is sourced from their own entry: every cell is known.
    if (!isOwnRow && hiddenCells > 0) {
        // Not the viewer's row and some picks are unrevealed. Without the reveal
        // there is no count to price them with.
        if (revealMode === undefined || setCount === undefined) {
            return { ...tally, max: null, maxUnknown: 'COUNT_UNKNOWN' };
        }
        // Standard scoring prices every unrevealed pick at exactly 1, so the
        // answer is exact. Confidence weights are unknowable until revealed.
        if (confidenceMode) return { ...tally, max: null, maxUnknown: 'WEIGHTS_HIDDEN' };
        // A stale count smaller than what is already revealed clamps to 0.
        remaining += Math.max(0, setCount - revealedPicks);
    }

    return { ...tally, max: earned + remaining };
}

/** "3-1", or "—" while nothing on the row has been graded. */
export function formatWinLoss(t: Pick<GridRowTally, 'wins' | 'losses'>): string | null {
    return t.wins + t.losses === 0 ? null : `${t.wins}-${t.losses}`;
}

/** Why a Max cell reads "?", in the words the column's tooltip uses. */
export function maxUnknownTitle(reason: MaxUnknownReason | undefined): string {
    switch (reason) {
        case 'WEIGHTS_HIDDEN': return "Their confidence weights are not revealed yet, so the most they can score is not known";
        case 'WEIGHT_MISSING': return 'A pick on this row has no stored confidence weight';
        default: return 'Not known yet';
    }
}
