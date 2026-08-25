import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveStandingsAlias } from '../src/utils/nflStandingsScope';

/**
 * T10 (Kevin, 2026-08-23) — ONE Standings tab on every NFL pool type.
 *
 * "I see the Standings & Leaderboard and Results tab is correct in the Survivor
 * pools, but not in any of the other NFL pools. This needs a fix before we go
 * live."
 *
 * Survivor showed one Standings tab; Pick'em and Margin showed two, with
 * overlapping names and the scope split across both. The merge re-parents the
 * two existing tables under one tab with a scope control — it rewrites no
 * ranking logic, which is why there is nothing to test in `utils/nflResults`
 * here and everything to test about the ROUTING and the columns.
 */
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('resolveStandingsAlias — a stale ?tab=results link lands, it does not fall through', () => {
  it('maps results to the Standings tab, week scope', () => {
    expect(resolveStandingsAlias('results')).toEqual({ tab: 'standings', scope: 'week' });
  });

  it('leaves the Standings tab itself on the season scope — that is the default view', () => {
    expect(resolveStandingsAlias('standings')).toEqual({ tab: 'standings', scope: 'season' });
  });

  it('passes every other tab through untouched', () => {
    for (const t of ['dashboard', 'picks', 'grid', 'recaps', 'rules', 'payments', 'manager']) {
      expect(resolveStandingsAlias(t)).toEqual({ tab: t, scope: 'season' });
    }
  });
});

describe('the dashboard offers ONE tab and still accepts the old URL', () => {
  const dash = () => read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');

  it('has no Results button in the tab strip', () => {
    // The whole point of the ticket. `setActiveTab('results')` was the strip's
    // only caller; the value survives as a URL alias, not as a button.
    expect(dash()).not.toContain("setActiveTab('results')");
  });

  it('renames the surviving tab so it says what it now contains', () => {
    expect(dash()).toContain('Standings & Results');
  });

  it('normalizes the alias before anything downstream reads the tab', () => {
    expect(dash()).toContain('resolveStandingsAlias(resolvedTab)');
  });

  it('keeps `results` VALID so the alias has something to normalize', () => {
    // Dropping it from VALID_TABS would send a shared link to the dashboard
    // instead — the exact fallback Survivor still needs and nobody else does.
    expect(dash()).toContain("const VALID_TABS: TabType[] = ['dashboard', 'picks', 'grid', 'standings', 'results', 'recaps', 'rules', 'payments', 'manager'];");
  });

  it('does NOT publish `results` to Help — an alias is not a screen', () => {
    expect(dash()).toContain("VALID_TABS.filter(t => t !== 'results' && tabOffered[t])");
  });

  it('renders the merged tab, and no longer renders NFLResults directly', () => {
    const src = dash();
    expect(src).toContain('<NFLStandingsTab');
    expect(src).not.toContain("from './NFLResults'");
  });
});

describe('the season segment reads as a season', () => {
  const standings = () => read('src/components/NFLPoolDashboard/NFLStandings.tsx');

  it('hides the week-scoped columns behind `seasonOnly`', () => {
    const src = standings();
    // The week's pick / completeness column, for Pick'em AND Margin.
    expect(src.match(/\{!seasonOnly && <th/g) ?? []).toHaveLength(2);
    // The week's tiebreaker guess.
    expect(src).toContain('{!seasonOnly && showTiebreakerColumn && <th');
  });

  it('drops the week row-expand there too, rather than leaving an inert row button', () => {
    const src = standings();
    expect(src).toContain("role={seasonOnly ? undefined : 'button'}");
    expect(src).toContain('{isOpen && !seasonOnly && (');
  });

  it('states its scope in the header', () => {
    expect(standings()).toContain("seasonOnly ? 'Season Standings' : 'Standings Leaderboard'");
  });
});

describe('the week segment is the same tested Results table, controlled', () => {
  const results = () => read('src/components/NFLPoolDashboard/NFLResults.tsx');

  it('takes a controlled view and hides its own toggle when it gets one', () => {
    const src = results();
    expect(src).toContain('view: controlledView');
    expect(src).toContain('const view: ResultsView = controlledView ?? ownView;');
    expect(src).toContain('{controlledView ? (');
  });

  it('names the scope in the heading so a screenshot explains itself', () => {
    expect(results()).toContain('${nflWeekLabel(seasonType, week)} Results');
  });

  it('keeps the row-expand pick reveal — it moved tabs, it did not go away', () => {
    expect(results()).toContain('<EntryWeekPicks');
  });
});

describe('Survivor is untouched', () => {
  it('gets the single table with no scope control', () => {
    const src = read('src/components/NFLPoolDashboard/NFLStandingsTab.tsx');
    expect(src).toContain("const isSurvivor = pool.type === 'NFL_SURVIVOR';");
    // The early return is BEFORE the segment control is built, so a Survivor
    // pool cannot render one.
    const earlyReturn = src.indexOf('if (isSurvivor) {');
    const segments = src.indexOf('const segments:');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(earlyReturn).toBeLessThan(segments);
  });
});
