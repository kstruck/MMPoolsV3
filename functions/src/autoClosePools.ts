import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { adminCloseUpdate, isAutoCloseEligible } from "./lib/lifecycle";
import { writeAdminAudit } from "./lib/adminAudit";

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
  async () => {
    const db = admin.firestore();

    // Kill-switch + dry-run flag (fail-safe: any read error → disabled).
    let enabled = false;
    let dryRun = true;
    try {
      const cfg = (await db.doc("system/config").get()).data()?.autoClose as
        | { enabled?: boolean; dryRun?: boolean }
        | undefined;
      enabled = cfg?.enabled === true;
      dryRun = cfg?.dryRun !== false; // default true unless explicitly false
    } catch (e) {
      console.warn("[autoClosePools] config read failed; staying disabled:", e);
    }

    if (!enabled) {
      console.log("[autoClosePools] disabled (system/config.autoClose.enabled !== true); nothing to do.");
      return;
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
      await writeAdminAudit({
        actorUid: "system",
        action: "AUTO_CLOSE_SWEEP",
        targetType: "pool",
        metadata: { dryRun: true, wouldClose: eligible.length, sample: capped.slice(0, 10).map((d) => d.id) },
        status: "success",
      });
      return;
    }

    // Live run: close each via the shared admin-close write.
    const now = Date.now();
    let closed = 0;
    for (const d of capped) {
      try {
        await d.ref.update(adminCloseUpdate(now));
        closed++;
      } catch (e) {
        console.error(`[autoClosePools] failed to close ${d.id}:`, e);
      }
    }

    console.log(`[autoClosePools] closed ${closed}/${eligible.length} pool(s)${overflow > 0 ? ` (capped; ${overflow} deferred to next run)` : ""}.`);
    await writeAdminAudit({
      actorUid: "system",
      action: "AUTO_CLOSE_SWEEP",
      targetType: "pool",
      metadata: { dryRun: false, closed, eligible: eligible.length, overflow, sample: capped.slice(0, 10).map((d) => d.id) },
      status: "success",
    });
  }
);
