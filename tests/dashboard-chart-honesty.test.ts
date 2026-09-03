import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPoolTypeSplit } from '../src/utils/dashboardCharts';

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
const TYPES_PATH = resolve(__dirname, '../src/types/index.ts');
const source = readFileSync(DASHBOARD_PATH, 'utf8');

/**
 * Every member of the `PoolType` union, read out of the source of truth rather
 * than restated here — a restated list would go stale exactly when it matters.
 */
function declaredPoolTypes(): string[] {
    const types = readFileSync(TYPES_PATH, 'utf8');
    const match = types.match(/export type PoolType\s*=\s*([^;]+);/);
    if (!match) throw new Error('Could not find the PoolType union in src/types/index.ts');
    return [...match[1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
}

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

    it('the PoolType union is actually being read — the coverage guard below is not vacuous', () => {
        // Without this, a `PoolType` line the regex stops matching would make
        // the coverage test pass over an empty list rather than fail.
        const types = declaredPoolTypes();
        expect(types.length).toBeGreaterThanOrEqual(7);
        expect(types).toContain('SQUARES');
        expect(types).toContain('PROPS');
        expect(types).toContain('NFL_MARGIN');
    });

    it('every PoolType lands in a pie category, so an empty pie really means zero pools', () => {
        // THE DEFECT THIS PINS. The pie's empty state tells the user "No pools
        // yet". That sentence is only true if a pool of EVERY type produces a
        // slice. The first draft of this fix omitted PROPS — a user whose only
        // pool was a Props pool would have been told they had none, which is
        // the same class of lie as the fabricated slices being removed here.
        const uncategorised = declaredPoolTypes()
            .filter(type => buildPoolTypeSplit([{ type }]).length === 0);
        expect(uncategorised).toEqual([]);
    });

    it('neither empty state asserts "none" until its feed has actually answered', () => {
        // qodo #19/#20. Both feeds turn a failure into an empty result — the
        // pool subscriptions log and leave `myPools` empty, and
        // `subscribeToWinners` collapsed errors into `[]`. A component that
        // renders the copy unconditionally states "you have none" after a failed
        // read. The claim must be gated on knowing.
        expect(source).toContain('poolMixEmptyState(!poolsFailed)');
        expect(source).toContain('earningsEmptyState(lifetimeStats.totalWinnings, winningsKnown)');
        expect(source).toContain('setPoolsFailed(true)');
        expect(source).toContain('setWinnersFailed(true)');
        // Both chart empty states must render the helper's copy, never a
        // hardcoded headline that would bypass the gating above.
        expect(source).toContain('{poolMixEmpty.headline}');
        expect(source).toContain('{earningsEmpty.headline}');
        // NOT asserted: that the strings "No pools yet" / "No winnings yet" are
        // absent from the file. The pools-list tab has carried its own "No pools
        // yet" card since long before this PR, so that assertion would fail on
        // untouched code. That card has the same failure-mode gap and is noted
        // as deferred follow-up in the PR body rather than widened into here.
    });

    it('the winners subscription reports its errors instead of swallowing them', () => {
        const service = readFileSync(resolve(__dirname, '../src/services/dbService.ts'), 'utf8');
        // `callback([])` on error is what made a failed ledger indistinguishable
        // from an empty one. The onError path must exist for callers that care.
        expect(service).toContain('if (onError) onError(error); else callback([]);');
    });

    it('the trend card no longer claims to cover every win', () => {
        // `Winner` has no "won at" timestamp; only `paidAt` dates a win. The
        // heading must not promise a lifetime view the data cannot support.
        expect(source).not.toContain('Lifetime Winnings Trend');
        expect(source).toContain('Paid Winnings Trend');
    });
});
