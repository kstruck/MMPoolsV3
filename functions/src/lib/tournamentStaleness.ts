/**
 * Is a tournament old enough that a 10-minute sync cannot possibly be useful?
 *
 * WHY THIS EXISTS. `scheduledBracketSync` runs every 10 minutes, year-round, and
 * only stops when NO tournament has `isFinalized === false`. But every writer in
 * the codebase sets `isFinalized: false` on create — `espnBracket.ts`,
 * `conferenceTournaments.ts` (x2) and `tournamentSim.ts` — and **nothing ever
 * sets it to `true`** except the `updateTournamentData` admin callable, i.e. a
 * human, by hand. The off-switch was designed but never wired up.
 *
 * The result, found 2026-07-21 from the Firestore usage graph: three March
 * Madness tournaments were still syncing every 10 minutes in July — re-fetching
 * ESPN, re-mapping 60 games and re-reading every entry of every linked bracket
 * pool, 144 times a day, to score zero entries. Reads had been pinned near
 * 1.4M/day since early July.
 *
 * This guard is deliberately a SKIP, not a write. Auto-setting `isFinalized`
 * would mean mutating money-adjacent tournament state from a scheduled job, and
 * a mis-detection in March would stop scoring during the actual tournament —
 * far worse than the wasted reads it would save.
 */

/**
 * Every NCAA and conference tournament for a given `seasonYear` has concluded
 * well before July: conference tournaments end mid-March, the NCAA final is the
 * first week of April. June 30 is therefore a deliberately generous cutoff —
 * roughly a three-month margin past the last possible game.
 *
 * Month index 5 = June; day 30 = the last day of June, in UTC.
 */
export function staleAfterMs(seasonYear: number): number {
    return Date.UTC(seasonYear, 5, 30);
}

/**
 * FAILS OPEN. A tournament with a missing or unparseable `seasonYear` is treated
 * as NOT stale, so it keeps syncing.
 *
 * That direction is deliberate: skipping a live tournament breaks score updates
 * during the event people are actually watching, while failing to skip a dead
 * one costs money. Given the choice, waste the reads.
 */
export function isTournamentStale(seasonYear: unknown, nowMs: number): boolean {
    const year = typeof seasonYear === "number" ? seasonYear : Number(seasonYear);
    if (!Number.isFinite(year) || year < 2000 || year > 3000) return false;
    return nowMs > staleAfterMs(year);
}
