import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * NFL surface invariants — the season-type rule has ONE definition.
 *
 * `src/utils/nflPending.test.ts` proves `gamesForPoolWeek` and `poolSeasonType`
 * are correct; it cannot prove the surfaces USE them. Both defects this file
 * guards were re-derivations, not wrong logic:
 *
 *  - Manager surfaces filtered `g.week === week` alone while member surfaces
 *    also required the pool's season type, so on a pool holding a week-1 game of
 *    the other season type the manager's `isWeekFullyFinal` gate for Score &
 *    Recap counted games the member checklist did not.
 *  - Every member-side copy read `Number(pool.seasonType)` with no default.
 *    `seasonType` is OPTIONAL and omitting it means REGULAR season
 *    (`shared/schemas/nfl.ts`), so an unset pool coerced to `NaN`, which matches
 *    no game — that pool rendered with no schedule at all.
 *
 * Deliberately coarse source greps, same as `admin-surface-invariants`: they
 * assert the wiring, not the behavior.
 */

const root = resolve(__dirname, '..');

const SURFACES = [
  'src/components/NFLPoolDashboard/NFLManagerView.tsx',
  'src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx',
  'src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx',
  'src/components/NFLPoolDashboard/NFLPoolDashboard.tsx',
  'src/components/NFLPoolDashboard/WeekChecklist.tsx',
  'src/components/NFLPoolDashboard/PickemPickEntry.tsx',
  'src/services/nflStatusService.ts',
];

describe('one definition — no NFL surface re-derives the season-type rule', () => {
  it.each(SURFACES)('%s reads the pool season type only through poolSeasonType()', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // A game's seasonType is a required field, so `Number(g.seasonType)` is fine.
    // Coercing a POOL's is the NaN bug.
    const poolSideCoercions = src.match(/Number\(\s*\w*[Pp]ool\??\.seasonType/g) ?? [];
    expect(poolSideCoercions).toEqual([]);
  });

  it.each(SURFACES)('%s filters games by week only through gamesForPoolWeek()', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // `.filter(g => g.week === ...)` in a surface is the manager-side defect.
    const inlineWeekFilters = src.match(/\.filter\([^;]{0,120}?\.week\s*===/g) ?? [];
    expect(inlineWeekFilters).toEqual([]);
  });

  it('the greps above actually match the code they are meant to catch', () => {
    // A guard that matches nothing looks identical to a guard that passes. These
    // are the two exact shapes that were removed; if either regex stops matching
    // them, the guard has silently stopped guarding.
    const oldPoolCoercion = 'const seasonType = Number(castPool.seasonType);';
    const oldWeekFilter = 'const weeklyGames = useMemo(() => games.filter(g => g.week === week), [games, week]);';
    expect(oldPoolCoercion.match(/Number\(\s*\w*[Pp]ool\??\.seasonType/g)).toHaveLength(1);
    expect(oldWeekFilter.match(/\.filter\([^;]{0,120}?\.week\s*===/g)).toHaveLength(1);
  });

  it('every surface imports the shared helpers it needs', () => {
    for (const file of SURFACES) {
      const src = readFileSync(resolve(root, file), 'utf8');
      const usesHelper = /\b(gamesForPoolWeek|poolSeasonType)\s*\(/.test(src);
      expect(usesHelper, `${file} should read season type via the shared helpers`).toBe(true);
      expect(src, `${file} should import from utils/nflPending`).toMatch(/utils\/nflPending/);
    }
  });
});
