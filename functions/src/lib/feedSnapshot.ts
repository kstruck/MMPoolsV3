import { gzipSync, gunzipSync } from "zlib";
import { createHash } from "crypto";
import type { NFLGame } from "../types";

/**
 * ESPN feed snapshots (PLAN-NFL-PRESEASON-PILOT A5).
 *
 * WHY THIS EXISTS. The finalizer does not fetch ESPN — it reads `nfl_games`
 * (nflFinalize.ts, isSeasonComplete). Those docs are written by
 * `syncNFLScoresJob` every 5 minutes with `batch.set(..., {merge:true})`, i.e.
 * the feed's last word overwrites the previous one and nothing records what the
 * feed actually said. So today:
 *   - a bad ESPN response is written straight into the state finalization
 *     settles on, and afterwards there is no way to know it happened;
 *   - a post-finalization stat correction (a certainty, not a risk) has nothing
 *     to diff against, so nobody can tell a correction from a bug.
 *
 * Snapshotting the raw response before it mutates `nfl_games` turns both of
 * those from unknowable into diagnosable, and is the precondition for replaying
 * finalization from a known-good feed state rather than from a fresh, possibly
 * failed, live fetch.
 *
 * Pure module: encoding and diffing only. All Firestore IO lives in the caller.
 */

/** Identifies which slate a snapshot is of. */
export interface SnapshotKey {
  season: string;
  seasonType: number;
  week: number;
}

export interface EncodedSnapshot {
  /** gzipped raw JSON. Firestore's 1MiB doc limit is the constraint; a week's
   *  scoreboard is a few hundred KB of JSON and gzips ~10x, so this fits with
   *  room to spare. Oversize payloads are refused rather than truncated —
   *  a half-snapshot is worse than a recorded miss. */
  gzipped: Buffer;
  /** Bytes before compression, for storage-cost sanity checks. */
  rawBytes: number;
  gzipBytes: number;
  /** Content hash of the raw JSON — lets a caller skip storing an identical
   *  consecutive response, which is most of them at a 5-minute cadence. */
  sha256: string;
}

/** Firestore's hard per-document ceiling is 1 MiB; stay well under it. */
export const MAX_SNAPSHOT_GZIP_BYTES = 700_000;

export class SnapshotTooLargeError extends Error {
  constructor(public readonly gzipBytes: number) {
    super(`feed snapshot is ${gzipBytes} bytes gzipped, over the ${MAX_SNAPSHOT_GZIP_BYTES} limit`);
    this.name = "SnapshotTooLargeError";
  }
}

/** ponytail: zlib + crypto are stdlib; no compression dependency needed. */
export function encodeSnapshot(raw: unknown): EncodedSnapshot {
  const json = JSON.stringify(raw);
  const gzipped = gzipSync(Buffer.from(json, "utf8"));
  if (gzipped.byteLength > MAX_SNAPSHOT_GZIP_BYTES) throw new SnapshotTooLargeError(gzipped.byteLength);
  return {
    gzipped,
    rawBytes: Buffer.byteLength(json, "utf8"),
    gzipBytes: gzipped.byteLength,
    sha256: createHash("sha256").update(json).digest("hex"),
  };
}

/** Round-trips an encoded snapshot back to the exact object that was captured. */
export function decodeSnapshot(gzipped: Buffer | Uint8Array): unknown {
  return JSON.parse(gunzipSync(Buffer.from(gzipped)).toString("utf8"));
}

export interface GameStateChange {
  gameId: string;
  field: "score" | "status";
  from: string;
  to: string;
}

/**
 * A change to a game that was ALREADY FINAL. This is the stat-correction
 * signature, and it is the one class of change that can invalidate a settled
 * result — everything else is a game simply progressing.
 */
export function detectStatCorrections(prev: NFLGame[], next: NFLGame[]): GameStateChange[] {
  const before = new Map(prev.map((g) => [g.id, g]));
  const changes: GameStateChange[] = [];
  for (const after of next) {
    const was = before.get(after.id);
    if (!was || was.status !== "FINAL") continue; // only a settled game can be corrected

    if (after.status !== "FINAL") {
      changes.push({ gameId: after.id, field: "status", from: "FINAL", to: String(after.status) });
      continue;
    }
    const wasScore = `${was.scores?.away ?? "?"}-${was.scores?.home ?? "?"}`;
    const nowScore = `${after.scores?.away ?? "?"}-${after.scores?.home ?? "?"}`;
    // A FINAL game whose scores are absent in the new payload is feed flakiness,
    // not a correction — do not page for a field that merely went missing.
    if (after.scores === undefined) continue;
    if (wasScore !== nowScore) {
      changes.push({ gameId: after.id, field: "score", from: wasScore, to: nowScore });
    }
  }
  return changes;
}

/** Snapshots older than this are pruned. */
export function isExpired(fetchedAtMs: number, nowMs: number, retentionDays: number): boolean {
  return nowMs - fetchedAtMs > retentionDays * 24 * 60 * 60 * 1000;
}

export const snapshotSlateId = (k: SnapshotKey) => `${k.season}/${k.seasonType}/${k.week}`;
