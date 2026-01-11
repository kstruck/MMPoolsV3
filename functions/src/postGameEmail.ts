import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { renderEmailHtml, BASE_URL } from "./emailStyles";



interface PoolData {
    homeTeam?: string;
    awayTeam?: string;
    urlSlug?: string;
    costPerSquare?: number;
    postGameEmailSent?: boolean;
    scores?: {
        gameStatus?: 'pre' | 'in' | 'post';
        final?: { home: number; away: number };
    };
    squares?: Array<{
        id: number;
        owner?: string;
        email?: string;
    }>;
}

interface WinnerDoc {
    period: string;
    winner?: string;
    amount?: number;
}

/**
 * Trigger when pool document is updated
 * Sends post-game summary email when game status changes to 'post'
 */
export const onGameComplete = functions.firestore.onDocumentUpdated(
    "pools/{poolId}",
    async (event) => {
        const db = admin.firestore();
        const poolId = event.params.poolId;
        const before = event.data?.before.data() as PoolData | undefined;
        const after = event.data?.after.data() as PoolData | undefined;

        if (!before || !after) return;

        // Only trigger when game status changes to 'post' (game ended)
        if (before.scores?.gameStatus === after.scores?.gameStatus) return;
        if (after.scores?.gameStatus !== 'post') return;

        // Skip if already sent
        if (after.postGameEmailSent) {
            console.log(`[PostGameEmail] Pool ${poolId}: Email already sent, skipping`);
            return;
        }

        console.log(`[PostGameEmail] Pool ${poolId}: Game ended, preparing summary email`);

        try {
            // Mark as sent first to prevent duplicates
            await db.collection('pools').doc(poolId).update({
                postGameEmailSent: true
            });

            // Get all winners
            const winnersSnap = await db.collection('pools').doc(poolId).collection('winners').get();
            const winners: WinnerDoc[] = winnersSnap.docs.map(doc => doc.data() as WinnerDoc);

            // Get final scores
            const homeScore = after.scores?.final?.home || 0;
            const awayScore = after.scores?.final?.away || 0;

            // Calculate pot and total payouts
            const soldSquares = after.squares?.filter(s => s.owner).length || 0;
            const totalPot = soldSquares * (after.costPerSquare || 0);

            // Collect unique emails from squares
            const recipientEmails = new Set<string>();
            after.squares?.forEach(square => {
                if (square.email) {
                    recipientEmails.add(square.email);
                }
            });

            if (recipientEmails.size === 0) {
                console.log(`[PostGameEmail] Pool ${poolId}: No recipient emails found`);
                return;
            }

            // Build winners table
            const periodLabels: Record<string, string> = {
                q1: 'Q1',
                half: 'Halftime',
                q3: 'Q3',
                final: 'Final',
                Event: 'Score Event'
            };

            const winnersHtml = winners.map(w => `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #334155;">${periodLabels[w.period] || w.period}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${w.winner || 'N/A'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace; color: #334155;">$${w.amount?.toFixed(2) || '0.00'}</td>
                </tr>
            `).join('');

            const emailBody = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <h2 style="color: #0f172a; margin: 0;">${after.awayTeam || 'Away'} @ ${after.homeTeam || 'Home'}</h2>
                    <div style="font-size: 32px; font-weight: bold; color: #10b981; margin: 10px 0;">${awayScore} - ${homeScore}</div>
                </div>
                
                <h3 style="color: #334155; font-size: 16px; margin-bottom: 10px;">🏆 Winners</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <thead>
                        <tr style="background-color: #f1f5f9; text-align: left;">
                            <th style="padding: 10px; border-bottom: 2px solid #e2e8f0; color: #475569;">Period</th>
                            <th style="padding: 10px; border-bottom: 2px solid #e2e8f0; color: #475569;">Winner</th>
                            <th style="padding: 10px; border-bottom: 2px solid #e2e8f0; text-align: right; color: #475569;">Payout</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${winnersHtml || '<tr><td colspan="3" style="padding: 10px; text-align: center; color: #64748b;">No winners recorded</td></tr>'}
                    </tbody>
                </table>
                
                <div style="margin-top: 24px; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <p style="margin: 0; color: #334155;"><strong>Total Pot:</strong> $${totalPot.toFixed(2)}</p>
                    <p style="margin: 8px 0 0 0; color: #334155;"><strong>Squares Sold:</strong> ${soldSquares}/100</p>
                </div>
            `;

            const emailHtml = renderEmailHtml('Game Complete!', emailBody, `${BASE_URL}/#pool/${after.urlSlug || poolId}`, 'View Pool Result');

            // Store email request for EmailJS or other email service to process
            await db.collection('mail').add({
                to: Array.from(recipientEmails),
                message: {
                    subject: `🏈 Game Complete: ${after.awayTeam || 'Away'} ${awayScore} - ${after.homeTeam || 'Home'} ${homeScore}`,
                    html: emailHtml
                },
                poolId: poolId,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`[PostGameEmail] Pool ${poolId}: Summary email queued for ${recipientEmails.size} recipients`);

        } catch (error) {
            console.error(`[PostGameEmail] Pool ${poolId}: Error sending summary email`, error);
            throw error;
        }
    });
