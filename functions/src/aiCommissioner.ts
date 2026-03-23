import * as admin from "firebase-admin";
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import * as crypto from "crypto";
import { generateAIResponse, COMMISSIONER_SYSTEM_PROMPT, geminiApiKey } from "./gemini";
import { writeAuditEvent } from "./audit";
import { GameState, Winner, AIArtifact, AIRequest, BracketPool, Tournament, BracketEntry } from "./types";

const db = admin.firestore();

// Helper to compute SHA256 of facts for idempotency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const computeFactsHash = (facts: any): string => {
    const stableString = JSON.stringify(facts, Object.keys(facts).sort());
    return crypto.createHash("sha256").update(stableString).digest("hex");
};

// --- WINNER EXPLANATION TRIGGER (Squares only) ---
export const onWinnerUpdate = onDocumentWritten({
    document: "pools/{poolId}/winners/{periodId}",
    secrets: [geminiApiKey]
}, async (event) => {
    const periodId = event.params.periodId;
    const poolId = event.params.poolId;
    const winnerData = event.data?.after.data() as Winner | undefined;

    if (!winnerData) return;

    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) return;
    const pool = poolSnap.data() as GameState;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let axis: any = pool.axisNumbers;
    if (pool.numberSets === 4 && pool.quarterlyNumbers) {
        const key = periodId.toLowerCase() as keyof typeof pool.quarterlyNumbers;
        if (pool.quarterlyNumbers[key]) {
            axis = pool.quarterlyNumbers[key];
        }
    }

    const scoreSnap = await poolRef.collection("scores").doc(periodId).get();
    const score = scoreSnap.data();

    const auditSnap = await poolRef.collection("audit")
        .where("severity", "in", ["WARNING", "CRITICAL", "INFO"])
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
        return { type: data.type, timestamp: new Date(millis).toISOString(), message: data.message };
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

    try {
        const aiContent = await generateAIResponse(COMMISSIONER_SYSTEM_PROMPT, facts);
        const artifact: AIArtifact = {
            id: `winner-${periodId}-${factsHash.substring(0, 8)}`,
            type: "WINNER_EXPLANATION",
            period: periodId as "q1" | "half" | "q3" | "final",
            targetId: periodId,
            content: aiContent,
            factsHash,
            createdAt: Date.now()
        };
        await artifactsRef.doc(artifact.id).set(artifact);
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

// --- DISPUTE / INSIGHT RESOLUTION TRIGGER ---
export const onAIRequest = onDocumentCreated({
    document: "pools/{poolId}/ai_requests/{requestId}",
    secrets: [geminiApiKey]
}, async (event) => {
    const poolId = event.params.poolId;
    const snapshot = event.data;
    if (!snapshot) return;

    const requestData = snapshot.data() as AIRequest;
    console.log(`[AI-DEBUG] Request ${event.params.requestId}. Status: ${requestData?.status}`);

    if (!requestData || requestData.status !== 'PENDING') {
        console.log(`[AI-DEBUG] Skipping. Status is ${requestData?.status}`);
        return;
    }

    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) {
        await snapshot.ref.update({ status: 'ERROR' });
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poolRaw = poolSnap.data() as any;
    const poolType: string = poolRaw.type ?? 'SQUARES';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let facts: Record<string, any>;

    // ── BRACKET POOL: Build rich bracket-aware context ──────────────────────
    if (poolType === 'BRACKET') {
        const bracketPool = poolRaw as BracketPool;

        // Fetch tournament data
        let tournament: Tournament | null = null;
        if (bracketPool.tournamentId) {
            const tSnap = await db.collection('tournaments').doc(bracketPool.tournamentId).get();
            if (tSnap.exists) tournament = tSnap.data() as Tournament;
        }

        // Fetch all entries ordered by score
        const entriesSnap = await poolRef.collection('entries')
            .orderBy('score', 'desc')
            .limit(60)
            .get();
        const allEntries = entriesSnap.docs.map(d => d.data() as BracketEntry);

        // Top-20 standings summary
        const standings = allEntries.slice(0, 20).map((e, idx) => ({
            rank: idx + 1,
            name: e.name,
            score: e.score,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            maxPossibleScore: (e as any).maxPossibleScore ?? null,
            ownerUid: e.ownerUid,
        }));

        // Requesting user's own entries & picks
        const userId = requestData.userId;
        const userEntries = allEntries
            .filter(e => e.ownerUid === userId)
            .map(e => ({
                name: e.name,
                score: e.score,
                picks: e.picks,         // { slotId -> teamId }
                tieBreakerPrediction: e.tieBreakerPrediction ?? null,
            }));

        // Summarise completed & pending games
        let completedGames: object[] = [];
        let pendingGames: object[] = [];
        if (tournament) {
            const games = Object.values(tournament.games);
            completedGames = games
                .filter(g => g.status === 'FINAL')
                .map(g => ({ id: g.id, round: g.round, winner: g.winnerTeamId, home: g.homeTeamId, away: g.awayTeamId }));
            pendingGames = games
                .filter(g => g.status !== 'FINAL')
                .map(g => ({ id: g.id, round: g.round, home: g.homeTeamId, away: g.awayTeamId, status: g.status }));
        }

        facts = {
            context: "BRACKET_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                name: bracketPool.name,
                scoringSystem: bracketPool.settings?.scoringSystem,
                customScoring: bracketPool.settings?.customScoring ?? null,
                upsetBonus: bracketPool.settings?.upsetBonus ?? null,
                entryFee: bracketPool.settings?.entryFee,
                totalEntries: allEntries.length,
                gender: bracketPool.gender,
                seasonYear: bracketPool.seasonYear,
            },
            standings,
            userEntries,
            tournament: tournament ? {
                id: tournament.id,
                isFinalized: tournament.isFinalized,
                status: tournament.status,
                completedGamesCount: completedGames.length,
                pendingGamesCount: pendingGames.length,
                completedGames: completedGames.slice(0, 40),
                pendingGames: pendingGames.slice(0, 20),
            } : null,
        };
    } else {
        // ── SQUARES POOL: Original context ────────────────────────────────────
        const pool = poolRaw as GameState;
        const auditSnap = await poolRef.collection("audit").orderBy("timestamp", "desc").limit(50).get();
        const auditTrail = auditSnap.docs.map(d => {
            const data = d.data();
            let millis = Date.now();
            if (typeof data.timestamp === 'number') {
                millis = data.timestamp;
            } else if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
                millis = data.timestamp.toMillis();
            }
            return { type: data.type, time: new Date(millis).toISOString(), msg: data.message };
        });

        facts = {
            context: "DISPUTE_RESOLUTION",
            userQuestion: requestData.question,
            poolConfig: {
                homeTeam: pool.homeTeam,
                awayTeam: pool.awayTeam,
                payouts: pool.payouts,
                rules: pool.ruleVariations
            },
            currentScore: pool.scores,
            digits: {
                current: pool.axisNumbers,
                quarterly: pool.quarterlyNumbers || null,
                numberSets: pool.numberSets || 1
            },
            auditTrail
        };
    }

    // Generate AI response
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

        const batch = db.batch();
        batch.set(poolRef.collection("ai_artifacts").doc(artifactId), artifact);
        batch.update(snapshot.ref, {
            status: 'COMPLETED',
            responseArtifactId: artifactId,
            updatedAt: Date.now()
        });
        await batch.commit();

        await writeAuditEvent({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner responded: ${requestData.question.substring(0, 40)}...`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, requestId: event.params.requestId }
        });
    } catch (e) {
        console.error("AI Request Resolution Failed", e);
        await snapshot.ref.update({ status: 'ERROR' });
    }
});
