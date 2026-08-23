/**
 * T10 (Kevin, 2026-08-23) — Standings and Results are ONE tab.
 *
 * Kevin's report: "I see the Standings & Leaderboard and Results tab is correct
 * in the Survivor pools, but not in any of the other NFL pools." Survivor has
 * always shown a single Standings tab; Pick'em and Margin showed two, with
 * overlapping names and the scope split across both.
 *
 * `results` therefore stops being a TAB and becomes a URL ALIAS. It stays a
 * valid `?tab=` value on purpose: shared links, Help links and browser history
 * from before the merge must LAND on the week view, not fall back to the
 * dashboard. This is the same reasoning that keeps `results` in the dashboard's
 * `VALID_TABS`, one layer up.
 *
 * Pure and exported so the mapping can be tested without mounting a 1,200-line
 * dashboard.
 */
export type StandingsScope = 'season' | 'week' | 'summary';

export function resolveStandingsAlias<T extends string>(
  tab: T,
): { tab: Exclude<T, 'results'> | 'standings'; scope: StandingsScope } {
  if (tab === 'results') return { tab: 'standings', scope: 'week' };
  return { tab: tab as Exclude<T, 'results'>, scope: 'season' };
}
