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

/**
 * The same subscription, plus the `loaded` discriminator.
 *
 * `byGame` alone cannot tell "the snapshot has not arrived" from "the snapshot
 * arrived and nobody in any pool has picked this game" — both are `{}`. A pick
 * ROW does not care (it renders nothing either way), but a card whose whole job
 * is to state the split must not print "No picks yet" over data it does not have
 * yet. That is the same substitute-for-unavailable-data rule the pool-scoped card
 * already follows.
 *
 * ⚠️ `loaded` goes true on the first callback, and `subscribeToSiteConsensus`
 * reports a read FAILURE by calling back with `{}` — so a permission error and an
 * empty week are indistinguishable here, exactly as they are on the pool-scoped
 * path. Narrowing that means changing the subscription's error contract, which
 * every consensus reader shares.
 */
export function useSiteConsensusState(
  pool: any,
  week: number,
): { byGame: Record<string, GameConsensus>; loaded: boolean } {
  const [state, setState] = useState<{ byGame: Record<string, GameConsensus>; loaded: boolean }>({
    byGame: {},
    loaded: false,
  });
  const season = String(pool?.season ?? '');
  const seasonType = poolSeasonType(pool);
  const poolType = pool?.type;

  useEffect(() => {
    // No season or no pool type means there is no projection to subscribe to and
    // none is coming, so this stays un-loaded rather than claiming an empty week.
    if (!season || !poolType) {
      setState({ byGame: {}, loaded: false });
      return;
    }
    // A week change must not leave the previous week's splits — or its `loaded` —
    // on screen while the new week's snapshot is still in flight.
    setState({ byGame: {}, loaded: false });
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
      setState({ byGame: out, loaded: true });
    });
  }, [season, seasonType, week, poolType]);

  return state;
}

export function useSiteConsensus(pool: any, week: number): Record<string, GameConsensus> {
  return useSiteConsensusState(pool, week).byGame;
}
