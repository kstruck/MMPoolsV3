import { describe, it, expect } from 'vitest';
import { bracketScoringSystemSchema } from '../shared/schemas/bracket';
import { squaresCreateInputSchema } from '../shared/schemas/squares';

/**
 * Regression guards for two schema/engine contract drifts surfaced by the live
 * Test Suite run:
 *  - bracket scoringSystem rejected ESPN/FIBONACCI even though the scoring engine
 *    (functions/src/bracketScoring.ts) implements them.
 *  - squares gameId was `.optional()` (string | undefined) and rejected an explicit
 *    null, which the create path sends for a pool with no game assigned yet.
 */

describe('bracket scoringSystem schema accepts every engine-supported system', () => {
  it.each(['CLASSIC', 'ESPN', 'FIBONACCI', 'CUSTOM', 'UPSET'])('accepts %s', (s) => {
    expect(bracketScoringSystemSchema.safeParse(s).success).toBe(true);
  });
  it('rejects an unknown system', () => {
    expect(bracketScoringSystemSchema.safeParse('BOGUS').success).toBe(false);
  });
});

describe('squares create schema accepts a null gameId', () => {
  const base = { name: 'Test Squares', costPerSquare: 10 };
  it('accepts gameId: null', () => {
    expect(squaresCreateInputSchema.safeParse({ ...base, gameId: null }).success).toBe(true);
  });
  it('accepts an omitted gameId', () => {
    expect(squaresCreateInputSchema.safeParse(base).success).toBe(true);
  });
  it('accepts a string gameId', () => {
    expect(squaresCreateInputSchema.safeParse({ ...base, gameId: '401547' }).success).toBe(true);
  });
});
