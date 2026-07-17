import * as admin from "firebase-admin";
import { validated } from "./lib/validated";
import { getOpsHealthSummarySchema } from "./schemas/opsHealth";

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
