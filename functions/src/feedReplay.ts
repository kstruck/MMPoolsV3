import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { writeAdminAudit } from "./lib/adminAudit";
import { replayFeedSnapshotSchema } from "./schemas/feedReplay";
import { decodeSnapshot } from "./lib/feedSnapshot";
import { FEED_SNAPSHOTS } from "./feedSnapshotStore";
import { parseScoreboardResponse, scoresMissingMarker } from "./nflSchedule";
import { buildReplayPlan } from "./lib/feedReplayDiff";
import type { NFLGame } from "./types";

/**
 * Hard cap on games written by one replay.
 *
 * A Firestore batch fails outright past 500 operations, and this is the tool you
 * reach for DURING an incident — an opaque batch error at that moment is the
 * worst possible failure. A real ESPN week is ~16 games, so hitting this means
 * the snapshot or the parse is wrong, and refusing with the number in the
 * message is more useful than writing 500 suspect rows.
 *
 * Deliberately a refusal, not chunking: chunking would let a plainly-corrupt
 * plan through, and the dry-run report already surfaces the count beforehand.
 * The guard is live-path only, so a dry run can still diagnose an oversized plan.
 */
export const MAX_REPLAY_WRITES_PER_RUN = 500;

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
 *  - Every run — dry, live, OR FAILED — writes an admin_audit entry, so a replay
 *    attempt is always attributable. This callable rewrites rows that scoring
 *    reads, so "who tried what" matters even when the attempt threw.
 *  - Live writes are capped at MAX_REPLAY_WRITES_PER_RUN.
 *
 * NOT kill-switched, deliberately. The house rule (mmp-change-control Rule 1)
 * covers scheduled and batch-mutating JOBS; this is a human-invoked break-glass
 * tool that only runs when a SUPER_ADMIN asks for it, defaults to dry-run, and
 * exists to be used DURING an incident. A system/config gate would add a way for
 * the recovery path to be unavailable at the one moment it is needed. Same call
 * made for the SUPER_ADMIN mutator in PR #190.
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
        const actor = {
            actorUid: request.auth!.uid,
            actorEmail: request.auth!.token.email as string | undefined,
        };
        try {
            return await runReplay(snapshotId, dryRun, actor);
        } catch (err) {
            // The success audits below cover only the paths that reach them. A
            // missing snapshot, a decode failure, an empty parse, or a failed
            // commit would otherwise leave NO admin_audit trail at all — so the
            // "every run is attributable" property above would be false exactly
            // when someone was poking at a broken slate. Audit, then rethrow
            // unchanged so the caller still sees the original HttpsError.
            await writeAdminAudit({
                ...actor,
                action: "NFL_FEED_REPLAY",
                targetType: "pool",
                metadata: { dryRun, snapshotId },
                status: "error",
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    },
);

async function runReplay(
    snapshotId: string,
    dryRun: boolean,
    actor: { actorUid: string; actorEmail?: string },
) {
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

        // The week-scoped read is what finds ORPHANS — stored games in this week
        // that the snapshot no longer contains — so it stays.
        const currentSnap = await db.collection("nfl_games")
            .where("season", "==", season)
            .where("seasonType", "==", seasonType)
            .where("week", "==", week)
            .get();
        const currentById = new Map<string, NFLGame>(
            currentSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as any) } as NFLGame]),
        );

        // ⚠️ BUT IT IS NO LONGER ENOUGH ON ITS OWN.
        //
        // `parseScoreboardResponse` now files each game under ESPN's own
        // `week.number`, and ESPN's calendar ranges overlap — so a snapshot
        // fetched for week N can parse to games belonging to week N+1. Those are
        // stored under N+1 and the query above cannot see them, which makes
        // `buildReplayPlan` treat each one as ABSENT.
        //
        // Absent is the dangerous verdict here: the locked-spread preservation in
        // buildReplayPlan is conditional on finding a current doc, so a replay
        // would write the parser's `locked: false` over a line a commissioner had
        // locked — the #235 bug class, and an ATS pool with an unlocked line
        // refuses every pick. It would also re-derive `scoresMissing` against
        // nothing.
        //
        // Fetched BY DOCUMENT ID rather than by widening the query: a direct id
        // lookup needs no composite index and so has no way to die silently,
        // which is the failure mode that took out A5 and the finalize sweep.
        // (codex r9 on the week-stamping change.)
        const unseen = snapshotGames.map((g) => g.id).filter((id) => !currentById.has(id));
        if (unseen.length > 0) {
            for (const doc of await db.getAll(...unseen.map((id) => db.collection("nfl_games").doc(id)))) {
                if (doc.exists) currentById.set(doc.id, { id: doc.id, ...(doc.data() as any) } as NFLGame);
            }
        }

        const plan = buildReplayPlan(snapshotGames, currentById);

        /**
         * Every week this replay actually writes to, ascending.
         *
         * Not `[week]`. A snapshot fetched for week N can carry week N+1 games now
         * that games file under ESPN's own week, so the follow-up re-score has to
         * be derived from what was written rather than from what was requested.
         */
        const affectedWeeks = [...new Set(plan.writes.map((g) => Number(g.week)))]
            .filter((w) => Number.isInteger(w) && w > 0)
            .sort((a, b) => a - b);

        const summary = {
            snapshotId,
            slate: data.slate ?? `${season}/${seasonType}/${week}`,
            snapshotFetchedAt: data.fetchedAt ?? null,
            games: plan.writes.length,
            changes: plan.changes.length,
            orphans: plan.orphanGameIds.length,
            affectedWeeks,
        };

        if (dryRun) {
            await writeAdminAudit({
                ...actor,
                action: "NFL_FEED_REPLAY",
                targetType: "pool",
                metadata: { dryRun: true, ...summary, sample: plan.changes.slice(0, 25), orphanGameIds: plan.orphanGameIds.slice(0, 25) },
                status: "success",
            });
            return { success: true, dryRun: true, ...summary, changes: plan.changes.slice(0, 100), orphanGameIds: plan.orphanGameIds };
        }

        if (plan.writes.length > MAX_REPLAY_WRITES_PER_RUN) {
            throw new HttpsError("failed-precondition",
                `Replay would write ${plan.writes.length} games, over the ${MAX_REPLAY_WRITES_PER_RUN} per-run cap — a real NFL week is ~16. Snapshot ${snapshotId} is likely corrupt; inspect the dry-run report before forcing this.`);
        }

        const batch = db.batch();
        for (const g of plan.writes) {
            // Same reason as the importer: a replayed snapshot can carry a
            // scoreless FINAL, and without the marker nothing would ever
            // re-fetch that slate (codex r2). The stored doc is already in hand
            // here, so this gets the precise answer rather than the conservative
            // one — a replay that omits scores the live doc already has must not
            // flag a game that is fine.
            const replayed = JSON.parse(JSON.stringify(g));
            replayed.scoresMissing = scoresMissingMarker(g, currentById.get(g.id));
            batch.set(db.collection("nfl_games").doc(g.id), replayed, { merge: true });
        }
        await batch.commit();

        await writeAdminAudit({
            ...actor,
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
            // operator must re-score the affected weeks afterwards; finalization
            // is a re-runnable overwrite and will re-derive from there.
            //
            // Derived from the games actually WRITTEN, not from the snapshot's own
            // week. Since games now file under ESPN's week and calendar ranges
            // overlap, a snapshot fetched for week N can restore week N+1 games
            // too — and naming only week N would leave that week's standings
            // stale with the operator told the job was finished. (codex r9.)
            nextStep: `Re-score ${affectedWeeks.map((w) => `week ${w}`).join(' and ') || `week ${week}`} (scoreNFLWeek) for affected pools, then let the finalize sweep re-derive.`,
        };
}
