"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onGameComplete = void 0;
const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const db = admin.firestore();
/**
 * Trigger when pool document is updated
 * Sends post-game summary email when game status changes to 'post'
 */
exports.onGameComplete = functions.firestore.onDocumentUpdated("pools/{poolId}", async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const poolId = event.params.poolId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after)
        return;
    // Only trigger when game status changes to 'post' (game ended)
    if (((_c = before.scores) === null || _c === void 0 ? void 0 : _c.gameStatus) === ((_d = after.scores) === null || _d === void 0 ? void 0 : _d.gameStatus))
        return;
    if (((_e = after.scores) === null || _e === void 0 ? void 0 : _e.gameStatus) !== 'post')
        return;
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
        const winners = winnersSnap.docs.map(doc => doc.data());
        // Get final scores
        const homeScore = ((_g = (_f = after.scores) === null || _f === void 0 ? void 0 : _f.final) === null || _g === void 0 ? void 0 : _g.home) || 0;
        const awayScore = ((_j = (_h = after.scores) === null || _h === void 0 ? void 0 : _h.final) === null || _j === void 0 ? void 0 : _j.away) || 0;
        // Calculate pot and total payouts
        const soldSquares = ((_k = after.squares) === null || _k === void 0 ? void 0 : _k.filter(s => s.owner).length) || 0;
        const totalPot = soldSquares * (after.costPerSquare || 0);
        // Collect unique emails from squares
        const recipientEmails = new Set();
        (_l = after.squares) === null || _l === void 0 ? void 0 : _l.forEach(square => {
            if (square.email) {
                recipientEmails.add(square.email);
            }
        });
        if (recipientEmails.size === 0) {
            console.log(`[PostGameEmail] Pool ${poolId}: No recipient emails found`);
            return;
        }
        // Build winners table
        const periodLabels = {
            q1: 'Q1',
            half: 'Halftime',
            q3: 'Q3',
            final: 'Final',
            Event: 'Score Event'
        };
        const winnersHtml = winners.map(w => {
            var _a;
            return `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #333;">${periodLabels[w.period] || w.period}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #333;">${w.winner || 'N/A'}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #333;">$${((_a = w.amount) === null || _a === void 0 ? void 0 : _a.toFixed(2)) || '0.00'}</td>
                </tr>
            `;
        }).join('');
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 24px; }
        .header { text-align: center; margin-bottom: 24px; }
        .score { font-size: 32px; font-weight: bold; color: #10b981; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { text-align: left; padding: 8px; color: #94a3b8; border-bottom: 2px solid #334155; }
        .footer { text-align: center; margin-top: 24px; color: #64748b; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="color: #818cf8;">🏈 Game Complete!</h1>
            <h2>${after.awayTeam || 'Away'} @ ${after.homeTeam || 'Home'}</h2>
            <div class="score">${awayScore} - ${homeScore}</div>
        </div>
        
        <h3 style="color: #f59e0b;">🏆 Winners</h3>
        <table>
            <thead>
                <tr>
                    <th>Period</th>
                    <th>Winner</th>
                    <th>Payout</th>
                </tr>
            </thead>
            <tbody>
                ${winnersHtml || '<tr><td colspan="3" style="padding: 8px;">No winners recorded</td></tr>'}
            </tbody>
        </table>
        
        <div style="margin-top: 24px; padding: 16px; background: #0f172a; border-radius: 8px;">
            <p style="margin: 0;"><strong>Total Pot:</strong> $${totalPot.toFixed(2)}</p>
            <p style="margin: 8px 0 0 0;"><strong>Squares Sold:</strong> ${soldSquares}/100</p>
        </div>
        
        <p style="text-align: center; margin-top: 24px;">
            <a href="https://marchmeleepools.com/#pool/${after.urlSlug || poolId}" style="background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">View Pool</a>
        </p>
        
        <div class="footer">
            <p>Thanks for playing on March Melee Pools!</p>
        </div>
    </div>
</body>
</html>
            `;
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
    }
    catch (error) {
        console.error(`[PostGameEmail] Pool ${poolId}: Error sending summary email`, error);
        throw error;
    }
});
//# sourceMappingURL=postGameEmail.js.map