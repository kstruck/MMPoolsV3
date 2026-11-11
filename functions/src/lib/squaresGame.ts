/**
 * "Has this squares pool's game started?" — ONE answer for the lock, unlock and
 * draw paths (PLAN-SQUARES-REOPEN D9). PURE.
 *
 * The numbers on a grid are only fair while nobody can act on the score. Once
 * the game is under way they must not be re-drawn and the grid must not be
 * reopened, so every path that could do either asks this first.
 */

export interface GameClockPool {
    /**
     * The linked game's kickoff, in ms. Server-owned on a squares pool
     * (firestore.rules, squaresServerFieldsUnchanged) — unlike `scores`, which
     * a commissioner can still type under Manual Score Override. So it is the
     * one kickoff a forged "not started yet" score cannot move (qodo #765, 2).
     */
    gameTime?: unknown;
    scores?: {
        gameStatus?: string | null;
        startTime?: string | number | null;
        current?: { home?: number; away?: number } | null;
        q1?: unknown; half?: unknown; q3?: unknown; final?: unknown;
    } | null;
}

const kickoffMs = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const ms = typeof v === 'number' ? v : typeof v === 'string' ? new Date(v).getTime() : NaN;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
};

/**
 * Do the scores show the game being PLAYED — under way, over, a period
 * recorded, or points on the board? (A kickoff time alone does not count.)
 */
export function squaresScoresShowPlay(scores: GameClockPool['scores']): boolean {
    const s = scores;
    if (!s) return false;
    if (s.gameStatus === 'in' || s.gameStatus === 'post') return true;
    if (s.q1 || s.half || s.q3 || s.final) return true;
    return (Number(s.current?.home) || 0) > 0 || (Number(s.current?.away) || 0) > 0;
}

/**
 * Started when ANY of these holds:
 *   - the feed says the game is in progress or over;
 *   - a period score has been recorded (manual scoring has no feed status);
 *   - points are on the board;
 *   - the scheduled kickoff has passed — by the scores' start time OR by the
 *     pool's server-owned `gameTime`. The feed can lag kickoff by a minute or
 *     more, and that minute is exactly when a re-draw would be worth having.
 *     `gameTime` is read because the scores are not proof: under Manual Score
 *     Override a commissioner can type "not started" after kickoff.
 */
export function squaresGameHasStarted(pool: GameClockPool, nowMs: number): boolean {
    if (squaresScoresShowPlay(pool.scores)) return true;
    for (const k of [pool.scores?.startTime, pool.gameTime]) {
        const kickoff = kickoffMs(k);
        if (kickoff !== null && kickoff <= nowMs) return true;
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
