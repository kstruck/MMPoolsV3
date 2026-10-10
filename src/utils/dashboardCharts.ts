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

/**
 * One of the caller's wins. `paidAt` is deliberately `unknown`: on the client
 * it arrives as a Firestore `Timestamp`, but older rows hold epoch millis and
 * an un-marked payout holds `null`. {@link toEpochMillis} sorts that out inside
 * this module so no caller has to know the shape — and so the handling is
 * covered by these functions' own tests rather than by a component test.
 */
export interface PaidWin {
    amount: number;
    paidAt: unknown;
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

/** Copy shown in place of the pool-mix pie when it has no slices. */
export interface PoolMixEmptyState {
    headline: string;
    detail: string;
    /** Whether to offer the browse / create buttons. Pointless on a failure. */
    showActions: boolean;
}

/**
 * What to say when {@link buildPoolTypeSplit} is empty.
 *
 * `poolsKnown` is false when a pool subscription errored. The dashboard's pool
 * feeds log their failures and leave `myPools` empty while clearing the loading
 * flag, so a failed roster is indistinguishable from an empty one — and telling
 * a user with eight pools "No pools yet, go create one" is exactly the sort of
 * confident false statement this module was written to stop. (qodo #19 on
 * PR #670.)
 */
export function poolMixEmptyState(poolsKnown: boolean = true): PoolMixEmptyState {
    if (!poolsKnown) {
        return {
            headline: 'Roster unavailable',
            detail: 'We could not load your pools just now. Reload the page — nothing has been lost.',
            showActions: false
        };
    }

    return {
        headline: 'No pools yet',
        detail: 'Join a pool with an invite link from a friend, browse public pools, or start your own.',
        showActions: true
    };
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
 *
 * EVERY `PoolType` MUST LAND IN A CATEGORY. The caller renders a "no pools yet"
 * empty state when this returns `[]`, and that message is only true if an empty
 * result really does mean zero pools. The version this replaced omitted
 * `PROPS` — so a user whose only pool was a Props pool would have been told
 * they had none. `dashboard-chart-honesty.test.ts` reads the `PoolType` union
 * out of `src/types/index.ts` and fails if a new member is added without a
 * category here.
 */
export function buildPoolTypeSplit(
    pools: ReadonlyArray<{ type?: string | null }>
): PoolTypeSlice[] {
    let squares = 0;
    let brackets = 0;
    let playoffs = 0;
    let nflSeason = 0;
    let props = 0;

    pools.forEach(pool => {
        const type = pool.type;
        if (type === 'SQUARES') squares++;
        else if (type === 'BRACKET') brackets++;
        else if (type === 'NFL_PLAYOFFS') playoffs++;
        else if (type === 'PROPS') props++;
        else if (type?.startsWith('NFL_')) nflSeason++;
    });

    return [
        { name: 'Squares', value: squares, color: '#C9A867' },
        { name: 'Brackets', value: brackets, color: '#24507F' },
        { name: 'NFL Playoffs', value: playoffs, color: '#8C6D33' },
        { name: 'NFL Pickem/Margin', value: nflSeason, color: '#1A3B62' },
        { name: 'Props', value: props, color: '#0F7B4A' }
    ].filter(slice => slice.value > 0);
}

/**
 * Normalise whatever a payout date arrives as into epoch milliseconds, or
 * `null` when there is no usable date.
 *
 * THE DEFECT THIS PINS (codex, round 1 of this branch). The first draft guarded
 * with `typeof winner.paidAt === 'number'`, because `Winner.paidAt` was
 * DECLARED `number`. It is not one. `toggleWinnerPaid`
 * (functions/src/poolOps.ts) writes `FieldValue.serverTimestamp()` and
 * `dbService.subscribeToWinners` forwards `doc.data()` unconverted, so the
 * browser holds a Firestore `Timestamp` object. The numeric guard therefore
 * discarded EVERY payout recorded through the normal commissioner flow, and the
 * chart would have shown its empty state permanently — a bug the type system
 * actively hid, and one that would have looked exactly like "no payouts yet".
 *
 * Four shapes are accepted because four shapes reach this code: a live
 * `Timestamp` (has `toMillis`), a plain `{ seconds, nanoseconds }` object (what
 * a Timestamp degrades to across some serialisation paths), a `Date`, and a
 * raw number for rows written before the callable existed.
 */
export function toEpochMillis(value: unknown): number | null {
    /**
     * The one definition of "a usable payout date". Every conversion path below
     * ends here, so the accepted contract — a finite, positive number of
     * milliseconds — is stated once instead of re-spelled as a three-condition
     * boolean at each return. (qodo #14 on PR #670.)
     */
    const usableMillis = (millis: unknown): number | null =>
        typeof millis === 'number' && Number.isFinite(millis) && millis > 0 ? millis : null;

    if (typeof value === 'number') return usableMillis(value);

    if (value instanceof Date) return usableMillis(value.getTime());

    if (typeof value === 'object' && value !== null) {
        const candidate = value as { toMillis?: unknown; seconds?: unknown };

        if (typeof candidate.toMillis === 'function') {
            // `value` is `unknown`, so `toMillis` is somebody else's code and may
            // throw. This function's whole contract is that an unusable date
            // becomes `null`, so letting an exception escape would break the
            // promise and take the dashboard's render down with it — over a
            // corrupt payout row. (qodo #8 on PR #670.)
            try {
                return usableMillis((candidate as { toMillis(): unknown }).toMillis());
            } catch {
                return null;
            }
        }

        if (typeof candidate.seconds === 'number' && Number.isFinite(candidate.seconds)) {
            return usableMillis(candidate.seconds * 1000);
        }
    }

    return null;
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
        .map(win => ({ amount: win.amount, paidAt: toEpochMillis(win.paidAt) }))
        .filter((win): win is { amount: number; paidAt: number } =>
            win.paidAt !== null && Number.isFinite(win.amount)
        )
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
export function earningsEmptyState(
    totalWinnings: number,
    winningsKnown: boolean = true
): EarningsEmptyState {
    const total = Number.isFinite(totalWinnings) ? totalWinnings : 0;

    // "You have won nothing" is a CLAIM, and it needs the winners feed to have
    // actually answered. `subscribeToWinners` used to collapse a failure into
    // `[]`, and winner listeners start only after the pool feeds resolve — so
    // both a still-loading and a failed ledger looked exactly like a clean zero.
    // Saying "No winnings yet" in either case is the same kind of false
    // statement this module exists to remove. (qodo #20 on PR #670.)
    if (!winningsKnown) {
        return {
            headline: 'Winnings unavailable',
            detail: 'We could not load your payout history just now. Reload the page — your winnings are safe either way.'
        };
    }

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
