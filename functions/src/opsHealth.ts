import * as admin from "firebase-admin";
import { validated } from "./lib/validated";
import { getOpsHealthSummarySchema } from "./schemas/opsHealth";
import { findStaleJobs, HEARTBEAT_DOC, SCHEDULED_JOB_EXPECTATIONS, type JobHeartbeat, type StaleJob } from "./lib/heartbeat";

/**
 * In-app Ops Health surface (PLAN-SECURITY-OBSERVABILITY.md #12) — a SUPER_ADMIN
 * callable summarizing the alerts the platform ALREADY emits, for the Overview
 * "API Status Center" card. Deliberately no client-side direct reads: neither
 * monetization_alerts (already SUPER_ADMIN-read-gated in firestore.rules) nor
 * stripeWebhookEvents (no rules entry at all — default-deny) are opened up to
 * the client; this stays a server-computed summary, same pattern as
 * adminHealth.ts's getAdminHealthSnapshot.
 *
 * Single-field `where` only (no `orderBy` paired with it) so this needs no new
 * composite Firestore index.
 */

function toMillis(v: unknown): number | null {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
        try {
            return (v as { toMillis: () => number }).toMillis();
        } catch {
            return null;
        }
    }
    return null;
}

export interface OpsHealthSummary {
    at: number;
    openAlerts: {
        count: number;
        sample: Array<{ id: string; type: string; message?: string; createdAt: number | null }>;
    };
    failedWebhooks: {
        count: number;
        sample: Array<{ id: string; eventType?: string; attemptCount?: number; lastFailedAt: number | null }>;
    };
    /**
     * Scheduled jobs that look dead. Added after two features shipped armed and
     * silently non-functional (A5 snapshots, nflFinalizeSweepJob — the latter
     * for ten days). An empty array here is a POSITIVE signal; previously there
     * was no signal at all.
     */
    staleJobs: StaleJob[];
}

export async function computeOpsHealthSummary(
    db: admin.firestore.Firestore
): Promise<OpsHealthSummary> {
    const openAlertsQuery = db.collection("monetization_alerts").where("status", "==", "open");
    const failedWebhooksQuery = db.collection("stripeWebhookEvents").where("status", "==", "failed");

    const [openAlertsCount, openAlertsSample, failedWebhooksCount, failedWebhooksSample] =
        await Promise.all([
            openAlertsQuery.count().get(),
            openAlertsQuery.limit(5).get(),
            failedWebhooksQuery.count().get(),
            failedWebhooksQuery.limit(5).get(),
        ]);

    // Heartbeats live in one doc, so this is a single extra read.
    let heartbeats: Record<string, JobHeartbeat | undefined> = {};
    try {
        heartbeats = ((await db.doc(HEARTBEAT_DOC).get()).data() ?? {}) as Record<string, JobHeartbeat | undefined>;
    } catch (e) {
        // Fail loud in logs but do not break the whole health card.
        console.error("[opsHealth] heartbeat read failed; job liveness unknown:", e);
    }

    return {
        at: Date.now(),
        openAlerts: {
            count: openAlertsCount.data().count,
            sample: openAlertsSample.docs.map((d) => {
                const data = d.data() as { type?: string; message?: string; createdAt?: unknown };
                return {
                    id: d.id,
                    type: data.type ?? "unknown",
                    message: data.message,
                    createdAt: toMillis(data.createdAt),
                };
            }),
        },
        failedWebhooks: {
            count: failedWebhooksCount.data().count,
            sample: failedWebhooksSample.docs.map((d) => {
                const data = d.data() as { eventType?: string; attemptCount?: number; lastFailedAt?: unknown };
                return {
                    id: d.id,
                    eventType: data.eventType,
                    attemptCount: data.attemptCount,
                    lastFailedAt: toMillis(data.lastFailedAt),
                };
            }),
        },
        staleJobs: findStaleJobs(heartbeats, SCHEDULED_JOB_EXPECTATIONS, Date.now()),
    };
}

export const getOpsHealthSummary = validated(
    {
        schema: getOpsHealthSummarySchema,
        label: "getOpsHealthSummary",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
    },
    async (_data, _request) => {
        return computeOpsHealthSummary(admin.firestore());
    }
);
