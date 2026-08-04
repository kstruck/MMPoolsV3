/**
 * ONE label per NFL week, everywhere.
 *
 * Preseason (seasonType 1) importer weeks are OFFSET from what fans call them:
 * importer week 1 is HOF Weekend and importer week 2 is what ESPN/fans call
 * "Preseason Week 1". The week dropdown already relabeled, but every other
 * surface (chips, lock-status card, standings columns, banners) rendered the
 * RAW importer number — so one and the same slate read "Preseason Week 1" in
 * the header and "Week 2" in the sidebar, and a member picking "the first
 * preseason week" landed on the second slate. This module is the single
 * source for both the long and chip forms; render nothing else.
 */

/** Long form: "HOF Weekend", "Preseason Week 2", "Week 14". */
export function nflWeekLabel(seasonType: number | undefined, week: number): string {
    if (Number(seasonType) === 1) {
        return week === 1 ? 'HOF Weekend' : `Preseason Week ${week - 1}`;
    }
    return `Week ${week}`;
}

/** Chip form for tight UI: "HOF", "P2", "W14". */
export function nflWeekChip(seasonType: number | undefined, week: number): string {
    if (Number(seasonType) === 1) {
        return week === 1 ? 'HOF' : `P${week - 1}`;
    }
    return `W${week}`;
}
