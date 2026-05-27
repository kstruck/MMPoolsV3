"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectPoolState = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
exports.inspectPoolState = (0, https_1.onRequest)(async (req, res) => {
    var _a;
    // Require Firebase Auth token
    const authHeader = req.headers.authorization;
    if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer '))) {
        res.status(401).send("Unauthorized: Missing Bearer token");
        return;
    }
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        const userDoc = await admin.firestore().collection("users").doc(decoded.uid).get();
        if (((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
            res.status(403).send("Forbidden: Super Admin access required");
            return;
        }
    }
    catch (_b) {
        res.status(401).send("Unauthorized: Invalid token");
        return;
    }
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