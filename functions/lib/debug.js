"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectPoolState = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
exports.inspectPoolState = (0, https_1.onRequest)(async (req, res) => {
    const poolId = req.query.poolId;
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
    const winners = winnersSnap.docs.map(d => (Object.assign({ id: d.id }, d.data())));
    const auditSnap = await db.collection("pools").doc(poolId).collection("audit_events")
        .orderBy("timestamp", "desc").limit(10).get();
    const audit = auditSnap.docs.map(d => (Object.assign({ id: d.id }, d.data())));
    res.json({
        pool: data,
        winners,
        recentAudit: audit
    });
});
//# sourceMappingURL=debug.js.map