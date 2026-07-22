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

/** Daily rollup. */
export const aggregateRevenueDaily = onSchedule(
  // 02:00 ET. BEHAVIOUR CHANGE, deliberate: "every 24 hours" is anchored to the
  // last run rather than a wall clock, so it drifts with every deploy and a
  // timeZone means nothing on it. An explicit nightly time is what makes it
  // pinnable — and makes "did last night's aggregate run?" a question with an
  // answer.
  { schedule: "0 2 * * *", timeZone: "America/New_York", timeoutSeconds: 120, memory: "256MiB" },
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
