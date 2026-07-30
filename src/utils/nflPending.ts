import type { NFLGame } from '../types';
import { now as serverNow } from './serverClock';

/**
 * Shared "what does this member still owe?" logic for NFL pools.
 * Drives the dashboard action-needed badges and the week checklist strip —
 * one implementation so the two can never disagree.
 */

export type WeekStatus = 'complete' | 'due' | 'missed' | 'locked-complete' | 'future' | 'no-games';

/**
 * A pool's NFL season type, coerced to a number. `seasonType` is OPTIONAL on the
 * pool document and omitting it means REGULAR season — the same `|| 2` default
 * the server contract states (`shared/schemas/nfl.ts`) and `isPreseasonPool`
 * applies (`shared/testPool.ts`). Bare `Number(pool.seasonType)` yields NaN on an
 * unset pool, and NaN equals no game's season type, so every game would filter
 * out and the pool would render as having no schedule at all.
 */
export function poolSeasonType(pool: any): number {
    return Number((pool?.seasonType as number | string | undefined) || 2);
}

/**
 * The games belonging to ONE week of ONE pool's season type.
 *
 * Manager and member surfaces both read the same pool-wide `games` array, which
 * carries every season type at once, so the week number alone is ambiguous:
 * preseason week 1 and regular-season week 1 both match `g.week === 1`. One
 * implementation so the two can never disagree — the manager's
 * "every game is final" gate for Score & Recap counts this set.
 */
export function gamesForPoolWeek(games: NFLGame[], pool: any, week: number): NFLGame[] {
    const seasonType = poolSeasonType(pool);
    return games.filter(g => g.week === week && Number(g.seasonType) === seasonType);
}

export function isWeekComplete(poolType: string, entry: any, weekGames: NFLGame[], week: number): boolean {
    if (!entry) return false;
    if (poolType === 'NFL_PICKEM') {
        if (weekGames.length === 0) return false;
        return weekGames.every(g => !!entry.picks?.[g.id]);
    }
    // Survivor / Margin: one pick per week keyed by week number
    return !!entry.picks?.[week];
}

export function isWeekLockedNow(weekGames: NFLGame[], lockBufferMinutes: number, lockMode: 'WEEKLY' | 'PER_GAME' = 'WEEKLY'): boolean {
    if (weekGames.length === 0) return false;
    const bufferMs = lockBufferMinutes * 60 * 1000;
    const kickoffs = weekGames.map(g => g.startTime);
    const reference = lockMode === 'PER_GAME' ? Math.max(...kickoffs) : Math.min(...kickoffs);
    return serverNow() >= (reference - bufferMs);
}

export function getWeekStatus(
    poolType: string,
    entry: any,
    weekGames: NFLGame[],
    week: number,
    lockBufferMinutes: number,
): WeekStatus {
    if (weekGames.length === 0) return 'no-games';
    const complete = isWeekComplete(poolType, entry, weekGames, week);
    const bufferMs = lockBufferMinutes * 60 * 1000;
    const earliest = Math.min(...weekGames.map(g => g.startTime));
    const weekStarted = serverNow() >= (earliest - bufferMs);

    if (!weekStarted) {
        // Week is upcoming; "due" once it's the nearest unpicked week, "future" otherwise —
        // caller decides that distinction; from pure data we only know picked/not
        return complete ? 'complete' : 'due';
    }
    return complete ? 'locked-complete' : 'missed';
}

/** Earliest kickoff of the given week's games, or null. */
export function weekDeadline(weekGames: NFLGame[], lockBufferMinutes: number): number | null {
    if (weekGames.length === 0) return null;
    return Math.min(...weekGames.map(g => g.startTime)) - lockBufferMinutes * 60 * 1000;
}
