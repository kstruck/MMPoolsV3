/**
 * "Has this squares pool's game started?" — ONE answer for the lock, unlock and
 * draw paths (PLAN-SQUARES-REOPEN D9). PURE.
 *
 * The numbers on a grid are only fair while nobody can act on the score. Once
 * the game is under way they must not be re-drawn and the grid must not be
 * reopened, so every path that could do either asks this first.
 */

export interface GameClockPool {
    scores?: {
        gameStatus?: string | null;
        startTime?: string | number | null;
        current?: { home?: number; away?: number } | null;
        q1?: unknown; half?: unknown; q3?: unknown; final?: unknown;
    } | null;
}

/**
 * Started when ANY of these holds:
 *   - the feed says the game is in progress or over;
 *   - a period score has been recorded (manual scoring has no feed status);
 *   - points are on the board;
 *   - the scheduled kickoff has passed. The feed can lag kickoff by a minute or
 *     more, and that minute is exactly when a re-draw would be worth having.
 */
export function squaresGameHasStarted(pool: GameClockPool, nowMs: number): boolean {
    const s = pool.scores;
    if (!s) return false;
    if (s.gameStatus === 'in' || s.gameStatus === 'post') return true;
    if (s.q1 || s.half || s.q3 || s.final) return true;
    if ((Number(s.current?.home) || 0) > 0 || (Number(s.current?.away) || 0) > 0) return true;
    if (s.startTime !== null && s.startTime !== undefined && s.startTime !== '') {
        const kickoff = typeof s.startTime === 'number' ? s.startTime : new Date(s.startTime).getTime();
        if (Number.isFinite(kickoff) && kickoff > 0 && kickoff <= nowMs) return true;
    }
    return false;
}

/** Ten distinct digits on each side — the only shape a grid's numbers may have. */
export function isUsableAxis(axis: unknown): axis is { home: number[]; away: number[] } {
    const a = axis as { home?: unknown; away?: unknown } | null | undefined;
    const side = (v: unknown) => Array.isArray(v) && v.length === 10 && new Set(v).size === 10
        && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 9);
    return !!a && side(a.home) && side(a.away);
}
