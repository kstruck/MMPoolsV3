import type { NFLGame } from '../types';
import type { PicksGridCell } from './picksGrid';
import { gradePick, hasReportedScores } from './pickemResult';

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
 * from Max. A FINAL the feed reported no scores for stays ungraded (`null`), is
 * left out of W-L, and STAYS in Max: the scorer will grade it when scores arrive,
 * so it is still winnable, and Max is an upper bound that must not dip below what
 * that grade could give.
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

/**
 * Could a pick on this game that we cannot see still earn a point?
 *
 *   CANCELLED                  never — grades VOID.
 *   FINAL, a tie / exact cover never — grades PUSH. A PUSH does not depend on
 *                              which side was picked, so any pick answers it.
 *   FINAL, no reported scores  YES — it is not settled: the scorer grades it
 *                              once scores arrive, and showing Max below what
 *                              that grade could give would break the upper
 *                              bound (qodo #2 on #722 asked for a number that
 *                              is not 0; the honest one is the upper bound).
 *   FINAL, otherwise           yes — the hidden pick may already be a win, and
 *                              dropping it could put Max BELOW the real score
 *                              (the reveal can lag the game document).
 *   not over yet               yes.
 */
function hiddenGameCanPay(game: NFLGame, pickMode: string | undefined): boolean {
    if (game.status === 'CANCELLED') return false;
    if (game.status !== 'FINAL') return true;
    if (!hasReportedScores(game)) return true;
    // PUSH is independent of the side picked, so either team answers it; a real
    // team is needed because `gradePick` returns null for an empty pick.
    return gradePick(game, game.homeTeam.abbreviation, pickMode) !== 'PUSH';
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
    /** `settings.pickMode` — the same value `picksGridCell` grades with. */
    pickMode?: string;
}): GridRowTally {
    const { weekGames, cells, setCount, revealMode, isOwnRow, confidenceMode, pickMode } = args;

    let wins = 0;
    let losses = 0;
    let earned = 0;
    let remaining = 0;
    let revealedPicks = 0;
    let hiddenCells = 0;
    // Hidden games that can still pay (`hiddenGameCanPay`): a pick on one that
    // can never score is counted in Set but must not be priced in Max.
    let hiddenLive = 0;
    let weightMissing = false;

    for (const game of weekGames) {
        const cell = cells.get(game.id);
        if (!cell) continue;
        if (cell.kind === 'HIDDEN') {
            hiddenCells++;
            if (hiddenGameCanPay(game, pickMode)) hiddenLive++;
            continue;
        }
        if (cell.kind !== 'PICK') continue;
        revealedPicks++;

        const weight = confidenceMode ? cell.confidence : 1;
        if (cell.result === 'W') {
            wins++;
            if (typeof weight === 'number') earned += weight; else weightMissing = true;
        } else if (cell.result === 'L') {
            losses++;
        } else if (cell.result === null && game.status !== 'CANCELLED' && (game.status !== 'FINAL' || !hasReportedScores(game))) {
            // Ungraded: not over yet, OR a FINAL the feed reported no scores for —
            // the scorer will grade that one when scores arrive, so it is still
            // winnable and must stay in Max (an upper bound).
            if (typeof weight === 'number') remaining += weight; else weightMissing = true;
        }
        // PUSH and VOID: neither earned nor winnable.
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
        // How many saved picks are still unrevealed. A stale count smaller than
        // what is already revealed clamps to 0.
        const unrevealed = Math.max(0, setCount - revealedPicks);
        // Confidence weights are unknowable until revealed — but only matter if
        // there IS an unrevealed pick: when the server's count equals the revealed
        // picks (including a player with none), nothing hidden can contribute and
        // the answer is exact.
        //
        // Only a pick on a hidden game that CAN still pay has a weight that
        // matters. A pick on a cancelled game grades VOID whatever its weight, so
        // when no hidden game can pay the answer is exact (qodo #2 on #721).
        if (confidenceMode && Math.min(unrevealed, hiddenLive) > 0) return { ...tally, max: null, maxUnknown: 'WEIGHTS_HIDDEN' };
        // Standard scoring prices every unrevealed pick at exactly 1. They cannot
        // outnumber the hidden games that can still pay, which keeps Max an UPPER
        // bound even though we cannot see which hidden game a pick sits on.
        //
        // ⚠️ A hidden FINAL game stays counted ON PURPOSE (codex asked to drop
        // it): a reveal can lag the game document, and that hidden pick may
        // already be a win. Dropping it could put Max BELOW the player's real
        // score; counting it can only leave Max one point high until the reveal
        // lands, which an upper bound is allowed to be.
        if (!confidenceMode) remaining += Math.min(unrevealed, hiddenLive);
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
