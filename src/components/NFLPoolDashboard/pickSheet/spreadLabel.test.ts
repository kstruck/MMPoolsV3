import { describe, it, expect } from 'vitest';
import { spreadLabel } from './GameMeta';
import type { NFLGame } from '../../../types';

/**
 * The line, written the way a pick sheet writes it.
 *
 * `spread.value` is stored HOME-RELATIVE (negative = home favoured), which is
 * correct in the data and unreadable on a row: "-6.5" printed between two team
 * names does not say which team it belongs to. This converts it to the
 * favourite-relative form a player expects.
 */
const game = (over: Partial<NFLGame> = {}): NFLGame => ({
  id: 'g1', espnGameId: '1', week: 1, season: '2026', seasonType: 1,
  homeTeam: { id: 'h', name: 'Bengals', abbreviation: 'CIN' },
  awayTeam: { id: 'a', name: 'Lions', abbreviation: 'DET' },
  startTime: 1_800_000_000_000, status: 'SCHEDULED',
  ...over,
} as NFLGame);

describe('spreadLabel', () => {
  it('names the HOME team when home is favoured (negative value)', () => {
    // Measured shape from the live feed: ESPN said "CIN -6.5" and the importer
    // stores it as -6.5 home-relative. The row must say "CIN -6.5" again.
    expect(spreadLabel(game({ spread: { value: -6.5, locked: true } }))).toBe('CIN -6.5');
  });

  it('names the AWAY team when away is favoured (positive value)', () => {
    expect(spreadLabel(game({ spread: { value: 2.5, locked: true } }))).toBe('DET -2.5');
  });

  it('says PK on a pick-em line rather than "-0"', () => {
    expect(spreadLabel(game({ spread: { value: 0, locked: false } }))).toBe('PK');
  });

  it('returns null when there is no line — preseason weeks 3-4 carry none', () => {
    // Measured 2026-08-12: 16/16 priced in preseason week 2, 0/16 in weeks 3-4.
    // The row omits the field entirely rather than printing a placeholder.
    expect(spreadLabel(game())).toBeNull();
    expect(spreadLabel(game({ spread: undefined }))).toBeNull();
  });

  it('is null-safe on a malformed team, rather than rendering "undefined -3"', () => {
    const g = game({ spread: { value: -3, locked: true } });
    (g as { homeTeam?: unknown }).homeTeam = { id: 'h', name: 'X' };
    expect(spreadLabel(g)).toBeNull();
  });
});
