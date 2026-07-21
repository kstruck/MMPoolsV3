import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";
import { TERMINAL_STATUSES } from "./lib/lifecycle";
import { dispatchOpsAlert, opsCourierAuthToken } from "./lib/opsAlertDispatcher";
import { writeAdminAudit } from "./lib/adminAudit";
import { isSimPool } from "./nflFinalize";
import {
  decideAlert, evaluateSlate, formatAlertMessage, slateId,
  type SlateKey, type WatchedGame, type WatchedPool,
} from "./lib/nflLockWatch";
import { withHeartbeat } from "./lib/heartbeat";

/**
 * nflLockWatchJob (PLAN-NFL-PRESEASON-PILOT A3a) — the pre-kickoff tripwire.
 *
 * `submitNFLPicks` throws SPREADS_NOT_LOCKED unless EVERY game of the week has
 * spread.locked === true (nflPools.ts:351-355). One unlocked game therefore
 * blocks every member of every pool on that slate, and until now the only
 * detector was a commissioner noticing and emailing. This job asserts
 * locked-game-count == game-count for each slate about to kick off and pages
 * ops through the Phase 2 dispatcher on a mismatch.
 *
 * SAFETY (Rule 1, mmp-change-control): kill-switch
 * system/config.nflLockWatch.enabled === true required (default OFF, fail-safe);
 * dry-run by default (nflLockWatch.dryRun !== false) — it evaluates and writes an
 * admin_audit report but sends NO page until explicitly flipped. Read-only with
 * respect to game and pool data in both modes.
 */

/** How far ahead to look for slates about to kick off. */
const LOOKAHEAD_HOURS = 72;
/** Alert only once kickoff is this close — far-out weeks legitimately have no lines. */
const WARN_WINDOW_HOURS = 36;
/** How far back to keep alerting on a slate whose kickoff already passed. */
const LOOKBACK_HOURS = 12;

export const nflLockWatchJob = functions.scheduler.onSchedule(
  {
    schedule: "every 60 minutes",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [opsCourierAuthToken],
  },
  withHeartbeat("nflLockWatchJob", async () => {
    const db = admin.firestore();

    let enabled = false;
    let dryRun = true;
    try {
      const cfg = (await db.doc("system/config").get()).data()?.nflLockWatch as
        | { enabled?: boolean; dryRun?: boolean }
        | undefined;
      enabled = cfg?.enabled === true;
      dryRun = cfg?.dryRun !== false;
    } catch (e) {
      console.warn("[nflLockWatch] config read failed; staying disabled:", e);
    }
    if (!enabled) {
      console.log("[nflLockWatch] disabled (system/config.nflLockWatch.enabled !== true); nothing to do.");
      return;
    }

    const now = Date.now();

    // 1. Which slates are about to kick off? Widen from the kickoff window so a
    //    slate whose first game already started is still evaluated — that is the
    //    outage-in-progress case, the one that most needs paging.
    const soonSnap = await db.collection("nfl_games")
      .where("startTime", ">=", now - LOOKBACK_HOURS * 3_600_000)
      .where("startTime", "<=", now + LOOKAHEAD_HOURS * 3_600_000)
      .get();

    const slates = new Map<string, SlateKey>();
    for (const d of soonSnap.docs) {
      const g = d.data() as WatchedGame;
      if (g.season === undefined || g.week === undefined) continue;
      const key: SlateKey = { season: String(g.season), seasonType: Number(g.seasonType ?? 2), week: Number(g.week) };
      slates.set(slateId(key), key);
    }

    if (slates.size === 0) {
      console.log("[nflLockWatch] no slates within the kickoff window; nothing to check.");
      return;
    }

    // 2. Live NFL pools — a slate nobody plays is not an outage. Sim pools are
    //    excluded: a Test Pool blocking on spreads is a test artifact, not a page.
    const poolSnap = await db.collection("pools")
      .where("type", "in", [...NFL_SEASON_TYPES])
      .limit(500)
      .get();
    const pools: WatchedPool[] = poolSnap.docs
      .filter((d) => {
        const p = d.data() as any;
        return !isSimPool(p, d.id) && !(TERMINAL_STATUSES as readonly string[]).includes(p.status);
      })
      .map((d) => ({ id: d.id, ...(d.data() as any) } as WatchedPool));

    const firing: string[] = [];
    const checked: Record<string, string> = {};

    for (const key of slates.values()) {
      // 3. Re-read the FULL slate — the submit gate evaluates the whole week, so
      //    a partial window would under-report unlocked games.
      const slateSnap = await db.collection("nfl_games")
        .where("season", "==", key.season)
        .where("seasonType", "==", key.seasonType)
        .where("week", "==", key.week)
        .get();
      const games: WatchedGame[] = slateSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as WatchedGame));

      const coverage = evaluateSlate(key, games, pools);
      const decision = decideAlert(coverage, now, WARN_WINDOW_HOURS);
      checked[slateId(key)] = `${coverage.locked}/${coverage.total} locked — ${decision.reason}`;

      if (!decision.alert) continue;
      firing.push(slateId(key));

      const message = formatAlertMessage(coverage, decision);
      if (dryRun) {
        console.log(`[nflLockWatch] DRY-RUN: would page for ${slateId(key)}:\n${message}`);
        continue;
      }
      await dispatchOpsAlert(db, {
        type: "NFL_SPREADS_NOT_LOCKED",
        title: `NFL spreads not locked — week ${coverage.week}`,
        message,
        context: {
          slate: slateId(key),
          lockedOfTotal: `${coverage.locked}/${coverage.total}`,
          unlockedGameIds: coverage.unlockedGameIds.slice(0, 20).join(", "),
          missingLineGameIds: coverage.missingLineGameIds.slice(0, 20).join(", "),
          affectedPools: coverage.affectedPoolIds.length,
          hoursToKickoff: decision.hoursToKickoff.toFixed(1),
        },
      });
    }

    console.log(`[nflLockWatch] checked ${slates.size} slate(s); ${firing.length} firing.`, checked);

    // Every run leaves a trace, so "the alarm never fired" is distinguishable
    // from "the alarm never ran" — the failure mode a tripwire cannot afford.
    await writeAdminAudit({
      actorUid: "system",
      action: "NFL_LOCK_WATCH",
      targetType: "pool",
      metadata: { dryRun, slatesChecked: slates.size, firing, detail: checked },
      status: "success",
    });
  }),
);
