import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { writeAdminAudit } from "./lib/adminAudit";
import { replayFeedSnapshotSchema } from "./schemas/feedReplay";
import { decodeSnapshot } from "./lib/feedSnapshot";
import { FEED_SNAPSHOTS } from "./feedSnapshotStore";
import { parseScoreboardResponse } from "./nflSchedule";
import { buildReplayPlan } from "./lib/feedReplayDiff";
import type { NFLGame } from "./types";

/**
 * replayFeedSnapshot (PLAN-NFL-PRESEASON-PILOT A5, part 2).
 *
 * Rebuilds a week of `nfl_games` from a stored raw ESPN payload instead of a
 * fresh — possibly still-broken — live fetch. This is the piece that converts a
 * correlated feed failure from a REFUND EVENT into a DELAY: when ESPN serves
 * garbage and syncNFLScoresJob writes it through, the previous good payload is
 * still in `nfl_feed_snapshots` and can be re-applied.
 *
 * SAFETY:
 *  - SUPER_ADMIN + strict schema via validated().
 *  - dryRun defaults TRUE at the schema layer. Live mode must be asked for.
 *  - A locked spread is never unlocked by a replay (see buildReplayPlan).
 *  - Games missing from the snapshot are REPORTED, never deleted.
 *  - Every run — dry or live — writes an admin_audit entry, so a replay is
 *    always attributable. This callable rewrites rows that scoring reads.
 */
export const replayFeedSnapshot = validated(
    {
        schema: replayFeedSnapshotSchema,
        label: "replayFeedSnapshot",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
        options: { timeoutSeconds: 300, memory: "512MiB" },
    },
    async ({ snapshotId, dryRun }, request) => {
        const db = admin.firestore();

        const snap = await db.collection(FEED_SNAPSHOTS).doc(snapshotId).get();
        if (!snap.exists) {
            throw new HttpsError("not-found", `Snapshot ${snapshotId} not found.`);
        }
        const data = snap.data() as {
            season?: string; seasonType?: number; week?: number;
            slate?: string; fetchedAt?: number; payloadGzip?: unknown;
        };

        if (!data.payloadGzip) {
            throw new HttpsError("failed-precondition", `Snapshot ${snapshotId} has no stored payload.`);
        }

        // Firestore hands Bytes back as a Buffer/Uint8Array wrapper.
        const raw = decodeSnapshot(
            (data.payloadGzip as { toUint8Array?: () => Uint8Array }).toUint8Array?.()
                ?? (data.payloadGzip as Uint8Array),
        );

        const season = String(data.season ?? "");
        const seasonType = Number(data.seasonType ?? 2) as 1 | 2 | 3;
        const week = Number(data.week ?? 0);
        if (!season || !week) {
            throw new HttpsError("failed-precondition", `Snapshot ${snapshotId} is missing season/week metadata.`);
        }

        // Re-parse through the SAME mapper the live path uses, so a replay can
        // never produce a shape the normal sync would not have produced —
        // including the season/type filter added in PR #219.
        const snapshotGames = parseScoreboardResponse(raw, week, season, seasonType);
        if (snapshotGames.length === 0) {
            throw new HttpsError("failed-precondition",
                `Snapshot ${snapshotId} parsed to zero games for ${season}/${seasonType}/wk${week}; refusing to replay an empty slate.`);
        }

        const currentSnap = await db.collection("nfl_games")
            .where("season", "==", season)
            .where("seasonType", "==", seasonType)
            .where("week", "==", week)
            .get();
        const currentById = new Map<string, NFLGame>(
            currentSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as any) } as NFLGame]),
        );

        const plan = buildReplayPlan(snapshotGames, currentById);

        const summary = {
            snapshotId,
            slate: data.slate ?? `${season}/${seasonType}/${week}`,
            snapshotFetchedAt: data.fetchedAt ?? null,
            games: plan.writes.length,
            changes: plan.changes.length,
            orphans: plan.orphanGameIds.length,
        };

        if (dryRun) {
            await writeAdminAudit({
                actorUid: request.auth!.uid,
                actorEmail: request.auth!.token.email as string | undefined,
                action: "NFL_FEED_REPLAY",
                targetType: "pool",
                metadata: { dryRun: true, ...summary, sample: plan.changes.slice(0, 25), orphanGameIds: plan.orphanGameIds.slice(0, 25) },
                status: "success",
            });
            return { success: true, dryRun: true, ...summary, changes: plan.changes.slice(0, 100), orphanGameIds: plan.orphanGameIds };
        }

        const batch = db.batch();
        for (const g of plan.writes) {
            batch.set(db.collection("nfl_games").doc(g.id), JSON.parse(JSON.stringify(g)), { merge: true });
        }
        await batch.commit();

        await writeAdminAudit({
            actorUid: request.auth!.uid,
            actorEmail: request.auth!.token.email as string | undefined,
            action: "NFL_FEED_REPLAY",
            targetType: "pool",
            metadata: { dryRun: false, ...summary, sample: plan.changes.slice(0, 25), orphanGameIds: plan.orphanGameIds.slice(0, 25) },
            status: "success",
        });

        return {
            success: true,
            dryRun: false,
            ...summary,
            changes: plan.changes.slice(0, 100),
            orphanGameIds: plan.orphanGameIds,
            // Replay only restores GAME state. Pool scores are derived, so the
            // operator must re-score the affected week afterwards; finalization
            // is a re-runnable overwrite and will re-derive from there.
            nextStep: `Re-score week ${week} (scoreNFLWeek) for affected pools, then let the finalize sweep re-derive.`,
        };
    },
);
