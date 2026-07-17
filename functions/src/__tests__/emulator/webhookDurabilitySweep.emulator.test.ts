import { describe, it, expect, beforeEach } from "vitest";
import * as admin from "firebase-admin";
import "./setup";
import { findStuckWebhookEvents } from "../../webhookDurabilitySweep";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

async function clearCollection(name: string) {
    const db = admin.firestore();
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe("findStuckWebhookEvents (emulator)", () => {
    beforeEach(async () => {
        await clearCollection("stripeWebhookEvents");
    });

    it("returns nothing when there are no failed events", async () => {
        const db = admin.firestore();
        expect(await findStuckWebhookEvents(db, NOW)).toEqual([]);
    });

    it("only returns failed events past the stuck threshold, ignoring recent failures and non-failed statuses", async () => {
        const db = admin.firestore();
        await db.collection("stripeWebhookEvents").doc("evt_stuck").set({
            status: "failed", eventType: "checkout.session.completed", attemptCount: 2, lastFailedAt: NOW - DAY - 1,
        });
        await db.collection("stripeWebhookEvents").doc("evt_recent").set({
            status: "failed", eventType: "payment_intent.payment_failed", attemptCount: 1, lastFailedAt: NOW - 1000,
        });
        await db.collection("stripeWebhookEvents").doc("evt_completed").set({
            status: "completed", lastFailedAt: NOW - DAY * 5,
        });

        const stuck = await findStuckWebhookEvents(db, NOW);
        expect(stuck).toHaveLength(1);
        expect(stuck[0]).toMatchObject({ id: "evt_stuck", eventType: "checkout.session.completed", attemptCount: 2 });
    });
});
