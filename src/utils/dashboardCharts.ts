/**
 * Participant dashboard chart builders.
 *
 * THE DEFECT THESE PIN (2026-09-01 external audit). Both Insights-tab charts in
 * `ParticipantDashboard.tsx` fabricated data rather than showing an empty state:
 *
 *   1. The Roster Distribution pie returned a hardcoded
 *      `[{ Active Squares: 2 }, { NFL Pools: 1 }]` whenever the real split was
 *      empty — so a brand-new user with zero pools was shown three pools they
 *      had never joined, next to a "Total Pools: 0" centre label.
 *   2. The Lifetime Winnings Trend area chart invented a six-month curve by
 *      multiplying the real total by 0.15 / 0.35 / 0.5 / 0.7, and its final
 *      point fell back to `totalWinnings || 120` — a fabricated $120 payout for
 *      anyone who had never won anything.
 *
 * The rule these functions enforce: a chart shows real data or it shows
 * nothing. Returning `[]` is the honest answer, and the caller renders guidance
 * in the chart's place.
 *
 * WHY THE TREND IS DATED ON `paidAt`. `Winner` (src/types/index.ts) carries no
 * "won at" timestamp — the only date on a win is `paidAt`, stamped when a
 * commissioner marks the payout cleared. So a genuine time series can only be
 * built from paid winners, and the chart is titled and empty-stated to say so
 * rather than implying it covers every win.
 */

/** One slice of the Roster Distribution pie. */
export interface PoolTypeSlice {
    name: string;
    value: number;
    color: string;
}

/** A win that carries a real payout date. `paidAt` is epoch milliseconds. */
export interface PaidWin {
    amount: number;
    paidAt: number;
}

/** One point on the cumulative paid-winnings area chart. */
export interface EarningsPoint {
    month: string;
    Earnings: number;
}

/** Copy shown in place of the trend chart when there is nothing real to plot. */
export interface EarningsEmptyState {
    headline: string;
    detail: string;
}

const MONTH_ABBREVIATIONS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * `Sep '25`. The year is part of the label because a lifetime trend crosses
 * seasons — the fabricated version used bare month names and silently collapsed
 * two different Septembers onto one point.
 */
function monthLabel(date: Date): string {
    return `${MONTH_ABBREVIATIONS[date.getMonth()]} '${String(date.getFullYear()).slice(-2)}`;
}

/**
 * Count the caller's pools by category. Returns `[]` when no category has a
 * member — never a placeholder slice.
 */
export function buildPoolTypeSplit(
    pools: ReadonlyArray<{ type?: string | null }>
): PoolTypeSlice[] {
    let squares = 0;
    let brackets = 0;
    let playoffs = 0;
    let nflSeason = 0;

    pools.forEach(pool => {
        const type = pool.type;
        if (type === 'SQUARES') squares++;
        else if (type === 'BRACKET') brackets++;
        else if (type === 'NFL_PLAYOFFS') playoffs++;
        else if (type?.startsWith('NFL_')) nflSeason++;
    });

    return [
        { name: 'Squares', value: squares, color: '#C9A867' },
        { name: 'Brackets', value: brackets, color: '#24507F' },
        { name: 'NFL Playoffs', value: playoffs, color: '#8C6D33' },
        { name: 'NFL Pickem/Margin', value: nflSeason, color: '#1A3B62' }
    ].filter(slice => slice.value > 0);
}

/**
 * Cumulative paid winnings, one point per month that actually had a payout.
 *
 * Months with no payout are NOT emitted — a flat carried-forward point is true
 * but adds nothing a connecting line does not already say, and every row this
 * function emits should trace back to a real `Winner` document. Wins with no
 * usable `paidAt` are dropped rather than dated with a guess; the caller
 * distinguishes "no winnings" from "winnings not marked paid" via
 * {@link earningsEmptyState}.
 */
export function buildCumulativePaidWinnings(
    wins: ReadonlyArray<PaidWin>
): EarningsPoint[] {
    const dated = wins
        .filter(win =>
            Number.isFinite(win.paidAt) && win.paidAt > 0 &&
            Number.isFinite(win.amount)
        )
        .slice()
        .sort((a, b) => a.paidAt - b.paidAt);

    const points: EarningsPoint[] = [];
    let running = 0;

    for (const win of dated) {
        running += win.amount;
        const month = monthLabel(new Date(win.paidAt));
        const last = points[points.length - 1];
        if (last && last.month === month) last.Earnings = running;
        else points.push({ month, Earnings: running });
    }

    return points;
}

/**
 * What to say when {@link buildCumulativePaidWinnings} is empty.
 *
 * The two cases must read differently. The dashboard also shows a "Net
 * winnings: $X" stat card, so telling a user with $340 in wins that they have
 * "no winnings yet" would contradict the number directly above the chart.
 */
export function earningsEmptyState(totalWinnings: number): EarningsEmptyState {
    const total = Number.isFinite(totalWinnings) ? totalWinnings : 0;

    if (total > 0) {
        return {
            headline: 'No dated payouts yet',
            detail: `Your $${total.toLocaleString()} in winnings has not been marked paid yet. This trend fills in once a commissioner records the payout date.`
        };
    }

    return {
        headline: 'No winnings yet',
        detail: 'Win a payout in a pool and your cumulative trend appears here.'
    };
}
