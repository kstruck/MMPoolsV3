import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { validated } from "./lib/validated";
import { recomputeRevenueSchema } from "./schemas/adminSingles";
import * as admin from "firebase-admin";
import { summarizeCharges } from "./lib/billingCharges";
import { withHeartbeat } from "./lib/heartbeat";

/**
 * Rolls the billingCharges ledger up into admin_stats/revenue (T14).
 *
 * admin_stats/* is a SEPARATE, SUPER_ADMIN-only collection — NOT under the
 * publicly-readable stats/* — because platform revenue is sensitive (the
 * public stats/global holds only prize volume / charity, which are shown on
 * the landing page).
 */

async function recompute(): Promise<{ totalRevenue: number; chargeCount: number }> {
  const db = admin.firestore();
  // Read the whole charge ledger. Fine at current scale; if it grows past a
  // few thousand, switch to an incremental running total keyed off `at`.
  const snap = await db.collection("billingCharges").get();
  const charges = snap.docs.map((d) => {
    const data = d.data() as { amount?: number; kind?: string; at?: number };
    return { amount: data.amount ?? 0, kind: (data.kind as "pool" | "bundle") ?? "pool", at: data.at };
  });
  const summary = summarizeCharges(charges, Date.now());
  await db.doc("admin_stats/revenue").set(
    { ...summary, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { totalRevenue: summary.totalRevenue, chargeCount: summary.chargeCount };
}

/**
 * Daily rollup, 00:30 ET.
 *
 * BEHAVIOUR CHANGE 2026-07-22, deliberate: this was `every 24 hours`, which is
 * anchored to the last run rather than a wall clock — it drifts with every
 * deploy and a timeZone means nothing on it. An explicit nightly time is what
 * makes it pinnable, and makes "did last night's aggregate run?" answerable.
 *
 * NOT 02:00. On spring-forward the ET clock jumps 01:59 to 03:00, so a 02:00
 * wall-clock run does not exist that day and Cloud Scheduler can skip it —
 * leaving admin_stats/revenue stale for ~48h once a year, under a staleness
 * tolerance too loose to flag it. 00:30 exists every day and, unlike the 01:00
 * hour, is not repeated on fall-back either.
 *
 * Kept ABOVE the onSchedule() call, not inside its arguments: the wrapping
 * ratchet in __tests__/heartbeat.test.ts scans a fixed character window from
 * `onSchedule(` for `withHeartbeat(`, and blanked comments still occupy their
 * length — a long comment between the two reads as an unwrapped job.
 */
export const aggregateRevenueDaily = onSchedule(
  { schedule: "30 0 * * *", timeZone: "America/New_York", timeoutSeconds: 120, memory: "256MiB" },
  withHeartbeat('aggregateRevenueDaily', async () => {
    const r = await recompute();
    console.log(`[revenue] daily rollup: $${r.totalRevenue} from ${r.chargeCount} charges`);
  })
);

/** On-demand recompute for the Monetization tab (SUPER_ADMIN). */
export const recomputeRevenue = validated(
  { schema: recomputeRevenueSchema, label: "recomputeRevenue", role: "SUPER_ADMIN", appCheck: "monitor" },
  async () => {
  return await recompute();
  },
);
