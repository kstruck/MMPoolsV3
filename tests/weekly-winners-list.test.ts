import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recapHasHighlights } from '../src/utils/recapHighlight';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/**
 * PLAN-WEEKLY-PRIZES B2 (§3, D6–D8, K10) — the Weekly Winners List renders what
 * the scorer PUBLISHED and nothing else. Root vitest has no DOM, so these are
 * wiring guards + the pure highlight predicate.
 */
describe('Weekly Winners List — wiring', () => {
  it('the recap card renders WeeklyWinnersList from recap.weeklyPlaces and never re-ranks or re-prices', () => {
    const list = read('src/components/NFLPoolDashboard/WeeklyWinnersList.tsx');
    expect(list).toContain('recap.weeklyPlaces');
    expect(list).toContain('recap.weeklyPrize');
    expect(list).toContain('recap.weeklyPlacesError');
    // No client-side ranking or splitting.
    expect(list).not.toMatch(/rankWeeklyPlaces|splitPrizes|priceWeeklyPlaces|potBreakdown/);
    // D6 remainder named, K10 public stated, "moves no money".
    expect(list).toContain('rounding remainder is unallocated');
    expect(list).toContain('visible to anyone with the pool link');
    expect(list).toContain('moves no money');
    const dash = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
    expect(dash).toContain("import { WeeklyWinnersList } from './WeeklyWinnersList'");
    expect(dash).toContain('<WeeklyWinnersList recap={recap} poolType={pool.type} />');
  });
  it('a recap with only weeklyPlaces (or only an error) counts as having highlights', () => {
    const base = { id: 'week_1', poolId: 'p', week: 1, createdAt: 0 };
    expect(recapHasHighlights({ ...base, weeklyPlaces: [{ entryId: 'a', userId: 'a', userName: 'A', points: 1, rank: 1 }] } as never)).toBe(true);
    expect(recapHasHighlights({ ...base, weeklyPlacesError: 'PRIZE_SPLIT_DUPLICATE_RANK' } as never)).toBe(true);
    expect(recapHasHighlights({ ...base, weeklyPlaces: [] } as never)).toBe(false);
  });
});
