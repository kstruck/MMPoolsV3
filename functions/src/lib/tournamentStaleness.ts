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
 * A tournament is stale once its season year's June has fully ended — i.e. from
 * July 1 00:00 UTC onwards.
 *
 * Every NCAA and conference tournament for a given `seasonYear` has concluded
 * well before July: conference tournaments end mid-March, the NCAA final is the
 * first week of April. That makes this a deliberately generous cutoff — roughly
 * a three-month margin past the last possible game.
 *
 * Month index 6 = July, day 1. Expressed as the START of July rather than the
 * start of June 30, so that "the whole of June is still fresh" is literally what
 * the code says; the previous form made June 30 stale from midnight, which
 * contradicted the "end of June" wording.
 */
export function staleAfterMs(seasonYear: number): number {
    return Date.UTC(seasonYear, 6, 1);
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
    // `>=` so the boundary itself (July 1 00:00 UTC) counts as stale.
    return nowMs >= staleAfterMs(year);
}
