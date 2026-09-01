import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE PARTICIPANT DASHBOARD MUST NOT INVENT DATA IT DOES NOT HAVE.
 *
 * The 2026-09-01 external audit found both Insights-tab charts in
 * `src/components/ParticipantDashboard.tsx` fabricating a dataset for users who
 * had none:
 *
 *   1. **Roster Distribution.** When the real pool-type split came out empty —
 *      i.e. the signed-in user belonged to zero pools — the memo returned a
 *      hardcoded `[{ name: 'Active Squares', value: 2 }, { name: 'NFL Pools',
 *      value: 1 }]`. A brand-new user was shown a pie of three pools they had
 *      never joined, ringed by a "Total Pools" label reading 0.
 *
 *   2. **Lifetime Winnings Trend.** The series was synthesised from the single
 *      `totalWinnings` scalar by multiplying it by 0.15 / 0.35 / 0.5 / 0.7 to
 *      manufacture a monthly ramp, and the final point read
 *      `totalWinnings || 120` — so a user who had won nothing was shown a curve
 *      climbing to a fabricated $120 payout.
 *
 * Both are now empty states, and the data builders live in
 * `src/utils/dashboardCharts.ts` where `dashboardCharts.test.ts` pins their
 * behaviour directly.
 *
 * ## Why a source-text test on top of the unit tests
 *
 * The unit tests prove the extracted builders are honest. They cannot prove the
 * component still USES them — a future edit that reintroduces an inline
 * placeholder fallback beside the chart, or restores the `|| 120` default, would
 * leave every unit test green. This asserts the fabricated values are absent
 * from the component itself, which is the property the audit actually found
 * violated.
 */

const DASHBOARD_PATH = resolve(__dirname, '../src/components/ParticipantDashboard.tsx');
const source = readFileSync(DASHBOARD_PATH, 'utf8');

describe('ParticipantDashboard charts — no fabricated data', () => {
    it('the placeholder pie slices are gone', () => {
        expect(source).not.toContain('Active Squares');
        expect(source).not.toContain("name: 'NFL Pools'");
    });

    it('the synthetic monthly ramp multipliers are gone', () => {
        // The exact shape of the invented curve: totalW * 0.15 / 0.35 / 0.5 / 0.7.
        for (const multiplier of ['0.15', '0.35', '0.5', '0.7']) {
            expect(source).not.toContain(`totalW * ${multiplier}`);
        }
        expect(source).not.toContain('Math.round(totalW');
    });

    it('the fabricated $120 earnings fallback is gone', () => {
        expect(source).not.toContain('totalW || 120');
        expect(source).not.toMatch(/Earnings:\s*\w+\s*\|\|\s*\d/);
    });

    it('bare month-name literals no longer seed the trend chart', () => {
        // The invented series hardcoded a Sep..Feb season. Any real series is
        // derived from payout timestamps, so these literals should not appear.
        expect(source).not.toMatch(/month:\s*'(Sep|Oct|Nov|Dec|Jan|Feb)'/);
    });

    it('both charts are sourced from the shared honest builders', () => {
        expect(source).toContain("from '../utils/dashboardCharts'");
        expect(source).toContain('buildPoolTypeSplit(');
        expect(source).toContain('buildCumulativePaidWinnings(');
    });

    it('each chart is guarded by an emptiness check rather than rendered unconditionally', () => {
        expect(source).toContain('poolTypeSplitData.length > 0');
        expect(source).toContain('cumulativeEarningsData.length > 0');
    });

    it('the empty pool-mix state routes users somewhere real', () => {
        expect(source).toContain("navigate('/browse')");
        expect(source).toContain("navigate('/create-pool')");
    });

    it('the trend card no longer claims to cover every win', () => {
        // `Winner` has no "won at" timestamp; only `paidAt` dates a win. The
        // heading must not promise a lifetime view the data cannot support.
        expect(source).not.toContain('Lifetime Winnings Trend');
        expect(source).toContain('Paid Winnings Trend');
    });
});
