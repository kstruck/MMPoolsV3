import type { NFLGame } from '../types';

/**
 * The `picks` map a commissioner proxy pick has to send, per pool type.
 *
 * THE DEFECT THIS EXISTS FOR. `proxyPick` takes one `picks` record and the
 * three NFL types key it two different ways:
 *
 *  - **Survivor and Margin** key by WEEK. The callable reads
 *    `picks[weekNum]` and has always worked.
 *  - **Pick'em** keys by GAME ID. The callable looks every key up in that
 *    week's schedule (`poolExceptions.ts`, the `NFL_PICKEM` branch) and throws
 *    `invalid-argument` on a miss.
 *
 * `NFLManagerView` sent `{ [week]: team }` for all three, so the Pick'em proxy
 * pick has NEVER worked — it failed with *"Game 3 not found in week 3"*, which
 * reads like a schedule problem rather than a payload one.
 *
 * The shapes live here rather than inline in the component so the mapping can
 * be tested without rendering an 1800-line manager surface, and so the two
 * shapes are stated once, side by side, where a future third type has to
 * choose between them.
 */

/** Team abbreviation → the ids of the games it plays that week. */
export type ProxyTeamGameIndex = ReadonlyMap<string, readonly string[]>;

/**
 * Which games each team plays in a week's slate.
 *
 * A LIST per team, not a single id, and that is the point. A team plays once a
 * week and this map should therefore always hold exactly one id — but
 * `gamesForPoolWeek` filters a pool-wide array on `week` and `seasonType`, and
 * a duplicated fixture, a mis-imported schedule, or a re-keyed game would put
 * two entries under one team. Collapsing to a single id here would pick one
 * silently and send a pick for a game the commissioner never looked at.
 * `proxyPickPayload` refuses that case instead.
 */
export function buildProxyTeamGameIndex(games: readonly NFLGame[]): Map<string, readonly string[]> {
  const index = new Map<string, string[]>();
  const add = (team: string | undefined, gameId: string) => {
    if (!team) return;
    const existing = index.get(team);
    if (existing) {
      // Same game listed twice is not a conflict — it is one game.
      if (!existing.includes(gameId)) existing.push(gameId);
      return;
    }
    index.set(team, [gameId]);
  };
  for (const g of games) {
    const gameId = String(g.id);
    add(g.homeTeam?.abbreviation, gameId);
    add(g.awayTeam?.abbreviation, gameId);
  }
  return index;
}

/** The teams to offer in the proxy-pick dropdown, alphabetical. */
export function proxyTeamOptions(index: ProxyTeamGameIndex): string[] {
  return [...index.keys()].sort();
}

export type ProxyPickPayload =
  | { picks: Record<string | number, string> }
  | { error: string };

/**
 * The `picks` map to send for one team, or the reason it cannot be built.
 *
 * Pick'em resolves the team to the game it is playing in; Survivor and Margin
 * keep the week-keyed shape they already had, unchanged. An unknown pool type
 * takes the week-keyed branch, which is what every non-Pick'em NFL type has
 * always done.
 */
export function proxyPickPayload(
  poolType: string | undefined,
  week: number | string,
  team: string,
  index: ProxyTeamGameIndex,
): ProxyPickPayload {
  if (poolType !== 'NFL_PICKEM') return { picks: { [week]: team } };

  const gameIds = index.get(team);
  if (!gameIds || gameIds.length === 0) {
    // Reachable if the schedule changes under an open dropdown.
    return { error: `${team} is not playing in week ${week}. Reload the page and pick again.` };
  }
  if (gameIds.length > 1) {
    // The assertion, made out loud. Sending one of them would look like it
    // worked and record a pick against a game nobody chose.
    return {
      error: `${team} appears in ${gameIds.length} games in week ${week}, so there is no single game to record this pick against. Check the week's schedule before proxying.`,
    };
  }
  return { picks: { [gameIds[0]]: team } };
}
