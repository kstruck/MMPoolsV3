
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const inspectPoolState = onRequest(async (req, res) => {
    // Read-only inspector — GET/HEAD only.
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    // Require Firebase Auth token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).send("Unauthorized: Missing Bearer token");
        return;
    }
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        // Use the tamper-proof JWT custom claim, not the mutable Firestore
        // users/{uid}.role field (which a compromised user doc could forge).
        if (decoded.role !== 'SUPER_ADMIN') {
            res.status(403).send("Forbidden: Super Admin access required");
            return;
        }
    } catch {
        res.status(401).send("Unauthorized: Invalid token");
        return;
    }

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
