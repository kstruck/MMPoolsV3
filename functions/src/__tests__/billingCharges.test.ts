import { describe, it, expect } from 'vitest';
import { summarizeCharges } from '../lib/billingCharges';

const NOW = 1_800_000_000_000; // fixed epoch for deterministic 30d window
const DAY = 24 * 60 * 60 * 1000;

describe('summarizeCharges (T14 platform-revenue reducer)', () => {
  it('sums total and splits by kind (bundles included — the undercounting bug)', () => {
    const out = summarizeCharges(
      [
        { amount: 9, kind: 'pool', at: NOW },
        { amount: 49, kind: 'bundle', at: NOW },
        { amount: 9, kind: 'pool', at: NOW },
      ],
      NOW
    );
    expect(out.totalRevenue).toBe(67);
    expect(out.byKind.pool).toBe(18);
    expect(out.byKind.bundle).toBe(49);
    expect(out.chargeCount).toBe(3);
  });

  it('last30d excludes charges older than 30 days', () => {
    const out = summarizeCharges(
      [
        { amount: 10, kind: 'pool', at: NOW - 5 * DAY },
        { amount: 20, kind: 'pool', at: NOW - 40 * DAY },
      ],
      NOW
    );
    expect(out.totalRevenue).toBe(30);
    expect(out.last30dRevenue).toBe(10);
  });

  it('handles empty + missing amounts safely', () => {
    expect(summarizeCharges([], NOW).totalRevenue).toBe(0);
    const out = summarizeCharges([{ amount: NaN as unknown as number, kind: 'pool', at: NOW }], NOW);
    expect(out.totalRevenue).toBe(0);
  });
});
