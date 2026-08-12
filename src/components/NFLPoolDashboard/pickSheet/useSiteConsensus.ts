import { useEffect, useState } from 'react';
import { dbService } from '../../../services/dbService';
import { poolSeasonType } from '../../../utils/nflPending';

/**
 * Site-wide pick percentages for one pool's week, keyed by game id.
 *
 * ADR 0004's Site-Wide Consensus: an aggregate across every pool of this type —
 * counts only, never who picked what. Kevin's testers asked for the CBS-style
 * "what did everyone else take" number on the pick row, and this is the
 * projection that already answers it (`consensus/{season}_{type}_{week}/{poolType}`).
 *
 * 🔨 It is shown LIVE, with no lock gate. Kevin's ruling 2026-08-11
 * (`PLAN-COMMISSIONER-BLIND-PICKS` Q4): the live consensus is visible at all
 * times and is never hidden. An aggregate cannot express an individual's pick,
 * which is the thing the blind-picks work protects.
 *
 * Returns `{}` until the subscription delivers, and a game absent from the map
 * means "no aggregate yet" — which callers must render as nothing at all, not as
 * 0%. Nobody having picked and the projection not having been written are
 * different facts.
 */
export interface GameConsensus {
  awayPct: number;
  homePct: number;
  total: number;
}

export function useSiteConsensus(pool: any, week: number): Record<string, GameConsensus> {
  const [byGame, setByGame] = useState<Record<string, GameConsensus>>({});
  const season = String(pool?.season ?? '');
  const seasonType = poolSeasonType(pool);
  const poolType = pool?.type;

  useEffect(() => {
    if (!season || !poolType) return;
    setByGame({});   // a week change must not leave the previous week's splits on screen
    return dbService.subscribeToSiteConsensus(season, seasonType, week, poolType, (raw) => {
      const out: Record<string, GameConsensus> = {};
      for (const [gameId, v] of Object.entries(raw || {})) {
        const d = v as { awayPct?: number; homePct?: number; total?: number };
        // A projection row with no picks in it carries no percentages worth
        // showing; skip it so the caller renders nothing rather than "0%".
        if (typeof d?.total !== 'number' || d.total <= 0) continue;
        if (typeof d.awayPct !== 'number' || typeof d.homePct !== 'number') continue;
        out[gameId] = { awayPct: d.awayPct, homePct: d.homePct, total: d.total };
      }
      setByGame(out);
    });
  }, [season, seasonType, week, poolType]);

  return byGame;
}
