import type { Scores } from '../../types';

/**
 * Pure rules for the squares pool page (board first, Kevin 2026-11-16).
 * Kept apart from `SquaresPageParts.tsx` so that file exports components only.
 */

/** One team's points IN each quarter, or '-' where the quarter has not started. */
export type QuarterPoints = [number | '-', number | '-', number | '-', number | '-'];

/**
 * Points scored IN each quarter, for one side. Moved here unchanged from the
 * inline table on `PoolRoute`: a finished quarter is the difference between two
 * recorded snapshots, and the quarter in play is the live score minus the last
 * snapshot. Q1 has no live fallback — that is how the table always read.
 */
export function quarterPoints(scores: Scores | null | undefined, side: 'home' | 'away'): QuarterPoints {
    if (!scores) return ['-', '-', '-', '-'];
    const { q1, half, q3, final, current } = scores;
    const period = scores.period ?? 0;
    const live = current?.[side] ?? 0;
    const q1Pts: number | '-' = q1 ? q1[side] : '-';
    const q2Pts: number | '-' = half && q1 ? half[side] - q1[side] : (period >= 2 && q1 ? live - q1[side] : '-');
    const q3Pts: number | '-' = q3 && half ? q3[side] - half[side] : (period >= 3 && half ? live - half[side] : '-');
    const q4Pts: number | '-' = final && q3 ? final[side] - q3[side] : (period >= 4 && q3 ? live - q3[side] : '-');
    return [q1Pts, q2Pts, q3Pts, q4Pts];
}

/** The status word the strip shows beside the score. */
export function gameStatusLabel(status: Scores['gameStatus']): 'LIVE' | 'FINAL' | 'PENDING' {
    if (status === 'in') return 'LIVE';
    if (status === 'post') return 'FINAL';
    return 'PENDING';
}

/** Short team label for a narrow screen: the last word ("Bills"), never cut mid-word. */
export function shortTeamName(team: string): string {
    const words = team.trim().split(/\s+/);
    return words[words.length - 1] || team;
}

/**
 * Whether the AI Commissioner shows on the squares page (Kevin, 2026-11-16):
 * players see it only when the pool has paid for it; the manager of a pool
 * that has not sees the upgrade button instead.
 *
 * The upgrade offer needs an ACTIVE pool, the same rule the Bracket page uses:
 * the server refuses an add-on checkout for a pool with no hosting purchase, so
 * a button there would only lead to an error.
 */
export function aiCommissionerView(
    billing: { status?: string; featuresUnlocked?: Record<string, boolean> } | null | undefined,
    isManager: boolean,
): 'show' | 'upsell' | 'none' {
    if (billing?.featuresUnlocked?.aiCommissioner === true) return 'show';
    if (isManager && billing?.status === 'active') return 'upsell';
    return 'none';
}
