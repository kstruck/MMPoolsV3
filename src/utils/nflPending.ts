import type { NFLGame } from '../types';
import { now as serverNow } from './serverClock';

/**
 * Shared "what does this member still owe?" logic for NFL pools.
 * Drives the dashboard action-needed badges and the week checklist strip —
 * one implementation so the two can never disagree.
 */

export type WeekStatus = 'complete' | 'due' | 'missed' | 'locked-complete' | 'future' | 'no-games';

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
