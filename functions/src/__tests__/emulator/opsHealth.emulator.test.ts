import { describe, it, expect, beforeEach } from "vitest";
import * as admin from "firebase-admin";
import "./setup";
import { computeOpsHealthSummary } from "../../opsHealth";

async function clearCollection(name: string) {
    const db = admin.firestore();
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe("computeOpsHealthSummary (emulator)", () => {
    beforeEach(async () => {
        await clearCollection("monetization_alerts");
        await clearCollection("stripeWebhookEvents");
    });

    it("counts zero when both collections are empty", async () => {
        const db = admin.firestore();
        const summary = await computeOpsHealthSummary(db);
        expect(summary.openAlerts.count).toBe(0);
        expect(summary.failedWebhooks.count).toBe(0);
        expect(summary.openAlerts.sample).toEqual([]);
        expect(summary.failedWebhooks.sample).toEqual([]);
    });

    it("counts only status:open alerts and status:failed webhook events, with samples", async () => {
        const db = admin.firestore();
        await db.collection("monetization_alerts").doc("a1").set({
            type: "WEBHOOK_FAILED", status: "open", createdAt: 1000,
        });
        await db.collection("monetization_alerts").doc("a2").set({
            type: "REFUND", status: "acked", createdAt: 2000, // acked — should NOT count
        });
        await db.collection("stripeWebhookEvents").doc("evt_1").set({
            status: "failed", eventType: "checkout.session.completed", attemptCount: 3, lastFailedAt: 3000,
        });
        await db.collection("stripeWebhookEvents").doc("evt_2").set({
            status: "completed", // should NOT count
        });

        const summary = await computeOpsHealthSummary(db);
        expect(summary.openAlerts.count).toBe(1);
        expect(summary.openAlerts.sample).toHaveLength(1);
        expect(summary.openAlerts.sample[0]).toMatchObject({ id: "a1", type: "WEBHOOK_FAILED", createdAt: 1000 });

        expect(summary.failedWebhooks.count).toBe(1);
        expect(summary.failedWebhooks.sample).toHaveLength(1);
        expect(summary.failedWebhooks.sample[0]).toMatchObject({
            id: "evt_1", eventType: "checkout.session.completed", attemptCount: 3, lastFailedAt: 3000,
        });
    });
});
