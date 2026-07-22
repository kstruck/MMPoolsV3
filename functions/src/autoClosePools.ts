import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { adminCloseUpdate, isAutoCloseEligible } from "./lib/lifecycle";
import { writeAdminAudit } from "./lib/adminAudit";
import { withHeartbeat, configReadFailedVerdict } from "./lib/heartbeat";
import { autoCloseVerdict, autoCloseDryRunVerdict } from "./lib/heartbeatVerdicts";

/**
 * autoClosePools (T2) — a daily sweep that closes pools whose event is over but
 * that were never formally closed (stuck-open finished pools).
 *
 * SAFETY, by design:
 *  - Kill-switch: does nothing unless system/config.autoClose.enabled === true
 *    (default OFF). A missing/misread config is treated as disabled.
 *  - Dry-run by default (autoClose.dryRun !== false): it only REPORTS what it
 *    WOULD close (one admin_audit summary), closing nothing, until an admin has
 *    reviewed a week of reports and explicitly sets dryRun:false.
 *  - Conservative eligibility (isAutoCloseEligible): requires an over-signal
 *    (game 'post' or isFinal), never a date guess, and skips terminal / already
 *    admin-closed pools.
 *  - Closes via the shared adminCloseUpdate, so the trigger guards fire and an
 *    auto-close produces zero member emails and zero stats deltas — same as a
 *    manual closePool.
 */

const MAX_PER_RUN = 200; // safety cap; logs if exceeded

export const autoClosePools = functions.scheduler.onSchedule(
  { schedule: "every day 08:00", timeoutSeconds: 300, memory: "512MiB" },
  withHeartbeat('autoClosePools', async () => {
    const db = admin.firestore();

    // Kill-switch + dry-run flag (fail-safe: any read error → disabled).
    let enabled = false;
    let dryRun = true;
    let configError: unknown = null;
    try {
      const cfg = (await db.doc("system/config").get()).data()?.autoClose as
        | { enabled?: boolean; dryRun?: boolean }
        | undefined;
      enabled = cfg?.enabled === true;
      dryRun = cfg?.dryRun !== false; // default true unless explicitly false
    } catch (e) {
      configError = e ?? new Error("unknown config read error");
    }
    // Falling back to disabled is the right FAIL-SAFE, but it makes an
    // unreachable config indistinguishable from a switch someone turned off.
    // The fallback stays; only the reporting changes.
    if (configError) return configReadFailedVerdict("autoClosePools", configError);

    if (!enabled) {
      console.log("[autoClosePools] disabled (system/config.autoClose.enabled !== true); nothing to do.");
      return { detail: { enabled: false } };
    }

    // Candidate set: pools whose event is over (two indexed queries, merged).
    const seen = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    const finalSnap = await db.collection("pools").where("isFinal", "==", true).limit(500).get();
    const postSnap = await db.collection("pools").where("scores.gameStatus", "==", "post").limit(500).get();
    for (const d of [...finalSnap.docs, ...postSnap.docs]) seen.set(d.id, d);

    const eligible = [...seen.values()].filter((d) => isAutoCloseEligible(d.data()));
    const capped = eligible.slice(0, MAX_PER_RUN);
    const overflow = eligible.length - capped.length;

    if (dryRun) {
      console.log(`[autoClosePools] DRY-RUN: would close ${eligible.length} pool(s)${overflow > 0 ? ` (capped at ${MAX_PER_RUN})` : ""}.`);
      const dryAudited = await writeAdminAudit({
        actorUid: "system",
        action: "AUTO_CLOSE_SWEEP",
        targetType: "pool",
        metadata: { dryRun: true, wouldClose: eligible.length, sample: capped.slice(0, 10).map((d) => d.id) },
        status: "success",
      });
      // That audit entry IS the dry run's only output; losing it means the run
      // produced nothing readable while claiming success.
      return autoCloseDryRunVerdict(eligible.length, dryAudited);
    }

    // Live run: close each via the shared admin-close write.
    const now = Date.now();
    let closed = 0;
    // Counted, not just logged. The per-pool catch keeps one bad pool from
    // stopping the sweep — which meant a run where EVERY close failed still
    // reported a healthy beat.
    let failed = 0;
    for (const d of capped) {
      try {
        await d.ref.update(adminCloseUpdate(now));
        closed++;
      } catch (e) {
        failed++;
        console.error(`[autoClosePools] failed to close ${d.id}:`, e);
      }
    }

    console.log(`[autoClosePools] closed ${closed}/${eligible.length} pool(s)${overflow > 0 ? ` (capped; ${overflow} deferred to next run)` : ""}.`);
    await writeAdminAudit({
      actorUid: "system",
      action: "AUTO_CLOSE_SWEEP",
      targetType: "pool",
      metadata: { dryRun: false, closed, failed, eligible: eligible.length, overflow, sample: capped.slice(0, 10).map((d) => d.id) },
      status: "success",
    });

    return autoCloseVerdict({ closed, failed, overflow });
  }
));
