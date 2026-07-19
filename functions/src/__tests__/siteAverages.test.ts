import { describe, it, expect } from 'vitest';
import { computeSiteAverages } from '../siteAverages';

// League-average line for the profile Performance Chart (original requirement:
// player vs average; CONTEXT.md: averages are real aggregates, never constants).

describe('computeSiteAverages', () => {
  it('averages per (season, week) across players; experts excluded', () => {
    const rows = computeSiteAverages([
      { subjectKind: 'PLAYER', weekly: [{ season: '2026', week: 1, correct: 12, total: 16 }] }, // 75%
      { subjectKind: 'PLAYER', weekly: [{ season: '2026', week: 1, correct: 8, total: 16 }] },  // 50%
      { subjectKind: 'EXPERT', weekly: [{ season: '2026', week: 1, correct: 16, total: 16 }] }, // ignored
    ]);
    expect(rows).toEqual([{ season: '2026', week: 1, avgAccuracy: 63, players: 2 }]);
  });

  it('skips zero-pick weeks and sorts by season then week', () => {
    const rows = computeSiteAverages([
      { weekly: [
        { season: '2026', week: 2, correct: 10, total: 16 },
        { season: '2025', week: 18, correct: 8, total: 16 },
        { season: '2026', week: 1, correct: 0, total: 0 }, // no picks -> excluded
      ] },
    ]);
    expect(rows.map(r => `${r.season}W${r.week}`)).toEqual(['2025W18', '2026W2']);
  });

  it('empty input -> empty output', () => {
    expect(computeSiteAverages([])).toEqual([]);
  });
});
