/**
 * PLAN-AUDIT-SCAN-BOUNDS — pure predicates for the scheduled-scan guards, kept
 * out of the job bodies so they are unit-testable.
 */

const DEAD_PRE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 1.2: a pool syncGameStatus should stop touching entirely — CLOSED, or a
 * 'pre' game whose start time passed more than 7 days ago (never went live).
 * Missing/unparseable startTime returns false: never skip on absent data.
 */
export function isDeadSyncPool(
    pool: { status?: string; scores?: { gameStatus?: string; startTime?: string } },
    nowMs: number,
): boolean {
    if (pool.status === "CLOSED") return true;
    if (pool.scores?.gameStatus === "pre" && pool.scores.startTime) {
        const start = new Date(pool.scores.startTime).getTime();
        if (Number.isFinite(start) && start > 0 && nowMs - start > DEAD_PRE_MS) return true;
    }
    return false;
}

/**
 * 1.3: checkPlayoffScores only has work during the NFL postseason. Window is
 * Jan 1 – Feb 20 (UTC), every year; `forceActive` (from
 * system/config.playoffSync) overrides for an unusual schedule. The config
 * read is fail-open to the window: in-window a config error still syncs.
 */
export function playoffSyncInWindow(now: Date, forceActive?: boolean): boolean {
    if (forceActive === true) return true;
    const month = now.getUTCMonth(); // 0 = January
    return month === 0 || (month === 1 && now.getUTCDate() <= 20);
}
