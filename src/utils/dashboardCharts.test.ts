import { describe, it, expect } from 'vitest';
import {
    buildPoolTypeSplit,
    buildCumulativePaidWinnings,
    earningsEmptyState
} from './dashboardCharts';

// The 2026-09-01 external audit found ParticipantDashboard's two Insights
// charts fabricating data for users who had none. These tests pin the
// replacement behaviour: real data or an empty array, never a placeholder.

describe('buildPoolTypeSplit', () => {
    it('no pools → empty, NOT the old fabricated Active Squares / NFL Pools slices', () => {
        expect(buildPoolTypeSplit([])).toEqual([]);
    });

    it('never invents a slice for a user with no pools, whatever the input shape', () => {
        // The defect: the old code returned [{Active Squares: 2}, {NFL Pools: 1}]
        // whenever the real split came out empty. Pools with no usable type must
        // still yield nothing rather than a placeholder.
        expect(buildPoolTypeSplit([{ type: undefined }, { type: null }, { type: '' }])).toEqual([]);
    });

    it('a Props-only user gets a slice, not the "no pools yet" empty state', () => {
        // The caller renders "No pools yet" on an empty result, so every real
        // PoolType has to produce a slice or that message becomes a lie.
        expect(buildPoolTypeSplit([{ type: 'PROPS' }])).toEqual([
            { name: 'Props', value: 1, color: '#0F7B4A' }
        ]);
    });

    it('counts each category from real pools', () => {
        const split = buildPoolTypeSplit([
            { type: 'SQUARES' },
            { type: 'SQUARES' },
            { type: 'BRACKET' },
            { type: 'NFL_PLAYOFFS' },
            { type: 'NFL_PICKEM' },
            { type: 'NFL_SURVIVOR' },
            { type: 'PROPS' }
        ]);
        expect(split).toEqual([
            { name: 'Squares', value: 2, color: '#C9A867' },
            { name: 'Brackets', value: 1, color: '#24507F' },
            { name: 'NFL Playoffs', value: 1, color: '#8C6D33' },
            { name: 'NFL Pickem/Margin', value: 2, color: '#1A3B62' },
            { name: 'Props', value: 1, color: '#0F7B4A' }
        ]);
    });

    it('NFL_PLAYOFFS is its own category, not lumped into the NFL_ season bucket', () => {
        const split = buildPoolTypeSplit([{ type: 'NFL_PLAYOFFS' }]);
        expect(split).toEqual([{ name: 'NFL Playoffs', value: 1, color: '#8C6D33' }]);
    });

    it('drops zero-value categories so the pie has no invisible slices', () => {
        expect(buildPoolTypeSplit([{ type: 'BRACKET' }]).map(s => s.name)).toEqual(['Brackets']);
    });

    it('the slice total equals the pool count — every real type is charted', () => {
        const pools = [{ type: 'SQUARES' }, { type: 'BRACKET' }, { type: 'PROPS' }];
        const total = buildPoolTypeSplit(pools).reduce((sum, s) => sum + s.value, 0);
        expect(total).toBe(pools.length);
    });

    it('gives every category a distinct colour, so the legend is readable', () => {
        const all = buildPoolTypeSplit([
            { type: 'SQUARES' }, { type: 'BRACKET' }, { type: 'NFL_PLAYOFFS' },
            { type: 'NFL_PICKEM' }, { type: 'PROPS' }
        ]);
        expect(new Set(all.map(s => s.color)).size).toBe(all.length);
    });
});

describe('buildCumulativePaidWinnings', () => {
    it('no wins → empty series, NOT the old six-month 0/0.15/0.35/0.5/0.7 curve', () => {
        expect(buildCumulativePaidWinnings([])).toEqual([]);
    });

    it('never emits the fabricated $120 fallback point', () => {
        const series = buildCumulativePaidWinnings([]);
        expect(series.some(p => p.Earnings === 120)).toBe(false);
    });

    it('a win with no payout date contributes nothing rather than a guessed month', () => {
        expect(buildCumulativePaidWinnings([
            { amount: 500, paidAt: 0 },
            { amount: 500, paidAt: Number.NaN },
            { amount: 500, paidAt: -1 }
        ])).toEqual([]);
    });

    it('accumulates real payouts in date order', () => {
        const series = buildCumulativePaidWinnings([
            { amount: 50, paidAt: new Date(2025, 9, 12).getTime() },  // Oct '25
            { amount: 25, paidAt: new Date(2025, 8, 3).getTime() },   // Sep '25
            { amount: 100, paidAt: new Date(2026, 0, 8).getTime() }   // Jan '26
        ]);
        expect(series).toEqual([
            { month: "Sep '25", Earnings: 25 },
            { month: "Oct '25", Earnings: 75 },
            { month: "Jan '26", Earnings: 175 }
        ]);
    });

    it('collapses several payouts in one month into a single cumulative point', () => {
        const series = buildCumulativePaidWinnings([
            { amount: 10, paidAt: new Date(2026, 1, 2).getTime() },
            { amount: 15, paidAt: new Date(2026, 1, 20).getTime() }
        ]);
        expect(series).toEqual([{ month: "Feb '26", Earnings: 25 }]);
    });

    it('labels carry the year, so two different Septembers stay two points', () => {
        const series = buildCumulativePaidWinnings([
            { amount: 10, paidAt: new Date(2025, 8, 1).getTime() },
            { amount: 10, paidAt: new Date(2026, 8, 1).getTime() }
        ]);
        expect(series.map(p => p.month)).toEqual(["Sep '25", "Sep '26"]);
    });

    it('is monotonic — a cumulative total never decreases', () => {
        const series = buildCumulativePaidWinnings([
            { amount: 5, paidAt: new Date(2025, 8, 1).getTime() },
            { amount: 0, paidAt: new Date(2025, 9, 1).getTime() },
            { amount: 40, paidAt: new Date(2025, 10, 1).getTime() }
        ]);
        const values = series.map(p => p.Earnings);
        expect(values).toEqual([...values].sort((a, b) => a - b));
    });

    it('the last point equals the sum of every dated payout', () => {
        const wins = [
            { amount: 30, paidAt: new Date(2025, 8, 1).getTime() },
            { amount: 70, paidAt: new Date(2025, 11, 1).getTime() }
        ];
        const series = buildCumulativePaidWinnings(wins);
        expect(series[series.length - 1].Earnings).toBe(100);
    });

    it('does not mutate the caller\'s array', () => {
        const wins = [
            { amount: 1, paidAt: new Date(2026, 2, 2).getTime() },
            { amount: 1, paidAt: new Date(2026, 1, 1).getTime() }
        ];
        const snapshot = wins.map(w => w.paidAt);
        buildCumulativePaidWinnings(wins);
        expect(wins.map(w => w.paidAt)).toEqual(snapshot);
    });
});

describe('earningsEmptyState', () => {
    it('zero winnings → says there are none', () => {
        expect(earningsEmptyState(0)).toEqual({
            headline: 'No winnings yet',
            detail: 'Win a payout in a pool and your cumulative trend appears here.'
        });
    });

    it('real winnings but nothing dated → never claims the user has won nothing', () => {
        // The dashboard shows a "Net winnings: $340" card directly above this
        // chart. Saying "no winnings yet" there would contradict it.
        const state = earningsEmptyState(340);
        expect(state.headline).toBe('No dated payouts yet');
        expect(state.detail).toContain('$340');
        expect(state.detail.toLowerCase()).not.toContain('no winnings');
    });

    it('formats large totals with separators, matching the stat card', () => {
        expect(earningsEmptyState(12500).detail).toContain('$12,500');
    });

    it('a non-finite total degrades to the zero-winnings copy, never NaN on screen', () => {
        expect(earningsEmptyState(Number.NaN).headline).toBe('No winnings yet');
        expect(earningsEmptyState(Number.NaN).detail).not.toContain('NaN');
    });
});
