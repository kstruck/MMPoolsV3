/**
 * Input schema for replayFeedSnapshot (functions/src/feedReplay.ts).
 * PURE: zod only, no firebase imports.
 */

import { z } from "zod";

/**
 * replayFeedSnapshot — SUPER_ADMIN. A5 part 2.
 *
 * Re-applies a stored raw ESPN payload from `nfl_feed_snapshots` back into
 * `nfl_games`, so a week corrupted by a bad live fetch can be rebuilt from a
 * known-good feed state instead of hoping the next sync fixes it. This is what
 * turns a correlated feed failure from a REFUND EVENT into a DELAY.
 *
 * `dryRun` DEFAULTS TRUE AT THE SCHEMA LAYER, not in the handler — the repo
 * convention after qodo caught a handler-side `=== true` running LIVE on an
 * omitted flag (#183). This callable overwrites live game rows that scoring
 * reads, so the safe default is not optional.
 *
 * `snapshotId` is required and explicit. An earlier draft let the caller pass a
 * slate and have the server pick "the latest" snapshot — rejected: the whole
 * point of replay is choosing a KNOWN-GOOD payload, and "latest" is exactly the
 * one most likely to be the bad one you are recovering from.
 */
export const replayFeedSnapshotSchema = z.strictObject({
    snapshotId: z.string().trim().min(1).max(200),
    dryRun: z.boolean().optional().default(true),
});
