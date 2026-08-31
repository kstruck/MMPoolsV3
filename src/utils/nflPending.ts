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

/**
 * The week a pool's surfaces should DEFAULT to: the first week of the pool's
 * season type that still has a game left to play, or the last week once the whole
 * slate is FINAL. `null` when no games for this season type are loaded — callers
 * fall back to their date estimate.
 *
 * The dashboard used to derive this from the calendar alone
 * (`ceil((now - seasonStart) / 7d)`), which only ticks on 7-day boundaries: HOF
 * Weekend (one game, Aug 6) stayed "current" until Aug 13, so members landed on a
 * finished, locked slate for the whole first week of real picking. The schedule is
 * the truth; the calendar is only the pre-load fallback.
 */
export function currentSlateWeek(games: NFLGame[], pool: any): number | null {
    const seasonType = poolSeasonType(pool);
    const slate = games.filter(g => Number(g.seasonType) === seasonType);
    if (slate.length === 0) return null;
    const weeks = [...new Set(slate.map(g => Number(g.week)))].sort((a, b) => a - b);
    // CANCELLED is terminal, same as FINAL — the manager's "week is done" count
    // (NFLManagerView) treats them alike, and a cancelled game grades VOID rather
    // than waiting to be played. Counting it as open would park the dashboard on a
    // week nobody can enter, which is the very defect this function exists to fix.
    const playable = (g: NFLGame) => g.status !== 'FINAL' && g.status !== 'CANCELLED';
    const open = weeks.find(w => slate.some(g => Number(g.week) === w && playable(g)));
    return open ?? weeks[weeks.length - 1];
}

/**
 * Every week number this pool's season type actually has a game in, ascending.
 *
 * The season-grid pages need a column set, and the obvious `1..18` is wrong
 * twice: a preseason pool runs 1..4, and hardcoding a regular-season length
 * bakes in a number the schedule is the only authority on. Derived from the
 * loaded slate instead — the same source `currentSlateWeek` trusts.
 *
 * Empty while the schedule is still loading; callers render an empty grid, not
 * a fabricated one.
 */
export function poolSeasonWeeks(games: NFLGame[], pool: any): number[] {
    const seasonType = poolSeasonType(pool);
    const weeks = new Set<number>();
    for (const g of games) {
        if (Number(g.seasonType) === seasonType) weeks.add(Number(g.week));
    }
    return [...weeks].filter(w => Number.isFinite(w)).sort((a, b) => a - b);
}

export function isWeekComplete(
    poolType: string,
    entry: any,
    weekGames: NFLGame[],
    week: number,
    /**
     * Games already closed to this member, if the caller knows. A closed game
     * they never picked can no longer BE picked, so counting it as outstanding
     * leaves the week permanently incomplete — "Make Picks" forever on a sheet
     * with nothing left to do (qodo #10). Omitted means "none closed", which is
     * the old reading.
     *
     * This is the same rule `canSubmit` applies on the sheet: what matters is
     * whether anything the member can still act on is unanswered.
     */
    isGameClosed?: (game: NFLGame) => boolean,
): boolean {
    if (!entry) return false;
    if (poolType === 'NFL_PICKEM') {
        if (weekGames.length === 0) return false;
        const answered = weekGames.filter(g => !!entry.picks?.[g.id]).length;
        // A member who answered NOTHING all week did not complete it, however
        // many games have since closed. Without this the exemption below turns
        // a wholly missed slate into "picks submitted" the moment the last game
        // kicks off — a false claim, and the opposite of what the member needs
        // to see (codex R4). The exemption exists for a PARTIALLY answered
        // week, which is the case it was written for.
        if (answered === 0) return false;
        return weekGames.every(g => !!entry.picks?.[g.id] || (isGameClosed?.(g) ?? false));
    }
    // Survivor / Margin: one pick per week keyed by week number
    return !!entry.picks?.[week];
}

/**
 * Is this week past the point where the member can still change a pick?
 * PER_GAME (Pick'em default): the last game's lock — earlier games are already
 * frozen individually, but the sheet is still editable. WEEKLY (Survivor,
 * Margin, confidence Pick'em): the first game's lock.
 *
 * `weekLockOverrideMs` is a commissioner's `extendWeekDeadline` for this week
 * (`settings.weekLockOverrides[week]`, epoch ms). The server applies it with
 * Math.max on Pick'em (`functions/src/lib/effectiveLock.ts`), so a client that
 * ignored it would call the week locked — and disable the picks button — while
 * the server still accepts submissions. Hard-lock pools (Survivor/Margin) drop
 * overrides server-side, so callers pass it only for Pick'em. (codex on item 8.)
 */
export function isWeekLockedNow(
    weekGames: NFLGame[],
    lockBufferMinutes: number,
    lockMode: 'WEEKLY' | 'PER_GAME' = 'WEEKLY',
    weekLockOverrideMs?: number,
): boolean {
    if (weekGames.length === 0) return false;
    const bufferMs = lockBufferMinutes * 60 * 1000;
    const kickoffs = weekGames.map(g => g.startTime);
    const reference = lockMode === 'PER_GAME' ? Math.max(...kickoffs) : Math.min(...kickoffs);
    const base = reference - bufferMs;
    const deadline = typeof weekLockOverrideMs === 'number' ? Math.max(base, weekLockOverrideMs) : base;
    return serverNow() >= deadline;
}

/**
 * `lockMode` decides WHICH kickoff closes the week, and defaulting it to
 * 'WEEKLY' was how this function said "missed" on a per-game week a member
 * could still pick — the Thursday game starting does not close Sunday. Callers
 * that know the pool should pass `nflLockMode(pool.type, pool.settings)`; the
 * default keeps the old reading for any that do not.
 */
export function getWeekStatus(
    poolType: string,
    entry: any,
    weekGames: NFLGame[],
    week: number,
    lockBufferMinutes: number,
    lockMode: 'WEEKLY' | 'PER_GAME' = 'WEEKLY',
    /**
     * A commissioner's `extendWeekDeadline` for this week. Without it an
     * extended Pick'em week reads as missed at its ORIGINAL deadline while the
     * server and the pick sheet both still accept picks (qodo #9) — the same
     * half-fix this function had for `lockMode`.
     */
    weekLockOverrideMs?: number,
): WeekStatus {
    if (weekGames.length === 0) return 'no-games';
    const bufferMs = lockBufferMinutes * 60 * 1000;
    const deadline = weekDeadline(weekGames, lockBufferMinutes, lockMode, weekLockOverrideMs)!;
    // A game is closed to this member once its OWN lock has passed — per game,
    // or all together on a weekly pool.
    const gameClosed = (g: NFLGame) => lockMode === 'WEEKLY'
        ? serverNow() >= deadline
        : serverNow() >= Math.max(g.startTime - bufferMs, weekLockOverrideMs ?? Number.NEGATIVE_INFINITY);
    const complete = isWeekComplete(poolType, entry, weekGames, week, gameClosed);
    const weekStarted = serverNow() >= deadline;

    if (!weekStarted) {
        // Week is upcoming; "due" once it's the nearest unpicked week, "future" otherwise —
        // caller decides that distinction; from pure data we only know picked/not
        return complete ? 'complete' : 'due';
    }
    return complete ? 'locked-complete' : 'missed';
}

/**
 * The moment this week closes, or null.
 *
 * Same rule as `getWeekStatus`: on a PER_GAME pool the week is not closed until
 * its LAST game has started, so showing the earliest kickoff would put a
 * deadline in front of a member hours before anything of theirs expires.
 */
export function weekDeadline(
    weekGames: NFLGame[],
    lockBufferMinutes: number,
    lockMode: 'WEEKLY' | 'PER_GAME' = 'WEEKLY',
    /** A commissioner's extension, which may only ever move the deadline LATER. */
    weekLockOverrideMs?: number,
): number | null {
    if (weekGames.length === 0) return null;
    const kickoffs = weekGames.map(g => g.startTime);
    const reference = lockMode === 'PER_GAME' ? Math.max(...kickoffs) : Math.min(...kickoffs);
    const base = reference - lockBufferMinutes * 60 * 1000;
    return typeof weekLockOverrideMs === 'number' ? Math.max(base, weekLockOverrideMs) : base;
}

/**
 * The clause the WeekChecklist prints after "<Week> picks are/aren't in".
 *
 * ⚠️ THE SAME TIMESTAMP MEANS TWO DIFFERENT THINGS, and printing "locks <ts>"
 * for both is the misleading half. `weekDeadline` returns the EARLIEST kickoff
 * on a WEEKLY pool — one deadline, the whole sheet shuts at it — and the LATEST
 * on a PER_GAME one, where it is only the moment the last game closes and every
 * earlier pick froze at its own kickoff. A member reading "Preseason Week 2
 * picks are in — locks Sun, Aug 23 · 5:55 PM" on a per-game pool believes
 * nothing shuts until Sunday evening; their Friday pick is frozen on Friday.
 * (Kevin's live test, 2026-08-21.)
 *
 * The same distinction NFLPoolDashboard's Lock Status card already draws with
 * "Next pick locks" vs "Locks in" — one rule, two surfaces, `shared/nflLockMode`
 * is the single definition of which mode a pool plays.
 */
export function weekLockCaption(
    lockMode: 'WEEKLY' | 'PER_GAME',
    deadlineText: string,
    /**
     * Whether a commissioner has extended THIS week (`settings.weekLockOverrides`).
     *
     * ⚠️ AN EXTENSION BREAKS THE PLAIN PER-GAME SENTENCE, which is why this
     * argument exists. `gameLockAt` is `Math.max(kickoff - buffer, override)`, so
     * an extension applies to EVERY game and every kickoff it sits past stops
     * being that game's lock — those picks all close together at the extension
     * instead. Saying "each pick locks at its kickoff" on such a week is the same
     * class of falsehood this function was written to remove. (codex r1.)
     */
    hasWeekExtension = false,
): string {
    if (lockMode !== 'PER_GAME') return `locks ${deadlineText}`;
    return hasWeekExtension
        ? `each pick locks at its kickoff or the extended deadline, whichever is later — last ${deadlineText}`
        : `each pick locks at its kickoff — last ${deadlineText}`;
}
