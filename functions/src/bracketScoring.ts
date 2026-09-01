import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { scoreBracketEntriesSchema, finalizeTournamentPayoutsSchema } from "./schemas/bracketScoring";
import { Tournament, BracketPool, BracketEntry } from "./types";
import { sendEmail } from "./reminders";
import { renderEmailHtml, escapeHtml, BASE_URL } from "./emailStyles";
import { rethrowOrInternal } from "./lib/safeError";


// Scoring Constants — must match ROUND_CONFIG in BracketWizard.tsx
const SCORING_Multipliers = {
    CLASSIC:  [10, 20, 40, 80, 160, 320],        // Standard ESPN-style 10x base
    ESPN:     [10, 20, 40, 80, 160, 320],         // ESPN-style 10x base
    FIBONACCI: [10, 20, 30, 50, 80, 130],
};

/**
 * Returns a Set of Team IDs that have been eliminated from the tournament.
 */
export const getEliminatedTeams = (tournament: Tournament): Set<string> => {
    const eliminated = new Set<string>();
    Object.values(tournament.games).forEach(game => {
        if (game.status === 'FINAL' && game.winnerTeamId) {
            if (game.homeTeamId === game.winnerTeamId) {
                eliminated.add(game.awayTeamId);
            } else if (game.awayTeamId === game.winnerTeamId) {
                eliminated.add(game.homeTeamId);
            }
        }
    });
    return eliminated;
};

/**
 * @deprecated Team IDs are now display names (e.g. "Arkansas Razorbacks"), not formatted IDs.
 * Use getSeedForTeam(teamId, tournament) instead.
 */
export function extractSeedFromTeamId(teamId: string | undefined | null): number | null {
    if (!teamId) return null;
    // Legacy regex — may not match display-name team IDs. Use getSeedForTeam when tournament is available.
    const match = teamId.match(/^[A-Za-z]+(\d+)-/);
    if (match) return parseInt(match[1], 10);
    return null;
}

/**
 * Looks up the seed for a team by display name using the tournament's importedTeams map.
 * Falls back to the legacy regex for backwards compatibility.
 */
function getSeedForTeam(teamId: string | undefined | null, tournament: Tournament): number | null {
    if (!teamId) return null;
    // Primary: look up in importedTeams (keyed by display name, e.g. "Arkansas Razorbacks" → { seed: 4 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seed = (tournament as any).importedTeams?.[teamId]?.seed;
    if (typeof seed === 'number' && seed > 0) return seed;
    // Fallback: legacy regex for old-format IDs
    return extractSeedFromTeamId(teamId);
}

/**
 * Calculates current score + potential remaining points.
 */
export const calculateEntryMaxScore = (
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings'],
    eliminatedTeams?: Set<string>
): number => {
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;

    if (system === 'ESPN') multipliers = SCORING_Multipliers.ESPN;
    if (system === 'FIBONACCI') multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }

    if (!eliminatedTeams) {
        eliminatedTeams = getEliminatedTeams(tournament);
    }

    const upsetBonusEnabled = settings.upsetBonus?.enabled ?? false;
    const upsetMultiplier = settings.upsetBonus?.multiplier ?? 1;

    let maxScore = 0;

    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        const slot = tournament.slots[slotId];
        if (!slot) return;

        const game = tournament.games[slot.gameId];
        if (!game) return;

        const roundIndex = game.round - 1;
        if (roundIndex < 0 || roundIndex >= multipliers.length) return;

        const points = multipliers[roundIndex];

        if (game.status === 'FINAL') {
            if (game.winnerTeamId === pickedTeamId) {
                maxScore += points;

                if (upsetBonusEnabled) {
                    const winnerSeed = getSeedForTeam(game.winnerTeamId, tournament);
                    const loserId = game.homeTeamId === game.winnerTeamId ? game.awayTeamId : game.homeTeamId;
                    const loserSeed = getSeedForTeam(loserId, tournament);

                    if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
                        maxScore += (winnerSeed - loserSeed) * upsetMultiplier;
                    }
                }
            }
        } else {
            if (!eliminatedTeams.has(pickedTeamId)) {
                maxScore += points;

                if (upsetBonusEnabled) {
                    const pickSeed = getSeedForTeam(pickedTeamId, tournament);
                    if (pickSeed) {
                        const opponentId = game.homeTeamId === pickedTeamId ? game.awayTeamId : (game.awayTeamId === pickedTeamId ? game.homeTeamId : null);
                        if (opponentId && !eliminatedTeams!.has(opponentId)) {
                            const oppSeed = getSeedForTeam(opponentId, tournament);
                            if (oppSeed && pickSeed > oppSeed) {
                                maxScore += (pickSeed - oppSeed) * upsetMultiplier;
                            }
                        } else if (!opponentId && pickSeed > 1) {
                            maxScore += (pickSeed - 1) * upsetMultiplier;
                        }
                    }
                }
            }
        }
    });

    return maxScore;
};
/**
 * Calculates score for a single entry
 */
export const calculateEntryScore = (
    entry: BracketEntry,
    tournament: Tournament,
    settings: BracketPool['settings']
): number => {
    let score = 0;
    const system = settings.scoringSystem;
    let multipliers = SCORING_Multipliers.CLASSIC;

    if (system === 'ESPN') multipliers = SCORING_Multipliers.ESPN;
    if (system === 'FIBONACCI') multipliers = SCORING_Multipliers.FIBONACCI;
    if (system === 'CUSTOM' && settings.customScoring && settings.customScoring.length > 0) {
        multipliers = settings.customScoring;
    }

    const upsetBonusEnabled = settings.upsetBonus?.enabled ?? false;
    const upsetMultiplier = settings.upsetBonus?.multiplier ?? 1;

    // Iterate all picks
    Object.entries(entry.picks).forEach(([slotId, pickedTeamId]) => {
        // Find Game for this slot
        const slot = tournament.slots[slotId];
        if (!slot) return;

        const game = tournament.games[slot.gameId];
        if (!game || !game.winnerTeamId) return;

        // Check if pick is correct
        if (game.winnerTeamId === pickedTeamId) {
            // Add points based on round
            // Round is 1-6. Array is 0-5.
            const roundIndex = game.round - 1;
            if (roundIndex >= 0 && roundIndex < multipliers.length) {
                score += multipliers[roundIndex];
            }

            if (upsetBonusEnabled) {
                const winnerSeed = getSeedForTeam(game.winnerTeamId, tournament);
                const loserId = game.homeTeamId === game.winnerTeamId ? game.awayTeamId : game.homeTeamId;
                const loserSeed = getSeedForTeam(loserId, tournament);

                if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
                    score += (winnerSeed - loserSeed) * upsetMultiplier;
                }
            }
        }
    });

    return score;
};

/**
 * Internal logic to score all entries for a tournament.
 */
export const scoreTournamentEntries = async (db: admin.firestore.Firestore, tournamentId: string) => {
    const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tournamentSnap.exists) throw new Error('Tournament not found');

    const tournament = tournamentSnap.data() as Tournament;
    const eliminatedTeams = getEliminatedTeams(tournament);

    // Find championship to evaluate tiebreakers if finished
    const games = Object.values(tournament.games);
    const maxRound = games.reduce((max, g) => Math.max(max, g.round), 0);
    const championshipGame = games.find(g => g.round === maxRound);

    let actualTotal: number | null = null;
    if (championshipGame?.status === 'FINAL') {
        actualTotal = (championshipGame.homeScore || 0) + (championshipGame.awayScore || 0);
    }

    const poolsSnap = await db.collection('pools')
        .where('type', '==', 'BRACKET')
        .where('tournamentId', '==', tournamentId)
        .get();

    const pools = poolsSnap.docs.map(d => {
        const poolData = d.data() as BracketPool;
        poolData.id = d.id;
        return poolData;
    });

    let totalEntriesScored = 0;

    for (const pool of pools) {
        const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
        if (entriesSnap.empty) continue;

        // 1. Calculate Score & Max for all
        const scoredEntries = entriesSnap.docs.map(doc => {
            const entry = doc.data() as BracketEntry;
            const newScore = calculateEntryScore(entry, tournament, pool.settings);
            const newMax = calculateEntryMaxScore(entry, tournament, pool.settings, eliminatedTeams);
            return {
                docRef: doc.ref,
                entry: { ...entry, score: newScore },
                max: newMax,
                originalEntry: entry
            };
        });

        // 2. Sort to compute Rank
        scoredEntries.sort((a, b) => {
            // Primary: Current score desc
            if (b.entry.score !== a.entry.score) return b.entry.score - a.entry.score;

            // Secondary: Max possible desc
            if (b.max !== a.max) return b.max - a.max;

            // Tiebreaker if Championship is finalized
            if (actualTotal !== null && a.entry.tieBreakerPrediction !== undefined && b.entry.tieBreakerPrediction !== undefined) {
                const diffA = a.entry.tieBreakerPrediction - actualTotal;
                const diffB = b.entry.tieBreakerPrediction - actualTotal;

                if (pool.settings.tieBreakers?.closestUnder) {
                    const aUnder = diffA <= 0;
                    const bUnder = diffB <= 0;
                    if (aUnder && !bUnder) return -1;
                    if (!aUnder && bUnder) return 1;
                    if (aUnder && bUnder) return Math.abs(diffA) - Math.abs(diffB);
                }

                return Math.abs(diffA) - Math.abs(diffB);
            }
            return 0;
        });

        // 3. Assign Ranks
        let currentRank = 1;
        scoredEntries.forEach((se, idx) => {
            if (idx > 0) {
                const prev = scoredEntries[idx - 1];
                let trulyTied = se.entry.score === prev.entry.score && se.max === prev.max;
                if (trulyTied && actualTotal !== null) {
                    if (se.entry.tieBreakerPrediction !== undefined && prev.entry.tieBreakerPrediction !== undefined) {
                        const diffSe = se.entry.tieBreakerPrediction - actualTotal;
                        const diffPrev = prev.entry.tieBreakerPrediction - actualTotal;

                        if (pool.settings.tieBreakers?.closestUnder) {
                            const seUnder = diffSe <= 0;
                            const prevUnder = diffPrev <= 0;
                            if (seUnder !== prevUnder || Math.abs(diffSe) !== Math.abs(diffPrev)) trulyTied = false;
                        } else {
                            if (Math.abs(diffSe) !== Math.abs(diffPrev)) trulyTied = false;
                        }
                    } else if (se.entry.tieBreakerPrediction !== prev.entry.tieBreakerPrediction) {
                        trulyTied = false;
                    }
                }

                if (!trulyTied) currentRank = idx + 1;
            }
            se.entry.rank = currentRank;
        });

        // 4. Batch Updates
        const updates = scoredEntries.filter(se =>
            se.entry.score !== se.originalEntry.score ||
            se.entry.rank !== se.originalEntry.rank ||
            se.max !== (se.originalEntry as unknown as { maxScore?: number }).maxScore
        );

        if (updates.length > 0) {
            let batch = db.batch();
            let batchCount = 0;

            for (const upd of updates) {
                batch.update(upd.docRef, {
                    score: upd.entry.score,
                    rank: upd.entry.rank,
                    maxScore: upd.max,
                    updatedAt: Date.now()
                });
                batchCount++;
                if (batchCount >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
            if (batchCount > 0) {
                await batch.commit();
            }
            totalEntriesScored += updates.length;
        }
    }
    return totalEntriesScored;
};

/**
 * Cloud Function to score ALL entries for a given tournament.
 */
export const scoreBracketEntries = validated(
    { schema: scoreBracketEntriesSchema, label: "scoreBracketEntries", role: "SUPER_ADMIN", appCheck: "monitor" },
    async ({ tournamentId }) => {
    const db = admin.firestore();

    try {
        let totalScored = 0;
        if (tournamentId) {
            // Score a specific tournament
            totalScored = await scoreTournamentEntries(db, tournamentId);
            logger.info(`Scored ${totalScored} entries for tournament ${tournamentId}.`);
        } else {
            // Score only tournaments that are linked to at least one BRACKET pool.
            // Querying pools first avoids scoring test/seed/empty tournament docs.
            const poolsSnap = await db.collection('pools')
                .where('type', '==', 'BRACKET')
                .get();

            // Collect unique tournament IDs that have active pools
            const tournamentIds = [...new Set(
                poolsSnap.docs
                    .map(d => d.data().tournamentId as string | undefined)
                    .filter((id): id is string => !!id)
            )];

            logger.info(`Scoring ${tournamentIds.length} pool-linked tournament(s): ${tournamentIds.join(', ')}`);

            for (const tid of tournamentIds) {
                try {
                    const count = await scoreTournamentEntries(db, tid);
                    totalScored += count;
                    logger.info(`Scored ${count} entries for tournament ${tid}.`);
                } catch (err) {
                    logger.warn(`Skipped tournament ${tid}:`, err);
                }
            }
        }
        logger.info(`Total scored: ${totalScored} entries.`);
        return { success: true, scored: totalScored, message: `Scoring complete! (${totalScored} entries)` };
    } catch (e: unknown) {
        logger.error('Error scoring bracket entries:', e);
        // Stable generic to the client; the log line above keeps the message
        // (Phase 1, PLAN-API-TRUST-BOUNDARY — this was an alias-shape leak).
        rethrowOrInternal('scoreBracketEntries', e);
    }
    },
);



/**
 * Cloud Function to finalize pot distribution and payouts for a completed tournament.
 */
export const finalizeTournamentPayouts = validated(
    { schema: finalizeTournamentPayoutsSchema, label: "finalizeTournamentPayouts", role: "SUPER_ADMIN", appCheck: "monitor" },
    async ({ tournamentId }) => {
    const db = admin.firestore();
    const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tournamentSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    const tournament = tournamentSnap.data() as Tournament;

    if (!tournament.isFinalized) {
        logger.warn(`Admin finalizing payouts for unfinalized tournament: ${tournamentId}`);
    }

    const poolsSnap = await db.collection('pools').where('type', '==', 'BRACKET').get();
    const pools = poolsSnap.docs.filter(p => (p.data() as BracketPool).tournamentId === tournamentId);

    let payoutCount = 0;

    for (const poolDoc of pools) {
        const pool = Object.assign(poolDoc.data(), { id: poolDoc.id }) as BracketPool;
        const entryFee = pool.settings?.entryFee || 0;
        if (entryFee <= 0) continue; // Free pool

        const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
        if (entriesSnap.empty) continue;

        // Count entries that have paidStatus === 'PAID'
        const paidEntries = entriesSnap.docs.map(d => d.data() as BracketEntry).filter(e => e.paidStatus === 'PAID');
        const pot = paidEntries.length * entryFee;
        if (pot <= 0) continue;

        const eligibleEntries = entriesSnap.docs.map(doc => Object.assign(doc.data(), { _ref: doc.ref }) as BracketEntry & { _ref: admin.firestore.DocumentReference });

        // Group explicitly by rank (so ties are naturally array length > 1)
        const entriesByRank: Record<number, typeof eligibleEntries> = {};
        eligibleEntries.forEach(entry => {
            if (!entry.rank) return;
            if (!entriesByRank[entry.rank]) entriesByRank[entry.rank] = [];
            entriesByRank[entry.rank].push(entry);
        });

        const payouts = pool.settings.payouts?.places || [];
        if (payouts.length === 0) continue;

        let placeIndex = 0;
        let nextRank = 1;

        const winningsUpdates: { ref: admin.firestore.DocumentReference, amountWon: number }[] = [];

        while (placeIndex < payouts.length) {
            const tiedEntries = entriesByRank[nextRank] || [];
            if (tiedEntries.length === 0) {
                nextRank++;
                if (nextRank > eligibleEntries.length) break;
                continue;
            }

            const numTied = tiedEntries.length;
            let availablePercentage = 0;
            const consumedPlaces = Math.min(numTied, payouts.length - placeIndex);

            for (let i = 0; i < consumedPlaces; i++) {
                availablePercentage += payouts[placeIndex + i].percentage;
            }

            const splitPayout = (pot * (availablePercentage / 100)) / numTied;

            if (splitPayout > 0) {
                for (const entry of tiedEntries) {
                    winningsUpdates.push({ ref: entry._ref, amountWon: splitPayout });
                    payoutCount++;
                }
            }

            placeIndex += consumedPlaces;
            nextRank++;
        }

        // Apply batch updates
        if (winningsUpdates.length > 0) {
            let batch = db.batch();
            let count = 0;
            for (const upd of winningsUpdates) {
                batch.update(upd.ref, { amountWon: upd.amountWon, isWinner: true, updatedAt: Date.now() });
                count++;
                if (count >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    count = 0;
                }
            }
            if (count > 0) await batch.commit();
        }
    }

    // ------------------------------------------------------------------
    // Additive post-finalization steps (UX overhaul Phase 4.1/4.2):
    // season history writes + season recap emails. Each step runs in its
    // own try/catch so a failure here can NEVER break payout finalization.
    // ------------------------------------------------------------------
    let historyWrites = 0;
    let recapEmails = 0;

    for (const poolDoc of pools) {
        const pool = Object.assign(poolDoc.data(), { id: poolDoc.id }) as BracketPool;

        let entries: BracketEntry[] = [];
        try {
            const entriesSnap = await db.collection('pools').doc(pool.id).collection('entries').get();
            entries = entriesSnap.docs.map(d => Object.assign(d.data(), { id: d.id }) as BracketEntry);
        } catch (err) {
            logger.error(`Season history: failed to load entries for pool ${pool.id}`, err);
            continue;
        }
        if (entries.length === 0) continue;

        // Final ranks: prefer the rank stored by scoreTournamentEntries (which
        // applies the full tiebreaker logic). Fallback: competition-rank by
        // score desc — tied scores share the minimum rank (1, 1, 3, ...).
        const byScore = [...entries].sort((a, b) => (b.score || 0) - (a.score || 0));
        const fallbackRank = new Map<string, number>();
        byScore.forEach((e, idx) => {
            const prev = idx > 0 ? byScore[idx - 1] : null;
            const rank = (prev && (e.score || 0) === (prev.score || 0))
                ? (fallbackRank.get(prev.id) || idx + 1)
                : idx + 1;
            fallbackRank.set(e.id, rank);
        });
        const finalRankOf = (e: BracketEntry): number =>
            (typeof e.rank === 'number' && e.rank > 0) ? e.rank : (fallbackRank.get(e.id) || entries.length);

        const season = tournament.seasonYear
            || (pool as unknown as { season?: number }).season
            || pool.seasonYear
            || new Date().getFullYear();

        // One seasonHistory doc per pool per user: a user with multiple
        // entries gets their BEST (lowest final rank) entry recorded.
        const bestByUser = new Map<string, BracketEntry>();
        entries.forEach(e => {
            if (!e.ownerUid) return;
            const current = bestByUser.get(e.ownerUid);
            if (!current || finalRankOf(e) < finalRankOf(current)) bestByUser.set(e.ownerUid, e);
        });

        // Step 1 (4.2): season history writes — users/{uid}/seasonHistory/{poolId}
        try {
            let batch = db.batch();
            let count = 0;
            for (const [uid, entry] of bestByUser) {
                const rank = finalRankOf(entry);
                batch.set(
                    db.collection('users').doc(uid).collection('seasonHistory').doc(pool.id),
                    {
                        poolId: pool.id,
                        poolName: pool.name,
                        poolType: 'BRACKET',
                        season,
                        finalRank: rank,
                        totalEntries: entries.length,
                        points: entry.score || 0,
                        entryName: entry.name,
                        isChampion: rank === 1,
                        completedAt: Date.now(),
                    },
                    { merge: true }
                );
                count++;
                historyWrites++;
                if (count >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    count = 0;
                }
            }
            if (count > 0) await batch.commit();
        } catch (err) {
            logger.error(`Season history writes failed for pool ${pool.id}`, err);
        }

        // Step 2 (4.1): season recap email to every entry owner (category 'results')
        try {
            const ranked = [...entries].sort((a, b) => finalRankOf(a) - finalRankOf(b));
            const champion = ranked[0];
            const podium = ranked.slice(0, 3);
            const ordinal = (n: number): string => {
                const rem = n % 100;
                if (rem >= 11 && rem <= 13) return `${n}th`;
                switch (n % 10) {
                    case 1: return `${n}st`;
                    case 2: return `${n}nd`;
                    case 3: return `${n}rd`;
                    default: return `${n}th`;
                }
            };
            const medals = ['🥇', '🥈', '🥉'];
            const podiumHtml = podium.map((e, i) =>
                `<li style="margin-bottom: 6px;">${medals[i] || ''} <strong>${escapeHtml(e.name)}</strong> — ${ordinal(finalRankOf(e))} place, ${e.score || 0} pts</li>`
            ).join('');

            // bestByUser is keyed by uid, so each owner gets exactly one email.
            for (const [uid, entry] of bestByUser) {
                const userSnap = await db.collection('users').doc(uid).get();
                const email = userSnap.exists ? (userSnap.data()?.email as string | undefined) : undefined;
                if (!email || !email.includes('@')) continue;

                const rank = finalRankOf(entry);
                const finishLine = rank === 1
                    ? `🏆 Congratulations — <strong>you won the pool</strong> with &quot;${escapeHtml(entry.name)}&quot;!`
                    : `You finished <strong>${ordinal(rank)} of ${entries.length}</strong> with &quot;${escapeHtml(entry.name)}&quot; (${entry.score || 0} pts).`;

                const body = `
                    <p style="font-size: 18px;">🏆 <strong>${escapeHtml(champion.name)}</strong> is the champion of <strong>${escapeHtml(pool.name)}</strong>!</p>
                    <p style="font-size: 16px; margin-bottom: 8px;"><strong>Final podium:</strong></p>
                    <ul style="font-size: 16px; padding-left: 20px; margin-top: 0;">${podiumHtml}</ul>
                    <p style="font-size: 16px;">${finishLine}</p>
                    <p style="font-size: 16px;">Thanks for playing this season — see you next year!</p>
                `;
                const html = renderEmailHtml(`Final results: ${pool.name}`, body, `${BASE_URL}/pool/${pool.id}`, 'View Final Standings');
                await sendEmail(db, email, `Final results: ${pool.name}`, html, { poolId: pool.id, category: 'results' });
                recapEmails++;
            }
        } catch (err) {
            logger.error(`Season recap emails failed for pool ${pool.id}`, err);
        }
    }

    logger.info(`finalizeTournamentPayouts(${tournamentId}): ${payoutCount} payouts, ${historyWrites} season-history docs, ${recapEmails} recap emails.`);
    return { success: true, payoutCount, historyWrites, recapEmails };
    },
);
