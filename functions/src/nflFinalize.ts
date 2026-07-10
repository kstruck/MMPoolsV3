import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";
import { sortMarginLeaderboard } from "./nflScoringEngine";
import { recomputeUserProfile } from "./userProfile";
import { writeAdminAudit } from "./lib/adminAudit";
import type { NFLPickemEntry, SurvivorEntry, MarginEntry } from "./nflPoolTypes";

/**
 * Season Finalization (ADR 0005 decision 2 / PLAN-PLAYER-PROFILES Phase 3).
 *
 * When an NFL pool's season is COMPLETE (every game of its season/seasonType is
 * FINAL or CANCELLED, and every week that has games appears in pool.scoredWeeks),
 * the server settles competitive results with no human in the loop:
 *   - users/{uid}/seasonHistory/{poolId} for every member WITH a playable entry
 *     (roster-only members and pick-less commissioners get no competitive history)
 *   - pool.firstFinalizedAt (audit metadata, written once)
 *   - pool.finalizedAt (last successful run — the staleness key vs lastScoredAt)
 *
 * Finalization is a RE-RUNNABLE OVERWRITE, not a one-shot: a rescore of a
 * completed pool re-derives ranks and overwrites seasonHistory (ADR 0004
 * re-derive principle). Distinct from admin close, which stays stats-free.
 * Money is NOT touched here — payouts are a separate Commissioner action
 * (Phase 4); the platform never computes a payout nobody recorded.
 */

interface FinalizeOutcome {
  finalized: boolean;
  reason?: string;
  members?: number;
}

/** Every game concluded + every game-bearing week scored. */
async function isSeasonComplete(db: Firestore, pool: any): Promise<{ complete: boolean; reason?: string }> {
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', pool.season)
    .where('seasonType', '==', Number(pool.seasonType || 2))
    .get();
  if (gamesSnap.empty) return { complete: false, reason: 'no games for season' };

  const scoredWeeks: Record<string, boolean> = pool.scoredWeeks || {};
  const unfinishedGames: string[] = [];
  const unscoredWeeks = new Set<number>();
  for (const doc of gamesSnap.docs) {
    const g = doc.data() as any;
    if (g.status !== 'FINAL' && g.status !== 'CANCELLED') unfinishedGames.push(doc.id);
    if (!scoredWeeks[String(g.week)]) unscoredWeeks.add(Number(g.week));
  }
  if (unfinishedGames.length > 0) return { complete: false, reason: `${unfinishedGames.length} games not concluded` };
  if (unscoredWeeks.size > 0) return { complete: false, reason: `weeks not scored: ${[...unscoredWeeks].sort((a, b) => a - b).join(',')}` };
  return { complete: true };
}

/** Competition ranking (ties share a rank) over a desc-sorted score list. */
function competitionRanks<T>(sorted: T[], scoreOf: (e: T) => number): Map<T, number> {
  const ranks = new Map<T, number>();
  sorted.forEach((e, idx) => {
    const prev = idx > 0 ? sorted[idx - 1] : null;
    ranks.set(e, prev && scoreOf(e) === scoreOf(prev) ? (ranks.get(prev) as number) : idx + 1);
  });
  return ranks;
}

/**
 * Final ranks + type-specific record per entry. Pure given the entries array.
 * - Pickem: totalScore desc, ties share rank
 * - Survivor: ALIVE entries rank 1 (co-champions), then eliminated by
 *   eliminatedWeek desc (lasted longer = better), strikes asc as tiebreak
 * - Margin: the existing 5-level sortMarginLeaderboard cascade, ties do not share
 *   (the cascade is deterministic through uid)
 */
export function computeFinalRanks(
  poolType: string,
  entries: any[],
): Array<{ entry: any; rank: number; record: Record<string, number | boolean | null>; points: number | null }> {
  if (poolType === 'NFL_PICKEM') {
    const sorted = [...entries].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    const ranks = competitionRanks(sorted, e => e.totalScore || 0);
    return sorted.map(e => {
      const wr = Object.values((e as NFLPickemEntry).weeklyResults || {}) as Array<{ correct?: number; total?: number }>;
      const correct = wr.reduce((s, w) => s + (w.correct || 0), 0);
      const total = wr.reduce((s, w) => s + (w.total || 0), 0);
      return { entry: e, rank: ranks.get(e) as number, record: { correct, total }, points: e.totalScore || 0 };
    });
  }
  if (poolType === 'NFL_SURVIVOR') {
    const alive = entries.filter(e => (e as SurvivorEntry).status !== 'ELIMINATED');
    const out = [...entries.filter(e => (e as SurvivorEntry).status === 'ELIMINATED')]
      .sort((a, b) =>
        (b.eliminatedWeek || 0) - (a.eliminatedWeek || 0) ||
        (a.strikesUsed || 0) - (b.strikesUsed || 0) ||
        String(a.ownerUid).localeCompare(String(b.ownerUid)));
    const rows: Array<{ entry: any; rank: number; record: Record<string, number | boolean | null>; points: number | null }> = [];
    for (const e of alive) {
      rows.push({ entry: e, rank: 1, record: recordOfSurvivor(e), points: null });
    }
    let rank = alive.length + 1;
    let prev: any = null;
    for (const e of out) {
      const tied = prev && (e.eliminatedWeek || 0) === (prev.eliminatedWeek || 0) && (e.strikesUsed || 0) === (prev.strikesUsed || 0);
      if (!tied) rank = alive.length + out.indexOf(e) + 1;
      rows.push({ entry: e, rank, record: recordOfSurvivor(e), points: null });
      prev = e;
    }
    return rows;
  }
  if (poolType === 'NFL_MARGIN') {
    const ranked = sortMarginLeaderboard(entries as MarginEntry[]);
    return ranked.map((e, idx) => ({
      entry: e,
      rank: idx + 1,
      record: { seasonTotal: e.seasonTotal ?? 0 },
      points: e.seasonTotal ?? 0,
    }));
  }
  return [];
}

function recordOfSurvivor(e: any): Record<string, number | boolean | null> {
  const wr = Object.values((e as SurvivorEntry).weeklyResults || {}) as Array<{ survived?: boolean }>;
  return {
    survivedWeeks: wr.filter(w => w.survived).length,
    strikes: e.strikesUsed || 0,
    eliminatedWeek: e.eliminatedWeek ?? null,
    alive: e.status !== 'ELIMINATED',
  };
}

/**
 * Finalizes one NFL pool if its season is complete. Re-runnable; safe to call
 * after every scoring pass. Returns what happened for callers/sweep reporting.
 *
 * Test Pools (persisted `simRunId`, or a `sim-` season/doc-id) are refused unless
 * `allowSim` is passed — ONLY the guarded `simFinalizePool` harness callable sets it,
 * so a full-season Sim Run never writes seasonHistory/profile docs as a side effect
 * of inline scoring or the sweep. (PLAN-NFL-SIM-HARNESS Phase 0.2, Codex R1#2/R2#1.)
 */
export function isSimPool(pool: any, poolId?: string): boolean {
  return Boolean(
    pool?.simRunId ||
    String(pool?.season || '').startsWith('sim-') ||
    (poolId || '').startsWith('sim-'),
  );
}

export async function maybeFinalizeNFLPool(
  db: Firestore,
  poolId: string,
  opts?: { allowSim?: boolean },
): Promise<FinalizeOutcome> {
  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) return { finalized: false, reason: 'pool missing' };
  const pool = poolSnap.data() as any;

  if (!NFL_SEASON_TYPES.includes(pool.type)) return { finalized: false, reason: 'not an NFL season pool' };
  if (pool.status === 'CANCELED') return { finalized: false, reason: 'canceled' };
  if (isSimPool(pool, poolId) && !opts?.allowSim) {
    return { finalized: false, reason: 'sim pool (finalize only via simFinalizePool)' };
  }

  const completeness = await isSeasonComplete(db, pool);
  if (!completeness.complete) return { finalized: false, reason: completeness.reason };

  const entriesSnap = await poolRef.collection('entries').get();
  const entries = entriesSnap.docs.map(d => ({ ...(d.data() as any), id: d.id }));
  if (entries.length === 0) return { finalized: false, reason: 'no entries' };

  const ranked = computeFinalRanks(pool.type, entries);
  const season = String(pool.season ?? '');

  let batch = db.batch();
  let ops = 0;
  for (const { entry, rank, record, points } of ranked) {
    if (!entry.ownerUid) continue;
    batch.set(
      db.collection('users').doc(entry.ownerUid).collection('seasonHistory').doc(poolId),
      {
        poolId,
        poolName: pool.name || '',
        poolType: pool.type,
        season,
        finalRank: rank,
        totalEntries: ranked.length,
        record,
        ...(points !== null ? { points } : {}),
        ...(entry.entryName ? { entryName: entry.entryName } : {}),
        isChampion: rank === 1,
        completedAt: Date.now(),
      },
      { merge: true },
    );
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  await poolRef.update({
    finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(pool.firstFinalizedAt ? {} : { firstFinalizedAt: admin.firestore.FieldValue.serverTimestamp() }),
  });

  // Refresh each member's public profile projection (bounded by pool size;
  // best-effort per member so one bad profile never blocks the rest).
  for (const { entry } of ranked) {
    if (!entry.ownerUid) continue;
    try {
      await recomputeUserProfile(db, entry.ownerUid);
    } catch (e) {
      console.warn(`[finalizeNFLPool] profile recompute failed for ${entry.ownerUid}:`, e);
    }
  }

  return { finalized: true, members: ranked.length };
}

const MAX_PER_RUN = 200; // safety cap, mirrors autoClosePools

/**
 * Daily backstop sweep: finalizes season-complete NFL pools that scoreNFLWeek's
 * inline check missed (out-of-order scoring, manual admin scores, transient
 * failures) or whose finalization went stale (finalizedAt < lastScoredAt after
 * a rescore).
 *
 * SAFETY (Rule 1, mmp-change-control): kill-switch
 * system/config.nflFinalize.enabled === true required (default OFF, fail-safe);
 * dry-run by default (nflFinalize.dryRun !== false) — reports what it WOULD
 * finalize to admin_audit, writing nothing, until explicitly flipped.
 */
export const nflFinalizeSweepJob = functions.scheduler.onSchedule(
  { schedule: "every day 08:30", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const db = admin.firestore();

    let enabled = false;
    let dryRun = true;
    try {
      const cfg = (await db.doc("system/config").get()).data()?.nflFinalize as
        | { enabled?: boolean; dryRun?: boolean }
        | undefined;
      enabled = cfg?.enabled === true;
      dryRun = cfg?.dryRun !== false;
    } catch (e) {
      console.warn("[nflFinalizeSweep] config read failed; staying disabled:", e);
    }
    if (!enabled) {
      console.log("[nflFinalizeSweep] disabled (system/config.nflFinalize.enabled !== true); nothing to do.");
      return;
    }

    // Candidates: NFL pools that have been scored at least once. Staleness and
    // completeness are checked per pool (cheap doc reads; games query only for
    // pools that pass the staleness filter).
    const snap = await db.collection("pools")
      .where("type", "in", [...NFL_SEASON_TYPES])
      .where("scoredThroughWeek", ">=", 1)
      .limit(500)
      .get();

    const stale = snap.docs.filter((d) => {
      const p = d.data() as any;
      // Test Pools are marked by the persisted simRunId field / sim- season — their doc
      // IDs are server-generated, so an id-prefix check alone excludes NOTHING (Codex R1#1).
      if (isSimPool(p, d.id)) return false;
      if (p.status === 'CANCELED') return false;
      const finalizedAt = p.finalizedAt?.toMillis?.() ?? 0;
      const lastScoredAt = p.lastScoredAt?.toMillis?.() ?? 0;
      return finalizedAt === 0 || finalizedAt < lastScoredAt;
    });
    const capped = stale.slice(0, MAX_PER_RUN);

    if (dryRun) {
      console.log(`[nflFinalizeSweep] DRY-RUN: ${stale.length} candidate pool(s).`);
      await writeAdminAudit({
        actorUid: "system",
        action: "NFL_FINALIZE_SWEEP",
        targetType: "pool",
        metadata: { dryRun: true, candidates: stale.length, sample: capped.slice(0, 10).map((d) => d.id) },
        status: "success",
      });
      return;
    }

    let finalized = 0;
    let skipped = 0;
    for (const d of capped) {
      try {
        const outcome = await maybeFinalizeNFLPool(db, d.id);
        if (outcome.finalized) finalized++; else skipped++;
      } catch (e) {
        skipped++;
        console.warn(`[nflFinalizeSweep] finalize failed for ${d.id}:`, e);
      }
    }
    console.log(`[nflFinalizeSweep] finalized ${finalized}, skipped ${skipped} of ${capped.length} candidates.`);
    await writeAdminAudit({
      actorUid: "system",
      action: "NFL_FINALIZE_SWEEP",
      targetType: "pool",
      metadata: { dryRun: false, finalized, skipped, candidates: stale.length },
      status: "success",
    });
  },
);
