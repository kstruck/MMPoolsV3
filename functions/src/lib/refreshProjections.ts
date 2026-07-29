// Post-commit projection refresh for money writes, made non-fatal on purpose.
//
// WHY THIS EXISTS. `setPaidStatus` commits the Member Record, the payments
// ledger row and the entry mirror in ONE transaction, then refreshes the two
// derived projections (rosterSummary, the commissioner aggregate) immediately
// afterwards so the UI does not have to wait for a trigger. Those refreshes
// used to run un-caught, which meant a failure AFTER the commit rejected the
// whole callable — reporting a payment that WAS recorded as failed.
//
// That is worse than it sounds on a money path. The commissioner sees an error,
// the realtime row updates to PAID anyway (the transaction committed), and the
// natural response — click the toggle again — sends the OPPOSITE state and
// reverses money that was genuinely collected. Found by codex review on the PR
// that removed the toggle's legacy fallback, which is what first made this
// error path reachable by the operator instead of being swallowed.
//
// Dropping the refresh loses nothing durable: `onMemberRecordWrite`
// (`rosterAggregate.ts`) fires on the very Member Record write the transaction
// just committed and performs the SAME two recomputes. These calls are a
// latency optimization over a path that already converges on its own.
//
// THE RESIDUAL, STATED RATHER THAN IMPLIED (codex r2, P2 — remedy rejected,
// see the PR body). `onDocumentWritten` generates an endpoint with
// `eventTrigger.retry: false`, so if the trigger delivery ALSO fails the event
// is dropped and the two projections stay stale until the next member write on
// that pool. What that costs, precisely:
//
//   - Nothing authoritative. The Member Record, the payments ledger row and the
//     entry mirror are all committed by the transaction that ran before this.
//   - Not the pot, and not the global stats: `calculatePoolPot`
//     (`statsTrigger.ts`) computes from the member documents directly and never
//     reads `rosterSummary`.
//   - What DOES drift is the cached commissioner-facing roster summary and the
//     commissioner aggregate — display aggregates, recomputed from scratch by
//     any later member write on that pool, so the staleness is bounded rather
//     than permanent.
//
// The obvious remedy — `{ retry: true }` on `onMemberRecordWrite` — was
// rejected as disproportionate here: it changes the failure semantics of a
// live fan-out trigger to up-to-7-day redelivery, in a repo with no
// dead-letter handling, to protect a display aggregate against a double
// failure. Worth revisiting on its own, not inside this PR.
import type { Firestore } from "firebase-admin/firestore";
import { recomputeRosterSummary } from "./rosterSummary";
import { recomputeCommissionerAggregate, ownerOf } from "./commissionerAggregate";

/**
 * Refresh `rosterSummary` + the owner's commissioner aggregate for a pool.
 *
 * Never throws. Returns `true` when both refreshes completed, `false` when one
 * failed — the caller's write is already durable either way, and
 * `onMemberRecordWrite` will converge the projections.
 */
export async function refreshProjectionsBestEffort(
  db: Firestore,
  poolId: string,
  pool: unknown,
): Promise<boolean> {
  try {
    await recomputeRosterSummary(db, poolId);
    const owner = ownerOf(pool);
    if (owner) await recomputeCommissionerAggregate(db, owner);
    return true;
  } catch (err) {
    // Loud, because a persistent failure here means the pot and the
    // commissioner dashboard are stale until the trigger catches up.
    console.error(
      `[refreshProjections] post-commit refresh failed for pool ${poolId} — the write is committed; onMemberRecordWrite will converge:`,
      err,
    );
    return false;
  }
}
