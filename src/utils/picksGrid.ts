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

/**
 * The cell rule for SURVIVOR and MARGIN — one pick per week, keyed by the week
 * number rather than by a game id.
 *
 * 🛑 THE ADMITTING FIELD IS `weekRevealed`, NOT `revealedGameIds`.
 *
 * That is the whole difference from `picksGridCell`, and getting it wrong is a
 * leak rather than a display bug. `getPoolPicks` adds the week's own key to its
 * allowlist **only when the entire week is revealed**
 * (`functions/src/nflPickReveal.ts` — `if (reveal.weekRevealed) allowedKeys.add(...)`),
 * because a weekly pick has no single game to attach to and one kicked-off game
 * must not expose it.
 *
 * ⚠️ `reveal` MUST be the response for THIS week. The multi-week grid holds one
 * per column; passing the selected week's response for every column renders an
 * unrevealed week's pick using a revealed week's flag. (codex r2 on the plan.)
 * `undefined` — not fetched, or refused — is HIDDEN, which is the honest answer.
 */
export function weeklyPickCell(args: {
    week: number;
    entry: PicksGridEntry | undefined;
    /** The viewer's own row: sourced from their own entry, never gated. */
    isOwnRow: boolean;
    /** `getPoolPicks` for THIS week. */
    reveal: { week: number; weekRevealed?: boolean } | undefined;
}): PicksGridCell {
    const { week, entry, isOwnRow, reveal } = args;

    // A response for a DIFFERENT week can never admit this one, whatever it says.
    const revealed = reveal?.week === week && reveal?.weekRevealed === true;
    if (!isOwnRow && !revealed) return { kind: 'HIDDEN' };

    const team = entry?.picks?.[String(week)];
    if (!team) return { kind: 'NO_PICK' };
    // No grade: a Survivor/Margin outcome is the scorer's, not this module's.
    return { kind: 'PICK', team, result: null };
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
 * Three outcomes, and they are three because collapsing any two of them is a
 * lie in the same way the cell states above are:
 *
 *   null    nothing is recorded for this game    → the grid prints "—"
 *   TIE     the pool is split exactly evenly     → the grid prints "Split 50%"
 *   LEAD    one side leads                       → the grid prints "CAR 75%"
 *
 * 🛑 A TIE USED TO RETURN `null` AND SO RENDERED AS "—", which is the SAME
 * GLYPH the legend spends on "the pick IS revealed and that player made none".
 * One symbol, two meanings, in one table. Measured live on 2026-08-21: a
 * four-player pool showed a blank Majority for CAR/JAX, BUF/CLE, NYG/MIA and
 * PHI/NE, all of them exact 2–2 splits, and it reads as the row failing to
 * load. An even split is a real, interesting answer about the pool and it is
 * now said out loud.
 *
 * An even split is still never handed to whichever side the comparison happens
 * to favour; `>` alone would print the home team as the majority of a 50/50
 * pool.
 */
export type MajorityCell =
    | { kind: 'LEAD'; team: string; pct: number }
    | { kind: 'TIE'; pct: number };

export function majorityFor(
    split: ConsensusSplit | undefined,
    game: NFLGame,
): MajorityCell | null {
    if (!split || typeof split.total !== 'number' || split.total <= 0) return null;
    const { awayPct, homePct } = split;
    if (typeof awayPct !== 'number' || typeof homePct !== 'number') return null;
    if (awayPct === homePct) return { kind: 'TIE', pct: awayPct };
    return awayPct > homePct
        ? { kind: 'LEAD', team: game.awayTeam.abbreviation, pct: awayPct }
        : { kind: 'LEAD', team: game.homeTeam.abbreviation, pct: homePct };
}
