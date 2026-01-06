
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const inspectPoolState = onRequest(async (req, res) => {
    const poolId = req.query.poolId as string;
    if (!poolId) {
        res.status(400).send("Missing poolId");
        return;
    }

    const db = admin.firestore();
    const doc = await db.collection("pools").doc(poolId).get();

    if (!doc.exists) {
        res.status(404).send("Pool not found");
        return;
    }

    const data = doc.data();
    const winnersSnap = await db.collection("pools").doc(poolId).collection("winners").get();
    const winners = winnersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const auditSnap = await db.collection("pools").doc(poolId).collection("audit_events")
        .orderBy("timestamp", "desc").limit(10).get();
    const audit = auditSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({
        pool: data,
        winners,
        recentAudit: audit
    });
});
