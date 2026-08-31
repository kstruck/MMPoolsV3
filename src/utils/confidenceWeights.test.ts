import { describe, it, expect } from 'vitest';
import { confidenceValueOwners, isConfidenceValueTaken } from './confidenceWeights';

const owners = (gameIds: string[], confidence: Record<string, number>) =>
  confidenceValueOwners(gameIds, confidence);

describe('confidenceValueOwners', () => {
  it('maps each assigned weight to the game holding it', () => {
    const map = owners(['g1', 'g2', 'g3'], { g1: 16, g2: 15 });
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([15, 16]);
    expect([...map.get(16)!]).toEqual(['g1']);
    expect([...map.get(15)!]).toEqual(['g2']);
  });

  it('ignores games with no weight set, and the empty-option NaN', () => {
    const map = owners(['g1', 'g2'], { g1: NaN, g2: undefined as unknown as number });
    expect(map.size).toBe(0);
  });

  it('ignores weights belonging to games outside this week', () => {
    // `confidence` is keyed by gameId across the whole entry; only the week's
    // own slate may gray anything out.
    const map = owners(['g1'], { g1: 16, otherWeekGame: 15 });
    expect(map.size).toBe(1);
    expect(map.has(15)).toBe(false);
  });

  it('keeps BOTH holders when an entry already carries a duplicate', () => {
    const map = owners(['g1', 'g2'], { g1: 12, g2: 12 });
    expect([...map.get(12)!].sort()).toEqual(['g1', 'g2']);
  });
});

describe('isConfidenceValueTaken', () => {
  const map = owners(['g1', 'g2', 'g3'], { g1: 16, g2: 15 });

  it("grays out a weight ANOTHER game holds", () => {
    expect(isConfidenceValueTaken(map, 16, 'g3')).toBe(true);
    expect(isConfidenceValueTaken(map, 15, 'g3')).toBe(true);
  });

  it("never grays out the game's OWN weight — that would strand the selection", () => {
    expect(isConfidenceValueTaken(map, 16, 'g1')).toBe(false);
    expect(isConfidenceValueTaken(map, 15, 'g2')).toBe(false);
  });

  it('leaves an unassigned weight selectable everywhere', () => {
    expect(isConfidenceValueTaken(map, 14, 'g1')).toBe(false);
    expect(isConfidenceValueTaken(map, 14, 'g3')).toBe(false);
  });

  it('leaves a duplicated weight selectable for both holders and grayed for the rest', () => {
    const dup = owners(['g1', 'g2', 'g3'], { g1: 12, g2: 12 });
    expect(isConfidenceValueTaken(dup, 12, 'g1')).toBe(false);
    expect(isConfidenceValueTaken(dup, 12, 'g2')).toBe(false);
    expect(isConfidenceValueTaken(dup, 12, 'g3')).toBe(true);
  });
});
