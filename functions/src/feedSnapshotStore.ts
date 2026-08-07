import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { dispatchOpsAlert } from "./lib/opsAlertDispatcher";
import { writeAdminAudit } from "./lib/adminAudit";
import {
  encodeSnapshot, SnapshotTooLargeError, snapshotSlateId,
  type GameStateChange, type SnapshotKey,
} from "./lib/feedSnapshot";

/**
 * Firestore IO for ESPN feed snapshots (PLAN-NFL-PRESEASON-PILOT A5).
 * The decisions live in lib/feedSnapshot.ts; this file only reads and writes.
 */

export const FEED_SNAPSHOTS = "nfl_feed_snapshots";

export interface SnapshotGate {
  enabled: boolean;
  retentionDays: number;
}

const DEFAULT_RETENTION_DAYS = 45;

/**
 * SAFETY (Rule 1, mmp-change-control): fail-safe OFF. This writes to a new
 * collection it exclusively owns and never mutates existing data, but it does
 * add write volume, so it stays behind the house kill-switch.
 */
export async function readSnapshotGate(db: Firestore): Promise<SnapshotGate> {
  try {
    const cfg = (await db.doc("system/config").get()).data()?.nflFeedSnapshots as
      | { enabled?: boolean; retentionDays?: number }
      | undefined;
    const retentionDays = Number(cfg?.retentionDays);
    return {
      enabled: cfg?.enabled === true,
      retentionDays: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS,
    };
  } catch (e) {
    console.warn("[feedSnapshot] config read failed; snapshots disabled:", e);
    return { enabled: false, retentionDays: DEFAULT_RETENTION_DAYS };
  }
}

/**
 * Persist one raw ESPN response, unless it is byte-identical to the previous
 * snapshot of the same slate. At a 5-minute cadence almost every response
 * repeats, so the dedupe is what makes this affordable to leave on all season.
 *
 * Never throws: a snapshot is diagnostics, and losing one must never break the
 * score sync it rides along with.
 */
export async function captureFeedSnapshot(
  db: Firestore,
  key: SnapshotKey,
  raw: unknown,
  corrections: GameStateChange[],
  gameCount: number,
): Promise<"written" | "duplicate" | "skipped"> {
  try {
    const encoded = encodeSnapshot(raw);

    const prev = await db.collection(FEED_SNAPSHOTS)
      .where("slate", "==", snapshotSlateId(key))
      .orderBy("fetchedAt", "desc")
      .limit(1)
      .get();
    // A correction is always recorded, even against an identical hash, so the
    // audit trail can never miss the event it exists for.
    if (!prev.empty && prev.docs[0].data()?.sha256 === encoded.sha256 && corrections.length === 0) {
      return "duplicate";
    }

    await db.collection(FEED_SNAPSHOTS).add({
      slate: snapshotSlateId(key),
      season: key.season,
      seasonType: key.seasonType,
      week: key.week,
      fetchedAt: Date.now(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sha256: encoded.sha256,
      rawBytes: encoded.rawBytes,
      gzipBytes: encoded.gzipBytes,
      gameCount,
      corrections,
      // Buffer maps to a Firestore Bytes field; the 1MiB doc ceiling is why
      // encodeSnapshot refuses anything over MAX_SNAPSHOT_GZIP_BYTES.
      payloadGzip: encoded.gzipped,
    });
    return "written";
  } catch (e) {
    if (e instanceof SnapshotTooLargeError) {
      // Recorded as a miss rather than stored truncated — a half-snapshot would
      // be worse than a known gap, because it would look complete on replay.
      console.error(`[feedSnapshot] ${snapshotSlateId(key)} too large to store (${e.gzipBytes}B gzipped); snapshot skipped.`);
    } else {
      console.warn(`[feedSnapshot] capture failed for ${snapshotSlateId(key)} (non-fatal):`, e);
    }
    return "skipped";
  }
}

/**
 * Where the raw payloads for THIS correction actually live.
 *
 * Pure and exported so the pointer is unit-tested rather than trusted. It is the
 * one sentence in the alert an operator ACTS on during an incident, and a
 * confidently wrong pointer is worse than none: ESPN's calendar entries overlap,
 * so a correction can be reported under the week that OWNS the game while the
 * snapshot was filed under the week that was FETCHED. (qodo #3 on PR #392.)
 */
export function snapshotPointerLine(owningSlateId: string, sourceSlateId: string): string {
  if (owningSlateId === sourceSlateId) {
    return `The raw feed payloads before and after are in the ${FEED_SNAPSHOTS} collection for this slate.`;
  }
  return (
    `⚠️ This correction arrived inside the ${sourceSlateId} response (ESPN's calendar ranges overlap), ` +
    `so the raw feed payloads are in the ${FEED_SNAPSHOTS} collection under slate ${sourceSlateId}, NOT ${owningSlateId}.`
  );
}

/**
 * A game that was already FINAL changed. This is the case that can invalidate a
 * settled pool, so it pages rather than just logging.
 */
export async function reportStatCorrections(
  db: Firestore,
  key: SnapshotKey,
  corrections: GameStateChange[],
  /**
   * The slate whose RESPONSE the correction was observed in, when that is not
   * `key` itself.
   *
   * ESPN's calendar entries overlap, so a fetch for week N can return week N+1's
   * games; a correction among those is reported under the week that OWNS it
   * (`key`) while the raw payload was snapshotted under the week that was
   * FETCHED. Without this, the message below sends an operator to
   * `nfl_feed_snapshots` "for this slate" and there is nothing there for this
   * response — the pointer is confidently wrong, which during an incident is
   * worse than no pointer. (qodo #3 on PR #392.)
   */
  observedIn?: SnapshotKey,
): Promise<boolean> {
  if (corrections.length === 0) return true;
  const detail = corrections.map((c) => `${c.gameId}: ${c.field} ${c.from} → ${c.to}`).join("; ");
  const owning = snapshotSlateId(key);
  const source = observedIn ? snapshotSlateId(observedIn) : owning;
  const spilledOver = source !== owning;
  console.warn(`[feedSnapshot] STAT CORRECTION on ${owning}${spilledOver ? ` (observed in the ${source} response)` : ""}: ${detail}`);

  // Independent sinks — the audit trail must not wait on the pager, and neither
  // throws, so a failure in one cannot lose the other. But BOTH failing means
  // the correction was detected and then dropped on the floor: pools already
  // finalized on the stale scores stay that way and nobody is told. Reported
  // back so the job's heartbeat can say so.
  const [audited, paged] = await Promise.all([
    writeAdminAudit({
      actorUid: "system",
      action: "NFL_STAT_CORRECTION",
      targetType: "pool",
      metadata: {
        slate: owning,
        ...(spilledOver ? { observedInSlate: source } : {}),
        corrections: corrections.slice(0, 50),
      },
      status: "success",
    }),
    dispatchOpsAlert(db, {
      type: "NFL_STAT_CORRECTION",
      title: `NFL stat correction — week ${key.week}`,
      message:
        `ESPN changed ${corrections.length} game(s) that were already FINAL on slate ${owning}.\n\n${detail}\n\n` +
        `Any pool already scored or finalized on the old values is now settled on stale data. ` +
        `Re-score the affected week, then let the finalize sweep re-derive (finalization is a re-runnable overwrite). ` +
        snapshotPointerLine(owning, source),
      context: {
        slate: owning,
        ...(spilledOver ? { observedInSlate: source } : {}),
        count: corrections.length,
      },
    }),
  ]);
  // "no-recipients" counts as delivered: an unconfigured pager is a setup gap
  // that would otherwise mark every correction run unhealthy forever, and the
  // audit entry still carries the record.
  return audited && paged !== "failed";
}

/**
 * Delete snapshots past the retention window. Bounded per run so the 5-minute
 * job can never spend its whole budget pruning.
 */
export async function pruneExpiredSnapshots(
  db: Firestore,
  nowMs: number,
  retentionDays: number,
  maxDeletes = 200,
): Promise<number> {
  try {
    const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
    const stale = await db.collection(FEED_SNAPSHOTS)
      .where("fetchedAt", "<", cutoff)
      .limit(maxDeletes)
      .get();
    if (stale.empty) return 0;
    const batch = db.batch();
    for (const d of stale.docs) batch.delete(d.ref);
    await batch.commit();
    return stale.size;
  } catch (e) {
    console.warn("[feedSnapshot] prune failed (non-fatal):", e);
    return 0;
  }
}
