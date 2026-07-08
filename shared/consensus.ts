// Pure pick-consensus tally — shared by functions/ (server aggregation) and any client
// preview. "Consensus" = of the players who picked a game, the share on each team. Framework-free.
// See ADR 0004: consensus is computed server-side and published only post-lock; this file is
// just the counting math.

export interface ConsensusGame {
  id: string;
  week: number;
  awayAbbr: string;
  awayName?: string;
  homeAbbr: string;
  homeName?: string;
}

export interface GameTally {
  away: number;
  home: number;
  total: number; // away + home (picks that matched a team in this game)
}

const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toUpperCase() : '');

/** Which side of a game a pick took, or null if it doesn't match either team. */
export function matchSide(pick: unknown, game: ConsensusGame): 'away' | 'home' | null {
  const p = norm(pick);
  if (!p) return null;
  if (p === norm(game.awayAbbr) || p === norm(game.awayName)) return 'away';
  if (p === norm(game.homeAbbr) || p === norm(game.homeName)) return 'home';
  return null;
}

/** Extract a player's pick for a game from their entry, per pool type. */
export function pickForGame(entry: any, game: ConsensusGame, poolType: string): unknown {
  const picks = entry?.picks;
  if (!picks) return undefined;
  // Pick'em stores picks keyed by gameId; survivor/margin store one team per week.
  return poolType === 'NFL_PICKEM' ? picks[game.id] : picks[game.week];
}

/** Tally one game's consensus across a set of entries. */
export function tallyGameConsensus(entries: any[], game: ConsensusGame, poolType: string): GameTally {
  let away = 0;
  let home = 0;
  for (const e of entries) {
    const side = matchSide(pickForGame(e, game, poolType), game);
    if (side === 'away') away++;
    else if (side === 'home') home++;
  }
  return { away, home, total: away + home };
}

/** Merge two tallies (for rolling pool shards into a site-wide total). */
export function mergeTally(a: GameTally, b: GameTally): GameTally {
  return { away: a.away + b.away, home: a.home + b.home, total: a.total + b.total };
}

/** Percentages (rounded) for display; null when nobody has picked yet. */
export function consensusPct(t: GameTally): { awayPct: number; homePct: number } | null {
  if (t.total <= 0) return null;
  const awayPct = Math.round((t.away / t.total) * 100);
  return { awayPct, homePct: 100 - awayPct };
}
