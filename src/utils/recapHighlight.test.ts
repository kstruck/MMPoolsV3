import { describe, it, expect } from 'vitest';
import { formatSharpScore, recapHasHighlights, weeklyWinnerLabel } from './recapHighlight';
import type { WeeklyRecap } from '../types';

const base: WeeklyRecap = { id: 'week_1', poolId: 'p1', week: 1, createdAt: 0 };

describe('formatSharpScore', () => {
  it('renders Pick’em as points', () => {
    expect(formatSharpScore('NFL_PICKEM', 12)).toBe('12 pts');
  });

  it('renders Margin as a SIGNED margin, never as points', () => {
    expect(formatSharpScore('NFL_MARGIN', 12)).toBe('+12 margin');
    expect(formatSharpScore('NFL_MARGIN', 12)).not.toContain('pts');
  });

  // The whole reason this helper exists: `sharpOfWeek.score` carries a point
  // total for Pick'em and a margin of victory for Margin, and a margin can be
  // negative. Dropping the sign would print "3" for a three-point LOSS.
  it('keeps the minus sign on a negative margin', () => {
    expect(formatSharpScore('NFL_MARGIN', -3)).toBe('-3 margin');
  });

  it('does not print a plus on a zero margin', () => {
    expect(formatSharpScore('NFL_MARGIN', 0)).toBe('0 margin');
  });

  it('falls back to points for Survivor and for an unknown/absent type', () => {
    expect(formatSharpScore('NFL_SURVIVOR', 4)).toBe('4 pts');
    expect(formatSharpScore(undefined, 4)).toBe('4 pts');
  });
});

describe('recapHasHighlights', () => {
  it('is false for a recap carrying only its identity fields', () => {
    expect(recapHasHighlights(base)).toBe(false);
  });

  it('is true on a sharp of the week', () => {
    expect(recapHasHighlights({ ...base, sharpOfWeek: { userId: 'u', userName: 'U', score: 7 } })).toBe(true);
  });

  it('is true on a closest tiebreaker', () => {
    expect(recapHasHighlights({ ...base, closestTiebreaker: { userId: 'u', userName: 'U', diff: 2 } })).toBe(true);
  });

  // `0` is a real attrition count — every Survivor entry eliminated — and a
  // truthiness check would report that week as having nothing to show.
  it('is true on an attrition count of ZERO', () => {
    expect(recapHasHighlights({ ...base, attritionCount: 0 })).toBe(true);
  });

  it('is true on a weekly winner', () => {
    // Without this a recap whose ONLY content is the winner renders
    // "No highlights this week" over the thing members came to see.
    expect(recapHasHighlights({
      ...base,
      weeklyWinners: [{ userId: 'u', userName: 'U', points: 11 }],
    })).toBe(true);
  });

  it('is NOT true on an empty weeklyWinners array', () => {
    // The scorer never writes one, but a hand-edited or partially-migrated doc
    // could carry it, and an empty array is not a highlight.
    expect(recapHasHighlights({ ...base, weeklyWinners: [] })).toBe(false);
  });
});

describe('weeklyWinnerLabel', () => {
  it('says WINNER only where something is actually won weekly', () => {
    expect(weeklyWinnerLabel('WEEKLY', false)).toBe('Weekly Winner');
    expect(weeklyWinnerLabel('HYBRID', false)).toBe('Weekly Winner');
  });

  it('says TOP SCORER on a season-long pool, where no weekly prize exists', () => {
    // A trophy line on a SEASON pool would imply a prize that does not exist.
    expect(weeklyWinnerLabel('SEASON', false)).toBe('Top Scorer');
    expect(weeklyWinnerLabel(undefined, false)).toBe('Top Scorer');
  });

  it('marks a shared week as shared, in both registers', () => {
    // A tie the pool's tiebreaker could not separate must never render as if
    // one of them won.
    expect(weeklyWinnerLabel('WEEKLY', true)).toBe('Weekly Winners (shared)');
    expect(weeklyWinnerLabel('SEASON', true)).toBe('Top Scorers (tied)');
  });
});
