// Pick-consensus aggregation (ADR 0004). Produces, per game:
//   - Pool Consensus:  pools/{poolId}/consensus/{gameId}   (pool members read; post-lock only)
//   - Site-Wide Consensus: consensus/{season}_{seasonType}_{week}/{poolType}/{gameId}
//                          (world-readable aggregate; published only after kickoff)
// Both are SERVER aggregates — clients never read other members' raw entries (closes the
// pre-lock pick-visibility leak). A game's picks are counted for a pool only once that pool's
// effectiveGameLockAt has passed, so an extended (override) pool never leaks while still open.
//
// v1 does a bounded per-week full recompute (idempotent — overwrites, no hot-doc increments).
// Scale-up path: persist per-pool shards and roll them up incrementally instead of recomputing.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { tallyGameConsensus, mergeTally, consensusPct, type ConsensusGame, type GameTally } from "./shared/consensus";
import { isActivePoolForStats } from "./lib/poolInclusion";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";

type Firestore = admin.firestore.Firestore;

const toConsensusGame = (g: any): ConsensusGame => ({
  id: g.id,
  week: g.week,
  awayAbbr: g.awayTeam?.abbreviation || '',
  awayName: g.awayTeam?.name,
  homeAbbr: g.homeTeam?.abbreviation || '',
  homeName: g.homeTeam?.name,
});

const projDoc = (t: GameTally, cg: ConsensusGame) => {
  const pct = consensusPct(t);
  return {
    gameId: cg.id, awayAbbr: cg.awayAbbr, homeAbbr: cg.homeAbbr,
    away: t.away, home: t.home, total: t.total,
    awayPct: pct?.awayPct ?? null, homePct: pct?.homePct ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
};

/** Recompute pool + site-wide consensus for one (season, seasonType, week). Idempotent. */
export async function recomputeWeekConsensus(
  db: Firestore, season: string, seasonType: number, week: number, now: number,
): Promise<{ games: number; pools: number; published: number }> {
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', season).where('seasonType', '==', seasonType).where('week', '==', week).get();
  const games = gamesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  if (games.length === 0) return { games: 0, pools: 0, published: 0 };
  const cgById = new Map<string, ConsensusGame>(games.map(g => [g.id, toConsensusGame(g)]));

  // Site-wide accumulator: type -> gameId -> tally
  const site: Record<string, Map<string, GameTally>> = {};
  for (const t of NFL_SEASON_TYPES) site[t] = new Map();

  // Gather NFL-season pools of this season, three type queries (no `in` on inequality mix).
  let poolCount = 0;
  for (const type of NFL_SEASON_TYPES) {
    const poolsSnap = await db.collection('pools').where('type', '==', type).where('season', '==', season).get();
    for (const poolDoc of poolsSnap.docs) {
      const pool: any = poolDoc.data();
      if (!isActivePoolForStats(pool, poolDoc.id)) continue;
      poolCount++;
      const entriesSnap = await poolDoc.ref.collection('entries').get();
      const entries = entriesSnap.docs.map(e => e.data());
      const batch = db.batch();
      for (const g of games) {
        // Fully-open live consensus: pool picks are counted as they're submitted (no pre-lock
        // gate). Product decision 2026-07-09 — reveal the crowd's split live rather than at
        // kickoff. ponytail: full-week recompute per submit is the ceiling; shard per ADR 0004
        // if pool count grows.
        const cg = cgById.get(g.id)!;
        const tally = tallyGameConsensus(entries, cg, type);
        // Pool consensus doc (members read; post-lock only)
        batch.set(poolDoc.ref.collection('consensus').doc(g.id), projDoc(tally, cg), { merge: true });
        site[type].set(g.id, mergeTally(site[type].get(g.id) || { away: 0, home: 0, total: 0 }, tally));
      }
      await batch.commit();
    }
  }

  // Publish site-wide per type. Fully-open live consensus (product decision 2026-07-09):
  // publish as soon as picks are tallied, not gated on kickoff.
  const key = `${season}_${seasonType}_${week}`;
  let published = 0;
  for (const type of NFL_SEASON_TYPES) {
    const batch = db.batch();
    for (const [gameId, tally] of site[type]) {
      const cg = cgById.get(gameId)!;
      batch.set(db.collection('consensus').doc(key).collection(type).doc(gameId), projDoc(tally, cg), { merge: true });
      published++;
    }
    await batch.commit();
  }
  return { games: games.length, pools: poolCount, published };
}

/** Distinct (season,seasonType,week) among games in the active window, so we bound the work. */
async function activeWeeks(db: Firestore, now: number): Promise<{ season: string; seasonType: number; week: number }[]> {
  const snap = await db.collection('nfl_games')
    .where('startTime', '>=', now - 24 * 60 * 60 * 1000)
    .where('startTime', '<=', now + 6 * 60 * 60 * 1000).get();
  const seen = new Map<string, { season: string; seasonType: number; week: number }>();
  snap.forEach(d => {
    const g: any = d.data();
    const k = `${g.season}_${g.seasonType}_${g.week}`;
    if (!seen.has(k)) seen.set(k, { season: g.season, seasonType: g.seasonType, week: g.week });
  });
  return [...seen.values()];
}

/** Scheduled: refresh consensus for weeks in the active window every 10 minutes. */
export const consensusRefreshJob = onSchedule('*/10 * * * *', async () => {
  const db = admin.firestore();
  const now = Date.now();
  for (const w of await activeWeeks(db, now)) {
    try {
      const r = await recomputeWeekConsensus(db, w.season, w.seasonType, w.week, now);
      console.log(`[consensus] ${w.season}/${w.seasonType}/wk${w.week}: ${r.pools} pools, ${r.published} published`);
    } catch (e) {
      console.error(`[consensus] failed for ${w.season}/${w.seasonType}/wk${w.week}:`, e);
    }
  }
});

/** On-demand recompute (SUPER_ADMIN) for testing / manual refresh. */
export const recomputeConsensus = onCall(async (request) => {
  if (!request.auth || request.auth.token?.role !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
  const { season, seasonType, week } = request.data || {};
  if (!season || seasonType === undefined || week === undefined) {
    throw new HttpsError('invalid-argument', 'season, seasonType, week required.');
  }
  return recomputeWeekConsensus(admin.firestore(), String(season), Number(seasonType), Number(week), Date.now());
});
