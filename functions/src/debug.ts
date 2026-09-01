
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { confirmedSuperAdminHttp } from "./lib/confirmedRole";

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
    // Token verification stays its own 401 boundary; role confirmation is the
    // separate 403 below. The old comment argued claim-ONLY was safer than the
    // doc; the codebase standard is claim AND doc AGREEMENT (assertCallerRole /
    // hasConfirmedRole), which keeps the tamper-proof claim requirement AND
    // closes the demoted-admin stale-token window (Phase 3).
    let decoded: { uid: string; role?: unknown };
    try {
        const token = authHeader.split('Bearer ')[1];
        decoded = await admin.auth().verifyIdToken(token);
    } catch {
        res.status(401).send("Unauthorized: Invalid token");
        return;
    }
    if (!(await confirmedSuperAdminHttp(decoded))) {
        res.status(403).send("Forbidden: Super Admin access required");
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
