import * as admin from "firebase-admin";
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import * as crypto from "crypto";
import { generateAIResponse, COMMISSIONER_SYSTEM_PROMPT, geminiApiKey } from "./gemini";
import { writeAuditEvent } from "./audit";
import { GameState, Winner, AIArtifact, AIRequest } from "./types";

const db = admin.firestore();

// Helper to compute SHA256 of facts for idempotency
const computeFactsHash = (facts: any): string => {
    const stableString = JSON.stringify(facts, Object.keys(facts).sort());
    return crypto.createHash("sha256").update(stableString).digest("hex");
};

// --- WINNER EXPLANATION TRIGGER ---
export const onWinnerUpdate = onDocumentWritten({
    document: "pools/{poolId}/winners/{periodId}",
    secrets: [geminiApiKey]
}, async (event) => {
    const periodId = event.params.periodId; // 'q1', 'half', 'q3', 'final'
    const poolId = event.params.poolId;
    const winnerData = event.data?.after.data() as Winner | undefined;

    if (!winnerData) return; // Delete event

    // 1. Gather Verified Facts
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) return;
    const pool = poolSnap.data() as GameState;

    // Digits
    // For '4 Sets', read from quarterlyNumbers. For '1 Set', read from axisNumbers.
    let axis: any = pool.axisNumbers;
    if (pool.numberSets === 4 && pool.quarterlyNumbers) {
        const key = periodId.toLowerCase() as keyof typeof pool.quarterlyNumbers;
        if (pool.quarterlyNumbers[key]) {
            axis = pool.quarterlyNumbers[key];
        }
    }

    // Score
    const scoreSnap = await poolRef.collection("scores").doc(periodId).get();
    const score = scoreSnap.data();

    // Audit Logs (Last 10 critical events)
    const auditSnap = await poolRef.collection("audit")
        .where("severity", "in", ["WARNING", "CRITICAL", "INFO"]) // simplistic filter
        .orderBy("timestamp", "desc")
        .limit(20)
        .get();

    const relevantAuditLogs = auditSnap.docs.map(d => {
        const data = d.data();
        let millis = Date.now();
        if (typeof data.timestamp === 'number') {
            millis = data.timestamp;
        } else if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
            millis = data.timestamp.toMillis();
        }
        return {
            type: data.type,
            timestamp: new Date(millis).toISOString(),
            message: data.message
        };
    });

    const facts = {
        context: "WINNER_EXPLANATION",
        poolConfig: {
            homeTeam: pool.homeTeam,
            awayTeam: pool.awayTeam,
            costPerSquare: pool.costPerSquare,
            ruleVariations: pool.ruleVariations,
            includeOvertime: pool.includeOvertime
        },
        period: periodId,
        digits: axis,
        finalScore: score,
        winnerRecord: winnerData,
        auditTrail: relevantAuditLogs
    };

    const factsHash = computeFactsHash(facts);

    // 2. Check Idempotency
    const artifactsRef = poolRef.collection("ai_artifacts");
    const existingSnap = await artifactsRef
        .where("type", "==", "WINNER_EXPLANATION")
        .where("period", "==", periodId)
        .where("factsHash", "==", factsHash)
        .limit(1)
        .get();

    if (!existingSnap.empty) {
        console.log(`Skipping AI generation for ${periodId}: factsHash match.`);
        return;
    }

    // 3. Generate Content
    try {
        const aiContent = await generateAIResponse(COMMISSIONER_SYSTEM_PROMPT, facts);

        const artifact: AIArtifact = {
            id: `winner-${periodId}-${factsHash.substring(0, 8)}`,
            type: "WINNER_EXPLANATION",
            period: periodId as any,
            targetId: periodId,
            content: aiContent,
            factsHash,
            createdAt: Date.now()
        };

        await artifactsRef.doc(artifact.id).set(artifact);

        // 4. Audit
        await writeAuditEvent({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner explained ${periodId} winner`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, factsHash }
        });

    } catch (e) {
        console.error("AI Generation Failed", e);
    }
});

// --- DISPUTE RESOLUTION TRIGGER ---
export const onAIRequest = onDocumentCreated({
    document: "pools/{poolId}/ai_requests/{requestId}",
    secrets: [geminiApiKey]
}, async (event) => {
    const poolId = event.params.poolId;
    const snapshot = event.data;

    if (!snapshot) return;
    const requestData = snapshot.data() as AIRequest;

    console.log(`[AI-DEBUG] Triggered for request ${event.params.requestId}. Status: ${requestData?.status}`);

    if (!requestData || requestData.status !== 'PENDING') {
        console.log(`[AI-DEBUG] Skipping. Status is ${requestData?.status}`);
        return;
    }

    // 1. Gather Verified Facts (Similar to above but broader context)
    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    const pool = poolSnap.data() as GameState;
    const auditSnap = await poolRef.collection("audit").orderBy("timestamp", "desc").limit(50).get();
    const auditTrail = auditSnap.docs.map(d => {
        const data = d.data();
        let millis = Date.now();
        if (typeof data.timestamp === 'number') {
            millis = data.timestamp;
        } else if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
            millis = data.timestamp.toMillis();
        }
        return {
            type: data.type,
            time: new Date(millis).toISOString(),
            msg: data.message
        };
    });

    const facts = {
        context: "DISPUTE_RESOLUTION",
        userQuestion: requestData.question,
        poolConfig: {
            homeTeam: pool.homeTeam,
            awayTeam: pool.awayTeam,
            payouts: pool.payouts,
            rules: pool.ruleVariations
        },
        currentScore: pool.scores,
        auditTrail // Crucial for "Numbers changed" claims
    };

    // 2. Generate
    try {
        const aiContent = await generateAIResponse(COMMISSIONER_SYSTEM_PROMPT, facts);

        const artifactId = `resp-${event.params.requestId}`;
        const artifact: AIArtifact = {
            id: artifactId,
            type: "DISPUTE_RESPONSE",
            targetId: event.params.requestId,
            content: aiContent,
            factsHash: computeFactsHash(facts),
            createdAt: Date.now()
        };

        // Batch write: Save Artifact + Update Request
        const batch = db.batch();
        batch.set(poolRef.collection("ai_artifacts").doc(artifactId), artifact);
        batch.update(snapshot.ref, {
            status: 'COMPLETED',
            responseArtifactId: artifactId,
            updatedAt: Date.now()
        });

        await batch.commit();

        // 3. Audit
        await writeAuditEvent({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner resolved dispute: ${requestData.question.substring(0, 30)}...`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, requestId: event.params.requestId }
        });

    } catch (e) {
        console.error("AI Dispute Resolution Failed", e);
        await snapshot.ref.update({ status: 'ERROR' });
    }
});
