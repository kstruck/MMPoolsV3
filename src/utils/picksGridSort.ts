import { weekValueFor, type ResultsRow } from './nflResults';

/**
 * Row order for the Current Picks grids (items 11/12, Kevin 2026-08-14).
 *
 * 'name'  — alphabetical, the default: a commissioner uses the grid to find one
 *           person's row, and a rank order moves that row every time a week is
 *           scored.
 * 'score' — this week's score, best first; rows without a scored value for
 *           the week sort LAST, alphabetically among themselves, so an unscored
 *           week degrades to the alphabetical grid rather than a shuffle.
 *
 * The score is `weekValueFor` — the same projection field the Results tab
 * ranks by (`weeklyPoints[week]` for Pick'em, `weeklyScores[week]` for Margin).
 * Survivor has no numeric weekly score; callers do not offer 'score' there.
 * Per ROW, never per uid — PLAN-MULTI-ENTRY §0b.
 */
export type GridSort = 'name' | 'score';

/**
 * The week value a GRID may show or sort by. A row `buildMemberStandings`
 * marks `unscored` (its own-entry fallback while the projection is unavailable)
 * may still carry stale `weeklyPoints`/`weeklyScores` from the raw entry —
 * `rankByWeek` excludes those, and so does this (codex on items 11/12).
 */
export function gridWeekValue(row: ResultsRow, week: number, isMargin: boolean): number | null {
    if (row.unscored) return null;
    return weekValueFor(row, week, isMargin);
}

export function sortGridRows<T extends ResultsRow & { userName?: string }>(
    rows: readonly T[],
    mode: GridSort,
    week: number,
    isMargin: boolean,
): T[] {
    const byName = (a: T, b: T) => (a.userName || '').localeCompare(b.userName || '');
    if (mode === 'name') return [...rows].sort(byName);
    return [...rows].sort((a, b) => {
        const va = gridWeekValue(a, week, isMargin);
        const vb = gridWeekValue(b, week, isMargin);
        if (va === null && vb === null) return byName(a, b);
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va || byName(a, b);
    });
}
