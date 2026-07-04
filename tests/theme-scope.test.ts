import { describe, it, expect } from 'vitest';
import { themeAppliesTo, themesForPoolType } from '../src/utils/themeScope';

describe('themeAppliesTo (T13)', () => {
  it('a theme with no appliesTo is universal (back-compat for existing themes)', () => {
    expect(themeAppliesTo({}, 'SQUARES')).toBe(true);
    expect(themeAppliesTo({ appliesTo: [] }, 'BRACKET')).toBe(true);
  });

  it('a scoped theme only applies to its listed types', () => {
    expect(themeAppliesTo({ appliesTo: ['SQUARES'] }, 'SQUARES')).toBe(true);
    expect(themeAppliesTo({ appliesTo: ['SQUARES'] }, 'BRACKET')).toBe(false);
    expect(themeAppliesTo({ appliesTo: ['NFL_PICKEM', 'NFL_SURVIVOR'] }, 'NFL_SURVIVOR')).toBe(true);
  });

  it('themesForPoolType filters a list', () => {
    const themes = [
      { id: 'a', appliesTo: ['SQUARES' as const] },
      { id: 'b' }, // universal
      { id: 'c', appliesTo: ['BRACKET' as const] },
    ];
    const out = themesForPoolType(themes, 'SQUARES').map((t) => t.id);
    expect(out).toEqual(['a', 'b']);
  });
});
