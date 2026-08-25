// Pure Player Profile projection builder (ADR 0005 / PLAN-PLAYER-PROFILES Phase 5).
// Separated from the Firestore-facing recompute so the aggregation math — bucketing,
// leak rules, profit reconciliation — is unit-testable without an emulator.
//
// LEAK INVARIANT: the returned PublicProfile carries ZERO pool identifiers. Inputs
// carry poolId/poolName for the caller's bookkeeping (and the viewer-gated detail
// callable), but nothing here copies them into the public doc.
import {
  PROFILE_SCHEMA_VERSION,
  PICK_HISTORY_CAP,
  type PublicProfile,
  type SubjectKind,
  type ProfileWeeklyRow,
  type ProfileYearlyRow,
  type ProfileTeamBucket,
  type ProfileTeamRow,
  type ProfilePickHistoryRow,
  type ProfileProfit,
  type NFLPickMode,
} from '../shared/profile';

export type ProfileNFLPoolType = 'NFL_PICKEM' | 'NFL_SURVIVOR' | 'NFL_MARGIN';

export interface ProfilePoolInput {
  poolId: string; // NOT published
  poolName: string; // NOT published
  poolType: ProfileNFLPoolType;
  pickMode?: NFLPickMode; // Pickem only
  season: string;
  /**
   * The ENTRY this input is about (PLAN-MULTI-ENTRY D9) — one input per entry
   * the subject owns in the pool. NOT published: it embeds a uid.
   */
  entryId?: string;
  /** The entry's own name, when it has one. NOT published. */
  entryName?: string;
  /**
   * 🛑 IS THIS THE INPUT THE POOL'S MONEY AND PARTICIPATION ARE COUNTED FROM?
   *
   * Absent ⇒ true, so every pre-multi-entry caller (and every test) is
   * unchanged. Exactly ONE of a subject's inputs for a given pool may carry
   * `true`: `feeOwed` is the Member Record's already-multiplied figure (D2) and
   * `awardsWon` reduces Payout Records by uid, so counting either per entry
   * would double a two-entry player's fees AND their winnings — a profit line
   * that is wrong in both directions at once.
   *
   * Everything else on the input — weeks, picks, team tallies, `finalRank` —
   * is genuinely per entry and IS counted every time.
   */
  primaryEntry?: boolean;
  /** The subject's entry doc (weeklyResults et al). */
  entry: Record<string, any>;
  /** From users/{uid}/seasonHistory/{docId} for THIS entry, when finalized. */
  finalRank?: { rank: number; totalEntries: number } | null;
  /** Sum of this subject's non-superseded award amounts in this pool. */
  awardsWon: number;
  /** Member Record base dues (feeOwed + rebuyOwed). */
  feeOwed: number;
  feeEstimated: boolean;
  finalized: boolean;
  payoutsRecorded: boolean;
}

interface TeamTally { wins: number; losses: number; pushes: number }

function tally(map: Map<string, TeamTally>, team: string, outcome: 'W' | 'L' | 'PUSH'): void {
  const t = map.get(team) || { wins: 0, losses: 0, pushes: 0 };
  if (outcome === 'W') t.wins++;
  else if (outcome === 'L') t.losses++;
  else t.pushes++;
  map.set(team, t);
}

function toTeamRows(map: Map<string, TeamTally>): ProfileTeamRow[] {
  return [...map.entries()]
    .map(([team, t]) => ({
      team,
      wins: t.wins,
      losses: t.losses,
      pushes: t.pushes,
      accuracy: t.wins + t.losses > 0 ? Math.round((t.wins / (t.wins + t.losses)) * 100) : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy || b.wins - a.wins || a.team.localeCompare(b.team));
}

export function buildPublicProfile(
  uid: string,
  userName: string,
  subjectKind: SubjectKind,
  pools: ProfilePoolInput[],
): PublicProfile {
  // weekly: aggregated ACROSS pools per (season, week) — no pool identifiers.
  const weeklyMap = new Map<string, ProfileWeeklyRow>();
  // teamByTeam buckets per (poolType, pickMode) — never blended.
  const buckets = new Map<string, Map<string, TeamTally>>();
  const pickHistory: ProfilePickHistoryRow[] = [];
  const seasons = new Set<string>();
  // yearly accumulators
  const yearAgg = new Map<string, { correct: number; total: number; won: number; fees: number; anyRecorded: boolean; best: { rank: number; totalEntries: number } | null }>();

  let correct = 0, total = 0, points = 0;
  let won = 0, feesOwed = 0, pendingPayouts = 0;
  let feesEstimated = false;

  for (const p of pools) {
    seasons.add(p.season);
    // PLAN-MULTI-ENTRY D9 — the pool's MONEY is counted once per member, its
    // PLAY once per entry. See `primaryEntry`.
    const countsMoney = p.primaryEntry !== false;
    const year = yearAgg.get(p.season) || { correct: 0, total: 0, won: 0, fees: 0, anyRecorded: false, best: null };
    if (countsMoney) {
      year.won += p.awardsWon;
      year.fees += p.feeOwed;
    }
    if (p.payoutsRecorded) year.anyRecorded = true;
    // Best finish IS per entry: a player's second entry finishing 1st is a
    // first-place finish, and `Math.min` over both is the honest answer.
    if (p.finalRank && (!year.best || p.finalRank.rank < year.best.rank)) year.best = p.finalRank;
    yearAgg.set(p.season, year);

    if (countsMoney) {
      won += p.awardsWon;
      feesOwed += p.feeOwed;
      // Counts POOLS awaiting a payout record, so it follows the money.
      if (p.finalized && !p.payoutsRecorded) pendingPayouts++;
      if (p.feeEstimated) feesEstimated = true;
    }

    const wr: Record<string, any> = p.entry?.weeklyResults || {};
    const bucketKey = `${p.poolType}|${p.pickMode ?? ''}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
    const bucket = buckets.get(bucketKey)!;

    for (const wk of Object.keys(wr)) {
      const week = Number(wk);
      const r = wr[wk];

      if (p.poolType === 'NFL_PICKEM') {
        const key = `${p.season}|${week}`;
        const row = weeklyMap.get(key) || { season: p.season, week, correct: 0, total: 0, points: 0 };
        row.correct += r.correct || 0;
        row.total += r.total || 0;
        row.points += r.points || 0;
        weeklyMap.set(key, row);
        correct += r.correct || 0;
        total += r.total || 0;
        points += r.points || 0;

        for (const [gameId, g] of Object.entries<Record<string, any>>(r.games || {})) {
          if (g.result === 'W' || g.result === 'L' || g.result === 'PUSH') tally(bucket, g.pick, g.result);
          pickHistory.push({
            season: p.season, week, gameId,
            awayAbbr: g.away || '', homeAbbr: g.home || '',
            pick: g.pick, result: g.result,
            poolType: p.poolType, pickMode: p.pickMode,
          });
        }
      } else if (p.poolType === 'NFL_SURVIVOR') {
        const g = r.game;
        if (g) {
          if (g.result === 'SURVIVED') tally(bucket, g.pick, 'W');
          else if (g.result === 'STRUCK') tally(bucket, g.pick, 'L');
          pickHistory.push({
            season: p.season, week, gameId: g.gameId,
            awayAbbr: '', homeAbbr: '',
            pick: g.pick, result: g.result,
            poolType: p.poolType,
          });
        }
      } else if (p.poolType === 'NFL_MARGIN') {
        const g = r.game;
        if (g) {
          const outcome = g.net > 0 ? 'W' : g.net < 0 ? 'L' : 'PUSH';
          tally(bucket, g.pick, outcome);
          pickHistory.push({
            season: p.season, week, gameId: g.gameId,
            awayAbbr: '', homeAbbr: '',
            pick: g.pick, result: outcome, net: g.net,
            poolType: p.poolType,
          });
        }
      }
    }
  }

  const weekly = [...weeklyMap.values()]
    .sort((a, b) => (a.season === b.season ? a.week - b.week : a.season.localeCompare(b.season)));

  const yearly: ProfileYearlyRow[] = [...yearAgg.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([season, y]) => ({
      season,
      correct: y.correct,
      total: y.total,
      accuracy: y.total > 0 ? Math.round((y.correct / y.total) * 100) : 0,
      profitNet: y.anyRecorded ? y.won - y.fees : null,
      bestFinish: y.best,
    }));
  // yearly W-L is Pickem-scoped, summed from the weekly rows per season
  for (const row of weekly) {
    const y = yearly.find(yy => yy.season === row.season);
    if (y) { y.correct += row.correct; y.total += row.total; }
  }
  for (const y of yearly) y.accuracy = y.total > 0 ? Math.round((y.correct / y.total) * 100) : 0;

  const teamByTeam: ProfileTeamBucket[] = [...buckets.entries()]
    .filter(([, m]) => m.size > 0)
    .map(([key, m]) => {
      const [poolType, mode] = key.split('|');
      return {
        poolType: poolType as ProfileNFLPoolType,
        ...(mode ? { pickMode: mode as NFLPickMode } : {}),
        teams: toTeamRows(m),
      };
    });

  pickHistory.sort((a, b) =>
    b.season.localeCompare(a.season) || b.week - a.week || a.gameId.localeCompare(b.gameId));

  const profit: ProfileProfit | null = subjectKind === 'EXPERT' ? null : {
    won,
    feesOwed,
    net: won - feesOwed,
    poolsPendingPayouts: pendingPayouts,
    feesEstimated,
  };

  return {
    uid,
    subjectKind,
    userName,
    overall: {
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      correct, total, points,
      // 🛑 DISTINCT POOLS, NOT INPUTS (PLAN-MULTI-ENTRY D9). There is now one
      // input per ENTRY, so `pools.length` would report a two-entry player as
      // having entered two pools when they entered one — and the label on the
      // profile card literally reads "Pools Entered".
      poolsEntered: new Set(pools.map(p => p.poolId)).size,
      seasonsPlayed: seasons.size,
    },
    weekly,
    yearly,
    teamByTeam,
    pickHistory: pickHistory.slice(0, PICK_HISTORY_CAP),
    profit,
    schemaVersion: PROFILE_SCHEMA_VERSION,
  };
}
