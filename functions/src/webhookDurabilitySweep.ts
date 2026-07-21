import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { writeAdminAudit } from "./lib/adminAudit";
import { dispatchOpsAlert } from "./lib/opsAlertDispatcher";
import { captureMonetizationAlert } from "./lib/sentryServer";
import { isWebhookStuck, WEBHOOK_STUCK_MS } from "./lib/webhookDurability";
import { withHeartbeat } from "./lib/heartbeat";

/**
 * Daily backstop for the webhook-durability SLO (PLAN-SECURITY-OBSERVABILITY.md
 * #14): "zero stripeWebhookEvents stuck in failed past threshold" is a hard
 * objective. shouldAlertOnFailure() in webhookDurability.ts only fires while
 * Stripe is actively retrying the same event.id up to the attempt threshold —
 * an event that fails once or twice and is never retried again would
 * otherwise sit in status:"failed" forever with no further alert. This sweep
 * is the independent, time-based check: it doesn't care about attemptCount,
 * only how long a doc has been stuck.
 *
 * Read-only + alert-only (no Firestore mutation), so this does not need the
 * kill-switch/dry-run pattern that data-mutating sweeps require — worst case
 * of a bug here is a missed or spurious page, not corrupted data. Bounded
 * scan (SCAN_LIMIT) as a safety cap regardless.
 */

const SCAN_LIMIT = 200;

export interface StuckWebhookEvent {
    id: string;
    eventType?: string;
    attemptCount?: number;
    lastFailedAt: number | undefined;
}

export async function findStuckWebhookEvents(
    db: admin.firestore.Firestore,
    nowMs: number,
    thresholdMs: number = WEBHOOK_STUCK_MS,
): Promise<StuckWebhookEvent[]> {
    const snap = await db
        .collection("stripeWebhookEvents")
        .where("status", "==", "failed")
        .limit(SCAN_LIMIT)
        .get();

    const stuck: StuckWebhookEvent[] = [];
    for (const doc of snap.docs) {
        const data = doc.data() as { eventType?: string; attemptCount?: number; lastFailedAt?: number };
        if (isWebhookStuck(data.lastFailedAt, nowMs, thresholdMs)) {
            stuck.push({ id: doc.id, eventType: data.eventType, attemptCount: data.attemptCount, lastFailedAt: data.lastFailedAt });
        }
    }
    return stuck;
}

export const webhookDurabilitySweep = onSchedule("every 24 hours", withHeartbeat('webhookDurabilitySweep', async () => {
    const db = admin.firestore();
    const nowMs = Date.now();
    const stuck = await findStuckWebhookEvents(db, nowMs);

    if (stuck.length === 0) {
        console.log("[webhookDurabilitySweep] no webhook events stuck past threshold.");
        return { detail: { stuckCount: 0 } };
    }

    console.warn(`[webhookDurabilitySweep] ${stuck.length} webhook event(s) stuck in failed past ${WEBHOOK_STUCK_MS / 3600000}h`);
    const sample = stuck.slice(0, 5).map((s) => `${s.id} (${s.attemptCount ?? "?"} attempts)`).join(", ");

    captureMonetizationAlert("WEBHOOK_FAILED", { stuckCount: stuck.length, sample });
    const delivery = await dispatchOpsAlert(db, {
        type: "WEBHOOK_FAILED",
        title: `${stuck.length} Stripe webhook event(s) stuck in failed`,
        message: `${stuck.length} webhook event(s) have been status:"failed" for over 24h (SLO objective: zero). Review Super-Admin → Overview → Ops Health.`,
        context: { count: stuck.length, sample },
    });
    const audited = await writeAdminAudit({
        actorUid: "system",
        action: "WEBHOOK_DURABILITY_SWEEP",
        targetType: "stripeWebhookEvents",
        metadata: { stuckCount: stuck.length, sample },
        status: "success",
    });

    // This sweep exists to SHOUT about stuck Stripe webhooks — money that a
    // customer paid and the system never applied. Both of its outputs swallow
    // their own failures, so a run that found stuck events and then reached
    // nobody is the worst possible silent success.
    const lost: string[] = [];
    if (delivery === "failed") lost.push("ops page undelivered");
    if (!audited) lost.push("audit entry not written");
    return lost.length > 0
        ? { ok: false, error: `${stuck.length} stuck event(s) found but ${lost.join(" and ")}`, detail: { stuckCount: stuck.length } }
        : { detail: { stuckCount: stuck.length } };
}));
