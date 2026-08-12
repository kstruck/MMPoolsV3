import { describe, it, expect } from 'vitest';
import { teamColor, teamColorStyle } from './nflTeamColors';

describe('teamColor', () => {
  it('resolves every current abbreviation', () => {
    const all = [
      'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
      'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
      'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
      'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
    ];
    expect(all.length).toBe(32);
    for (const abbr of all) expect(teamColor(abbr), abbr).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('resolves the legacy abbreviations that still sit in old nfl_games docs', () => {
    // ESPN has renamed these, and games imported before the rename keep the old
    // key. A miss here is a team card with no colour, which is exactly the
    // silent degradation an alias table exists to prevent.
    expect(teamColor('WAS')).toBe(teamColor('WSH'));
    expect(teamColor('JAC')).toBe(teamColor('JAX'));
    expect(teamColor('OAK')).toBe(teamColor('LV'));
    expect(teamColor('SD')).toBe(teamColor('LAC'));
  });

  it('is case-insensitive and safe on junk', () => {
    expect(teamColor('kc')).toBe(teamColor('KC'));
    expect(teamColor('ZZZ')).toBeUndefined();
    expect(teamColor(undefined)).toBeUndefined();
    expect(teamColor('')).toBeUndefined();
  });
});

describe('teamColorStyle', () => {
  /**
   * ⚠️ THE ONLY REASON THIS FILE COMPUTES ANYTHING. Two of the primaries are
   * light — Pittsburgh gold and New Orleans gold — and white text on them is
   * unreadable. Hardcoding "white always" would have shipped exactly that.
   */
  it('puts DARK text on the light primaries', () => {
    expect(teamColorStyle('PIT')?.fg).toBe('#0B162A');   // #FFB612
    expect(teamColorStyle('NO')?.fg).toBe('#0B162A');    // #D3BC8D
  });

  it('puts WHITE text on the dark primaries', () => {
    for (const abbr of ['CHI', 'BAL', 'NE', 'LV', 'DAL', 'SEA']) {
      expect(teamColorStyle(abbr)?.fg, abbr).toBe('#FFFFFF');
    }
  });

  it('returns undefined for an unknown team so callers keep their own styling', () => {
    expect(teamColorStyle('ZZZ')).toBeUndefined();
    expect(teamColorStyle(undefined)).toBeUndefined();
  });
});
