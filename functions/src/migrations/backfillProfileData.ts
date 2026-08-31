import { validated } from "../lib/validated";
import { backfillProfileDataSchema } from "../schemas/migrations";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { NFL_SEASON_TYPES } from "../shared/poolTypes";
import { gradePickemGames, gradeSurvivorWeekGame, gradeMarginWeekGame, buildStandingsRows } from "../nflScoringEngine";
import { resolveGameSpreads } from "../lib/frozenSpreads";
import { maybeFinalizeNFLPool } from "../nflFinalize";
import { recomputeUserProfile } from "../userProfile";
import { writeAdminAudit } from "../lib/adminAudit";
import type { NFLGame, NFLPickemEntry, SurvivorEntry, MarginEntry } from "../nflPoolTypes";

/**
 * Profile data backfill (ADR 0005 / PLAN-PLAYER-PROFILES Phase 8) — Operations tab.
 *
 * Re-derives everything derivable for existing non-sim NFL pools; fabricates NO money:
 *  1. weeklyResults per entry for already-scored weeks, now including the per-game
 *     graded outcome maps (Team-by-Team / Pick History source). Official points are
 *     PRESERVED from weeklyPoints — only the per-pick records and W-L context are added.
 *  2. feeOwed on existing fee-liable Member Records, marked BACKFILL_ESTIMATE (historic
 *     OPEN-phase fee edits were never snapshotted, so pre-migration dues are best-effort).
 *  3. standings projection + pool scoring markers, then the finalize pass for
 *     season-complete pools (idempotent).
 *  4. one deduped profile recompute per affected subject — trigger-driven recomputes are
 *     suppressed during the run via system/config.profileBackfill.suppressTriggers.
 *
 * Rule 1 (mmp-change-control): dryRun DEFAULT true — reports what it would touch to
 * admin_audit and writes nothing until explicitly called with dryRun:false. Batched with
 * a pool cap + resume cursor. Payouts are never backfilled computationally —
 * commissioners retro-record via recordPoolPayouts.
 */

const MAX_POOLS_PER_RUN = 25;

interface PoolReport {
  poolId: string;
  type: string;
  entries: number;
  weeksBackfilled: number;
  feeStamps: number;
  finalized: boolean;
}

/**
 * PLAN-AUDIT-BACKEND-RESIDUE 17b: was a raw `onCall` with NO input schema and a
 * CLAIM-ONLY SUPER_ADMIN check, so (a) `request.data` reached a prod batch
 * migration unvalidated and (b) a demoted admin with an un-expired token could
 * still run it. `validated()` supplies both halves — the strict schema and
 * `assertCallerRole`'s claim+doc agreement — matching all four sibling
 * migrations. `options` carries forward the sizing the bare onCall declared.
 */
export const backfillProfileData = validated(
  {
    schema: backfillProfileDataSchema,
    label: "backfillProfileData",
    role: "SUPER_ADMIN",
    appCheck: "monitor",
    options: { timeoutSeconds: 540, memory: '1GiB' },
  },
  async (input, request) => {
  const db = admin.firestore();
  const dryRun = input.dryRun; // Rule 1: dry-run default, declared at the schema layer
  const afterPoolId: string | undefined = input.afterPoolId;

  let q = db.collection('pools')
    .where('type', 'in', [...NFL_SEASON_TYPES])
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(MAX_POOLS_PER_RUN + 1);
  if (afterPoolId) q = q.startAfter(afterPoolId);
  const poolsSnap = await q.get();
  const poolDocs = poolsSnap.docs.filter(d => !d.id.startsWith('sim-')).slice(0, MAX_POOLS_PER_RUN);
  const hasMore = poolsSnap.docs.length > MAX_POOLS_PER_RUN;

  const reports: PoolReport[] = [];
  const affectedUids = new Set<string>();

  if (!dryRun) {
    await db.doc('system/config').set({ profileBackfill: { suppressTriggers: true } }, { merge: true });
  }

  try {
    for (const poolDoc of poolDocs) {
      const pool: any = poolDoc.data();
      const poolRef = poolDoc.ref;

      const [entriesSnap, gamesSnap, membersSnap] = await Promise.all([
        poolRef.collection('entries').get(),
        db.collection('nfl_games')
          .where('season', '==', pool.season)
          .where('seasonType', '==', Number(pool.seasonType || 2))
          .get(),
        poolRef.collection('members').get(),
      ]);
      // `frozen ?? working` (PLAN-NFL-SPREAD-FREEZE R1). This migration re-grades
      // ATS weeks through `gradePickemGames`, so an unresolved read would rewrite
      // historical per-pick profile results against whatever the working line has
      // drifted to — disagreeing with the standings and with what the member was
      // shown. Every path that GRADES resolves, not only the live ones (codex r1).
      const games = await resolveGameSpreads(db, gamesSnap.docs.map(d => d.data() as NFLGame));
      const gamesByWeek = new Map<number, NFLGame[]>();
      for (const g of games) {
        const wk = Number(g.week);
        gamesByWeek.set(wk, [...(gamesByWeek.get(wk) || []), g]);
      }

      const report: PoolReport = { poolId: poolDoc.id, type: pool.type, entries: entriesSnap.size, weeksBackfilled: 0, feeStamps: 0, finalized: false };
      const scoredWeeks = new Set<number>();

      let batch = db.batch();
      let ops = 0;
      const stage = async (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => {
        batch.update(ref, data);
        if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
      };

      for (const entryDoc of entriesSnap.docs) {
        const entry: any = { ...entryDoc.data(), id: entryDoc.id };
        if (entry.ownerUid) affectedUids.add(entry.ownerUid);
        const weeklyResults: Record<number, any> = { ...(entry.weeklyResults || {}) };
        let touched = 0;

        if (pool.type === 'NFL_PICKEM') {
          // Only weeks that were OFFICIALLY scored (weeklyPoints has the week) — the
          // backfill adds per-pick context to real scorings, it does not invent one.
          for (const wk of Object.keys(entry.weeklyPoints || {})) {
            const week = Number(wk);
            const weekGames = gamesByWeek.get(week) || [];
            if (weekGames.length === 0) continue;
            const grades = gradePickemGames(entry as NFLPickemEntry, weekGames, pool);
            const picksThisWeek = weekGames.filter(g => !!entry.picks?.[g.id]).length;
            const correct = Object.values(grades).filter(g => g.result === 'W').length;
            weeklyResults[week] = {
              correct,
              total: picksThisWeek,
              points: entry.weeklyPoints[week], // official points preserved
              mode: pool.settings?.pickMode === 'ATS' ? 'ATS' : 'STRAIGHT',
              games: grades,
            };
            scoredWeeks.add(week);
            touched++;
          }
        } else if (pool.type === 'NFL_SURVIVOR') {
          const s = entry as SurvivorEntry;
          for (const wk of Object.keys(s.picks || {})) {
            const week = Number(wk);
            const weekGames = gamesByWeek.get(week) || [];
            const struck = (s.strikeWeeks || []).includes(week); // strike ledger is authoritative
            const game = gradeSurvivorWeekGame(s, week, weekGames, struck);
            if (!game && !struck) continue; // game not concluded -> nothing scored yet
            weeklyResults[week] = { survived: !struck, strike: struck, ...(game ? { game } : {}) };
            scoredWeeks.add(week);
            touched++;
          }
        } else if (pool.type === 'NFL_MARGIN') {
          const m = entry as MarginEntry;
          for (const wk of Object.keys(m.weeklyScores || {})) {
            const week = Number(wk);
            const weekGames = gamesByWeek.get(week) || [];
            const game = gradeMarginWeekGame(m.picks?.[week], weekGames);
            weeklyResults[week] = { net: m.weeklyScores[week], ...(game ? { game } : {}) };
            scoredWeeks.add(week);
            touched++;
          }
        }

        if (touched > 0) {
          report.weeksBackfilled += touched;
          if (!dryRun) {
            await stage(entryDoc.ref, {
              weeklyResults,
              resultsVersion: ((entry.resultsVersion) || 0) + 1,
            });
          }
        }
      }

      // feeOwed stamps — fee-liable existing Member Records only; never rewrite a stamp.
      const fee = Number(pool.settings?.entryFee ?? 0);
      for (const m of membersSnap.docs) {
        const rec: any = m.data();
        if (rec.feeOwed !== undefined) continue;
        const seededOwnerNeverPlayed = rec.role === 'MANAGER'
          && !entriesSnap.docs.some(e => (e.data() as any).ownerUid === m.id);
        const liable = seededOwnerNeverPlayed ? 0 : fee;
        report.feeStamps++;
        if (!dryRun) {
          await stage(m.ref, { feeOwed: liable, feeOwedSource: 'BACKFILL_ESTIMATE' });
        }
      }

      if (!dryRun) {
        await (async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } })();
        if (scoredWeeks.size > 0) {
          // standings projection + markers, mirroring scoreNFLWeek's pass
          const freshEntries = await poolRef.collection('entries').get();
          await poolRef.collection('standings').doc('current').set({
            poolType: pool.type,
            season: String(pool.season ?? ''),
            lastScoredWeek: Math.max(...scoredWeeks),
            updatedAt: FieldValue.serverTimestamp(),
            rows: buildStandingsRows(pool.type, freshEntries.docs.map(d => ({ ...(d.data() as any), id: d.id }))),
          });
          await poolRef.update({
            lastScoredAt: FieldValue.serverTimestamp(),
            scoredThroughWeek: Math.max(Number(pool.scoredThroughWeek || 0), ...scoredWeeks),
            ...Object.fromEntries([...scoredWeeks].map(w => [`scoredWeeks.${w}`, true])),
          });
        }
        try {
          const outcome = await maybeFinalizeNFLPool(db, poolDoc.id);
          report.finalized = outcome.finalized;
        } catch (e) {
          console.warn(`[backfillProfileData] finalize failed for ${poolDoc.id}:`, e);
        }
      }

      reports.push(report);
    }
  } finally {
    if (!dryRun) {
      await db.doc('system/config').set({ profileBackfill: { suppressTriggers: false } }, { merge: true });
    }
  }

  // Deduped per-subject recompute AFTER all writes (trigger was suppressed).
  let recomputed = 0;
  if (!dryRun) {
    for (const uid of affectedUids) {
      try { await recomputeUserProfile(db, uid); recomputed++; }
      catch (e) { console.warn(`[backfillProfileData] recompute failed for ${uid}:`, e); }
    }
  }

  const summary = {
    dryRun,
    pools: reports.length,
    hasMore,
    nextCursor: hasMore ? poolDocs[poolDocs.length - 1]?.id : null,
    totalWeeksBackfilled: reports.reduce((s, r) => s + r.weeksBackfilled, 0),
    totalFeeStamps: reports.reduce((s, r) => s + r.feeStamps, 0),
    finalizedPools: reports.filter(r => r.finalized).length,
    subjectsRecomputed: recomputed,
    perPool: reports,
  };

  await writeAdminAudit({
    actorUid: request.auth!.uid,
    action: 'PROFILE_DATA_BACKFILL',
    targetType: 'pool',
    metadata: { ...summary, perPool: reports.slice(0, 20) },
    status: 'success',
  });

  return summary;
},
);
