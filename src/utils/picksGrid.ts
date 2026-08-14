import type { NFLGame } from '../types';
import { gradePick, type PickemResult } from './pickemResult';

/**
 * The cell rule for the Current Picks grid (Kevin's A2): players down, this
 * week's games across, each cell that player's pick.
 *
 * 🛑 THIS MODULE DECIDES NOTHING ABOUT WHO MAY SEE A PICK. The server does that
 * — `getPoolPicks` (`functions/src/nflPickReveal.ts`) assembles its response by
 * ALLOWLIST of revealed game ids, and the client is handed only what it is
 * entitled to. `revealedGameIds` below is that allowlist, passed straight
 * through. Adding a client-side reveal rule here would be a SECOND definition of
 * the boundary, which is exactly what PLAN-COMMISSIONER-BLIND-PICKS removed.
 *
 * ⚠️ Three cell states, and collapsing any two of them is a lie:
 *
 *   HIDDEN   the game is not revealed to this viewer yet   → "?"
 *   NO_PICK  the game IS revealed and they picked nothing  → "—"
 *   PICK     the revealed pick, graded if the game is over
 *
 * `HIDDEN` must not render as "—": saying "no pick" about a pick that merely is
 * not knowable yet is the same falsehood #413 took out of the standings cell.
 * The viewer's OWN row is always revealed — their own entry document is the
 * source, not the callable — so a commissioner's own picks never read "?".
 */

export type PicksGridCell =
    | { kind: 'HIDDEN' }
    | { kind: 'NO_PICK' }
    | { kind: 'PICK'; team: string; result: PickemResult; confidence?: number };

export interface PicksGridEntry {
    picks?: Record<string, string>;
    confidence?: Record<string, number>;
}

export function picksGridCell(args: {
    game: NFLGame;
    entry: PicksGridEntry | undefined;
    /** The signed-in viewer's own row: sourced from their own entry, never gated. */
    isOwnRow: boolean;
    /**
     * The server's allowlist for the week on screen. `undefined` means the
     * reveal has not arrived (or was refused) — every other row is HIDDEN, which
     * is the honest answer, not an error state.
     */
    revealedGameIds: ReadonlySet<string> | undefined;
    /** `settings.pickMode` — 'ATS' grades against the spread, as the scorer does. */
    pickMode?: string;
    /** `settings.confidenceMode` — carries the per-game weight onto the cell. */
    confidenceMode?: boolean;
}): PicksGridCell {
    const { game, entry, isOwnRow, revealedGameIds, pickMode, confidenceMode } = args;

    if (!isOwnRow && !revealedGameIds?.has(game.id)) return { kind: 'HIDDEN' };

    const team = entry?.picks?.[game.id];
    if (!team) return { kind: 'NO_PICK' };

    const weight = confidenceMode ? entry?.confidence?.[game.id] : undefined;
    return {
        kind: 'PICK',
        team,
        result: gradePick(game, team, pickMode),
        // Absent rather than 0: a confidence pool with no stored weight has not
        // told us the weight is zero, and 0 is a real (worst) weight.
        ...(typeof weight === 'number' ? { confidence: weight } : {}),
    };
}

/** One game's row in the pool consensus aggregate (`pools/{id}/consensus/{gameId}`). */
export interface ConsensusSplit {
    awayPct?: number;
    homePct?: number;
    total?: number;
}

/**
 * The grid's Majority row. Reads the SERVER aggregate the pick sheet already
 * shows — a count, never a name — so it is available before any pick is
 * revealed. Kevin's 2026-08-11 ruling (PLAN-COMMISSIONER-BLIND-PICKS Q4): the
 * live consensus is visible at all times and is never hidden.
 *
 * `null` means "no majority team", which covers two cases:
 *   - nobody has picked / the aggregate has not been written  → `total` absent or 0
 *   - the pool is split exactly down the middle               → equal percentages
 *
 * An even split is reported as such rather than handed to whichever side the
 * comparison happens to favour; `>` alone would print the home team as the
 * majority of a 50/50 pool.
 */
export function majorityFor(
    split: ConsensusSplit | undefined,
    game: NFLGame,
): { team: string; pct: number } | null {
    if (!split || typeof split.total !== 'number' || split.total <= 0) return null;
    const { awayPct, homePct } = split;
    if (typeof awayPct !== 'number' || typeof homePct !== 'number') return null;
    if (awayPct === homePct) return null;
    return awayPct > homePct
        ? { team: game.awayTeam.abbreviation, pct: awayPct }
        : { team: game.homeTeam.abbreviation, pct: homePct };
}
