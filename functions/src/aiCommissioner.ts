import * as admin from "firebase-admin";
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import * as crypto from "crypto";
import { generateAIResponse, COMMISSIONER_SYSTEM_PROMPT, BANTER_SYSTEM_PROMPT, geminiApiKey } from "./gemini";
import { writeAuditEvent } from "./audit";
import { resolveGameSpreads } from "./lib/frozenSpreads";
import { normalizeBanterMood, banterTextFromAI, isPoolCommissionerUid } from "./lib/banter";
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

    // ENTITLEMENT (PLAN-COST-CONTROLS 0.5.2). Winner docs are functions-write-
    // only (firestore.rules), so this is not user-triggerable spend — it is
    // UNMONETIZED spend: every squares pool got a paid winner explanation
    // whether or not it bought the addon. Same deny-by-default as onAIRequest.
    if (!pool.billing?.featuresUnlocked?.aiCommissioner) return;

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

    // ENTITLEMENT (PLAN-COST-CONTROLS 0.5.2). Mirrors onWeeklyRecapCreated's
    // check, which was the ONLY provider-path entitlement gate in this file.
    // Deny-by-default: a missing flag is NOT a licence. Do NOT swap in
    // lib/billingAccess.checkBillingAccess here — its `!billing => allowed`
    // legacy carve-out would re-open this hole for exactly the pools most
    // likely to lack a billing object (SWEEPS §4).
    //
    // Defense in depth WITH the rules tighten (0.5.1), not instead of it: the
    // rule stops the write, this stops the spend if a write lands anyway.
    if (!poolRaw.billing?.featuresUnlocked?.aiCommissioner) {
        console.warn(`[AI] Request on pool ${poolId} without the aiCommissioner entitlement; not generating.`);
        await snapshot.ref.update({ status: 'ERROR', error: 'AI_NOT_UNLOCKED', updatedAt: Date.now() });
        return;
    }

    const poolType: string = poolRaw.type ?? 'SQUARES';

    // ── BANTER (PLAN-WIZARD-BUYFLOW-FIXES T9) ───────────────────────────────
    // The commissioner's trash-talk request. Handled HERE rather than in its
    // own trigger so it passes the same entitlement gate above and inherits
    // whatever cost controls this path carries — a second door to the paid
    // provider is exactly what PLAN-COST-CONTROLS 0.5 closed.
    //
    // It ends by writing into `pools/{id}/messages`, the member-readable feed,
    // rather than `ai_artifacts`: the message IS the artifact here, and the
    // feed is what every member reads on the pool homepage. The Admin SDK
    // bypasses rules, which is why the client is forbidden to stamp
    // `kind: 'AI'` — see firestore.rules.
    if (requestData.category === 'BANTER') {
        await generateBanter({ poolId, poolRef, poolRaw, poolType, requestData, requestRef: snapshot.ref });
        return;
    }

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
        // Team seed map for AI context
        const teamSeedMap: Record<string, number> = {};
        if (tournament) {
            const games = Object.values(tournament.games);
            completedGames = games
                .filter(g => g.status === 'FINAL')
                .map(g => ({ id: g.id, round: g.round, winner: g.winnerTeamId, home: g.homeTeamId, away: g.awayTeamId }));
            pendingGames = games
                .filter(g => g.status !== 'FINAL')
                .map(g => ({ id: g.id, round: g.round, home: g.homeTeamId, away: g.awayTeamId, status: g.status }));

            // Build seed map so AI knows which teams are favorites/upsets
            if (tournament.importedTeams) {
                for (const [teamId, teamData] of Object.entries(tournament.importedTeams)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const seed = (teamData as any).seed;
                    if (seed !== undefined) teamSeedMap[teamId] = seed;
                }
            }
        }

        // Scoring values for Fibonacci or Classic so AI can calculate scenarios
        const scoringSystem = bracketPool.settings?.scoringSystem ?? 'classic';
        const scoringValues: Record<string, number[]> = {
            fibonacci: [1, 2, 3, 5, 8, 13],               // rounds 1-6
            classic:   [1, 2, 4, 8, 16, 32],
            ...(bracketPool.settings?.customScoring ? { custom: bracketPool.settings.customScoring } : {}),
        };

        // Identify the requesting user's top competitor (highest-ranked entry NOT owned by them)
        const topCompetitor = allEntries.find(e => e.ownerUid !== userId);

        facts = {
            context: "BRACKET_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                name: bracketPool.name,
                scoringSystem,
                scoringValues,                  // e.g. { fibonacci: [1,2,3,5,8,13] }
                upsetBonus: bracketPool.settings?.upsetBonus ?? null,
                entryFee: bracketPool.settings?.entryFee,
                totalEntries: allEntries.length,
                gender: bracketPool.gender,
                seasonYear: bracketPool.seasonYear,
            },
            standings,
            userEntries,
            teamSeeds: teamSeedMap,              // { "DUKE": 1, "GONZAGA": 2, ... }
            topCompetitor: topCompetitor ? {
                name: topCompetitor.name,
                score: topCompetitor.score,
                picks: topCompetitor.picks,
            } : null,
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
    } else if (poolType.startsWith('NFL_')) {
        // ── NFL POOLS: Context ────────────────────────────────────
        const entriesSnap = await poolRef.collection('entries').limit(60).get();
        const allEntries = entriesSnap.docs.map(d => d.data());
        
        const gamesSnap = await db.collection('nfl_games')
            .where('season', '==', poolRaw.season)
            .where('seasonType', '==', Number(poolRaw.seasonType || 2))
            .limit(32)
            .get();
        // `frozen ?? working` (PLAN-NFL-SPREAD-FREEZE R1). These game documents are
        // handed to the model as FACTS and quoted back to a member, spread included,
        // so an unresolved read lets the assistant state a line the pool is not
        // graded on.
        const recentGames = await resolveGameSpreads(
            db,
            gamesSnap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })),
        );

        facts = {
            context: "NFL_POOL_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                type: poolType,
                name: poolRaw.name,
                season: poolRaw.season,
                settings: poolRaw.settings
            },
            standings: allEntries.slice(0, 20),
            userEntries: allEntries.filter(e => e.ownerUid === requestData.userId),
            recentGames
        };
    } else if (poolType === 'PROPS') {
        // ── PROPS POOL: Context ────────────────────────────────────
        const cardsSnap = await poolRef.collection('propCards').get();
        const allCards = cardsSnap.docs.map(d => d.data());
        
        facts = {
            context: "PROPS_INSIGHT",
            userQuestion: requestData.question,
            poolConfig: {
                name: poolRaw.name,
                props: poolRaw.props
            },
            standings: allCards.sort((a: any, b: any) => b.score - a.score).slice(0, 20),
            userCards: allCards.filter(c => c.userId === requestData.userId)
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

// --- PROACTIVE WEEKLY RECAP / TRASH TALK TRIGGER ---
export const onWeeklyRecapCreated = onDocumentCreated({
    document: "pools/{poolId}/weekly_recaps/{recapId}",
    secrets: [geminiApiKey]
}, async (event) => {
    const poolId = event.params.poolId;
    const recapSnap = event.data;
    if (!recapSnap) return;

    const recapData = recapSnap.data();

    const poolRef = db.collection("pools").doc(poolId);
    const poolSnap = await poolRef.get();
    if (!poolSnap.exists) return;

    const poolRaw = poolSnap.data() as any;
    
    // Ensure AI Commissioner is active for this pool
    if (!poolRaw.billing?.featuresUnlocked?.aiCommissioner) return;

    const facts = {
        context: "WEEKLY_RECAP_TRASH_TALK",
        poolConfig: {
            name: poolRaw.name,
            type: poolRaw.type,
            season: poolRaw.season
        },
        recapData
    };

    const factsHash = computeFactsHash(facts);
    const artifactsRef = poolRef.collection("ai_artifacts");
    const existingSnap = await artifactsRef
        .where("factsHash", "==", factsHash)
        .limit(1)
        .get();

    if (!existingSnap.empty) return;

    try {
        const aiContent = await generateAIResponse(COMMISSIONER_SYSTEM_PROMPT, facts);
        const artifact: AIArtifact = {
            id: `recap-${recapData.week}-${factsHash.substring(0, 8)}`,
            type: "WEEKLY_RECAP",
            targetId: recapSnap.id,
            content: aiContent,
            factsHash,
            createdAt: Date.now()
        };
        await artifactsRef.doc(artifact.id).set(artifact);
        await writeAuditEvent({
            poolId,
            type: "AI_ARTIFACT_CREATED",
            message: `AI Commissioner published weekly recap trash talk for week ${recapData.week}`,
            severity: "INFO",
            actor: { uid: "ai-commissioner", role: "SYSTEM", label: "Gemini" },
            payload: { artifactId: artifact.id, factsHash }
        });
    } catch (e) {
        console.error("Weekly Recap AI Generation Failed", e);
    }
});

// ---------------------------------------------------------------------------
// BANTER generation (PLAN-WIZARD-BUYFLOW-FIXES T9)
// ---------------------------------------------------------------------------


async function generateBanter(args: {
    poolId: string;
    poolRef: FirebaseFirestore.DocumentReference;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    poolRaw: any;
    poolType: string;
    requestData: AIRequest;
    requestRef: FirebaseFirestore.DocumentReference;
}): Promise<void> {
    const { poolId, poolRef, poolRaw, poolType, requestData, requestRef } = args;
    const mood = normalizeBanterMood(requestData.mood);

    // ⚠️ COMMISSIONER-ONLY (codex r1 [P1] on T9). `ai_requests` create is
    // participant-scoped — correctly, since disputes and insights are a
    // member's to ask — but BANTER is different in kind: the result is posted
    // pool-wide under the AI Commissioner's identity. Without this, any
    // participant could bypass the manager-only card, spend the paid provider,
    // and publish AI-authored posts to everyone.
    //
    // Enforced HERE rather than by widening the ai_requests create rule: those
    // four conditions are load-bearing and category-blind, and a per-category
    // branch in a security rule is the kind of complexity that gets
    // "simplified" later. This also stops the SPEND, which the rule would not
    // if a write ever landed another way.
    // The role read is deliberately LAST and only on the path where the cheap
    // pool-field checks already failed: one extra document read on a rare
    // request, never on the common commissioner one.
    const callerRole = isPoolCommissionerUid(poolRaw, requestData.userId)
        ? undefined
        : (await db.collection('users').doc(requestData.userId).get()).data()?.role;
    if (!isPoolCommissionerUid(poolRaw, requestData.userId, callerRole)) {
        console.warn(`[AI] BANTER request on pool ${poolId} from a non-commissioner; refusing.`);
        await requestRef.update({ status: 'ERROR', error: 'BANTER_NOT_COMMISSIONER', updatedAt: Date.now() });
        return;
    }

    try {
        // A deliberately SMALL fact set. Banter needs the scoreboard, not the
        // schedule: the dispute path's game/tournament fetches are several reads
        // per request and none of them makes a one-liner funnier.
        const standingsSnap = await poolRef.collection('standings').doc('current').get();
        const standingsRows = (standingsSnap.data()?.rows ?? []) as Record<string, unknown>[];

        const facts = {
            context: 'POOL_BANTER',
            mood,
            commissionerPrompt: requestData.question,
            poolConfig: {
                type: poolType,
                name: poolRaw.name,
                season: poolRaw.season,
            },
            // Names and numbers only. Everything the model is allowed to be rude
            // about has to be in here, and nothing else is.
            standings: standingsRows.slice(0, 20).map((r) => ({
                rank: r.rank ?? null,
                name: r.displayName ?? r.name ?? null,
                seasonPoints: r.seasonPoints ?? r.points ?? null,
                weekPoints: r.weekPoints ?? null,
            })),
            hasPlayedAWeek: standingsRows.length > 0,
        };

        const ai = await generateAIResponse(BANTER_SYSTEM_PROMPT, facts);
        const text = banterTextFromAI(ai);
        if (!text) throw new Error('BANTER_EMPTY');

        const batch = db.batch();
        batch.set(poolRef.collection('messages').doc(), {
            authorUid: 'ai-commissioner',
            authorName: 'AI Commissioner',
            text,
            kind: 'AI',
            mood,
            requestedByUid: requestData.userId,
            timestamp: Date.now(),
        });
        batch.update(requestRef, { status: 'COMPLETED', updatedAt: Date.now() });
        await batch.commit();

        await writeAuditEvent({
            poolId,
            type: 'AI_ARTIFACT_CREATED',
            message: `AI Commissioner posted ${mood} banter`,
            severity: 'INFO',
            actor: { uid: 'ai-commissioner', role: 'SYSTEM', label: 'Gemini' },
            payload: { mood, requestedByUid: requestData.userId },
        });
    } catch (e) {
        console.error('AI Banter generation failed', e);
        // Same shape as every other failure on this trigger: the request carries
        // the verdict so the card can say something specific instead of spinning.
        await requestRef.update({ status: 'ERROR', error: 'BANTER_FAILED', updatedAt: Date.now() });
    }
}
