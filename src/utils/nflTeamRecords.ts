/**
 * Team W-L(-T) records derived from the `nfl_games` the client already holds.
 *
 * Nothing in Firestore stores an NFL team record — `nfl_games` docs carry
 * per-game scores and status only — so the record is computed from FINAL games.
 * The pool dashboard already subscribes to the whole season's games
 * (`subscribeToNFLGames`), which makes this a pure fold over data in hand: no
 * new query, no new read path, nothing to deploy beyond the frontend.
 *
 * Records are scoped to ONE seasonType, deliberately. Preseason results do not
 * carry into the regular season, and a pool only ever shows games from its own
 * seasonType (`gamesForPoolWeek`), so mixing types would show a Week 1
 * regular-season matchup with preseason wins baked in. HOF weekend therefore
 * correctly shows `0-0` everywhere — the season's first game has no history.
 */

import type { NFLGame } from '../types';

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
}

/**
 * Fold FINAL games of one seasonType into per-team records, keyed by team
 * abbreviation (the same key every pick surface uses).
 *
 * Only `status === 'FINAL'` counts. IN_PROGRESS scores are not results, and
 * CANCELLED games never produced one. A FINAL game with a missing `scores`
 * object is skipped rather than guessed at — no record beats a wrong record.
 */
export function computeTeamRecords(
  games: NFLGame[],
  seasonType: number,
): Map<string, TeamRecord> {
  const records = new Map<string, TeamRecord>();
  const get = (abbr: string): TeamRecord => {
    let r = records.get(abbr);
    if (!r) {
      r = { wins: 0, losses: 0, ties: 0 };
      records.set(abbr, r);
    }
    return r;
  };

  for (const g of games) {
    if (Number(g.seasonType) !== Number(seasonType)) continue;
    if (g.status !== 'FINAL') continue;
    const home = g.homeTeam?.abbreviation;
    const away = g.awayTeam?.abbreviation;
    const hs = g.scores?.home;
    const as = g.scores?.away;
    if (!home || !away || typeof hs !== 'number' || typeof as !== 'number') continue;

    if (hs > as) {
      get(home).wins++;
      get(away).losses++;
    } else if (as > hs) {
      get(away).wins++;
      get(home).losses++;
    } else {
      get(home).ties++;
      get(away).ties++;
    }
  }
  return records;
}

/**
 * "0-0", "2-1", "1-1-1". Ties are omitted when zero — that is how the league
 * itself writes records. An unknown team (no map entry) is a true 0-0.
 */
export function formatTeamRecord(record: TeamRecord | undefined): string {
  const r = record ?? { wins: 0, losses: 0, ties: 0 };
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}
