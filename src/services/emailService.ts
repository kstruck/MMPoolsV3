import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Generate promo signature with optional referral link
const getPromoSignature = (ownerReferralCode?: string) => {
    const referralUrl = ownerReferralCode
        ? `https://www.marchmeleepools.com?ref=${ownerReferralCode}`
        : 'https://www.marchmeleepools.com';

    const text = `

---
Want to create and host your own pool? Go to ${referralUrl} and create a pool for your office, friends, or favorite charity today!`;

    const html = `
<hr style="border: 1px solid #eee; margin: 20px 0;" />
<p style="font-size: 12px; color: #666; text-align: center;">
  Want to create and host your own pool? Go to <a href="${referralUrl}" style="color: #4f46e5;">MarchMeleePools.com</a> and create a pool for your office, friends, or favorite charity today!
</p>`;

    return { text, html };
};

export const emailService = {
    // Generic helper to write to the 'mail' collection
    sendEmail: async (
        to: string | string[],
        subject: string,
        text: string,
        html?: string,
        options?: { bcc?: string[], replyTo?: string, ownerReferralCode?: string }
    ) => {
        try {
            const promoSig = getPromoSignature(options?.ownerReferralCode);
            const finalText = text + promoSig.text;
            const finalHtml = (html || text.replace(/\n/g, '<br>')) + promoSig.html;

            const emailData: any = {
                to,
                message: {
                    subject,
                    text: finalText,
                    html: finalHtml
                }
            };

            if (options?.bcc && options.bcc.length > 0) {
                emailData.bcc = options.bcc;
            }

            if (options?.replyTo) {
                emailData.replyTo = options.replyTo;
            }

            await addDoc(collection(db, 'mail'), emailData);
            console.log(`Email trigger created for: ${to}`);
            return { success: true };
        } catch (error) {
            console.error('Error creating email trigger:', error);
            // Non-blocking error
            return { success: false, error };
        }
    },

    sendBroadcast: async (
        recipients: string[],
        subject: string,
        html: string,
        replyTo?: string,
        ownerReferralCode?: string
    ) => {
        // Use BCC for privacy - send to a generic 'noreply' or the first recipient as 'to'
        // The extension should handle BCC correctly
        // We'll set 'to' to the first recipient if only 1, otherwise use BCC

        let toAddress = 'support@marchmeleepools.com'; // Default 'to' for mass emails
        let bccList = recipients;

        if (recipients.length === 1) {
            toAddress = recipients[0];
            bccList = [];
        }

        return emailService.sendEmail(
            toAddress,
            subject,
            "Please view this email in a client that supports HTML.", // Fallback text
            html,
            { bcc: bccList, replyTo, ownerReferralCode }
        );
    },

    sendConfirmation: async (
        poolName: string,
        squares: { id: number, cost: number }[], // Changed to array of objects
        playerEmail: string,
        playerName: string,
        poolId: string,
        config: {
            ruleVariations: any,
            charity?: { enabled: boolean, name: string, percentage: number },
            costPerSquare: number,
            payouts: any
        },
        ownerReferralCode?: string,
        paymentHandles?: { venmo?: string, googlePay?: string }
    ) => {
        const link = `${window.location.origin}/#pool/${poolId}`;
        const logoUrl = `${window.location.origin}/email-logo.png`;
        const subject = `Confirmation: You joined "${poolName}"`;
        const totalCost = squares.reduce((sum, s) => sum + s.cost, 0);

        // --- Rules Summary ---
        let rulesHtml = '<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 20px;">';
        rulesHtml += '<h3 style="margin-top: 0; color: #334155; font-size: 16px;">Pool Rules</h3>';
        rulesHtml += '<ul style="padding-left: 20px; color: #475569; font-size: 14px; margin-bottom: 0;">';

        // Cost
        rulesHtml += `<li><strong>Cost per Square:</strong> $${config.costPerSquare}</li>`;

        // Rollover
        if (config.ruleVariations.quarterlyRollover) {
            rulesHtml += `<li><strong>Rollover:</strong> <span style="color: #10b981; font-weight: bold;">Active</span> (Unclaimed prizes roll to next quarter)</li>`;
        } else {
            rulesHtml += `<li><strong>Rollover:</strong> Standard (No rollover)</li>`;
        }

        // Reverse Winners
        if (config.ruleVariations.reverseWinners) {
            rulesHtml += `<li><strong>Reverse Winners:</strong> <span style="color: #6366f1; font-weight: bold;">Active</span> (Prizes split 50/50 with reverse digits)</li>`;
        }

        // Charity
        if (config.charity?.enabled) {
            rulesHtml += `<li><strong>Charity:</strong> ${config.charity.percentage}% of pot goes to <em>${config.charity.name}</em></li>`;
        }

        rulesHtml += '</ul></div>';

        // --- Squares Table ---
        let squaresTable = '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">';
        squaresTable += '<thead><tr style="background-color: #f1f5f9; text-align: left;"><th style="padding: 10px; border-bottom: 2px solid #e2e8f0; color: #475569;">Square #</th><th style="padding: 10px; border-bottom: 2px solid #e2e8f0; color: #475569;">Owner</th><th style="padding: 10px; border-bottom: 2px solid #e2e8f0; text-align: right; color: #475569;">Cost</th></tr></thead>';
        squaresTable += '<tbody>';

        squares.forEach(s => {
            squaresTable += `<tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #334155;">#${s.id}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${playerName}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace; color: #334155;">$${s.cost}</td>
            </tr>`;
        });

        // Total Row
        squaresTable += `<tr style="background-color: #f8fafc; font-weight: bold;">
            <td colspan="2" style="padding: 10px; text-align: right; color: #334155;">Total Due:</td>
            <td style="padding: 10px; text-align: right; color: #0f172a; font-size: 16px;">$${totalCost}</td>
        </tr>`;
        squaresTable += '</tbody></table>';


        // --- Payment Section ---
        let paymentHtml = '';
        if (paymentHandles?.venmo || paymentHandles?.googlePay) {
            paymentHtml += '<div style="margin-top: 20px; padding: 20px; background-color: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">';
            paymentHtml += '<h3 style="margin-top: 0; color: #0369a1; font-size: 16px; margin-bottom: 10px;">Payment Options</h3>';

            if (paymentHandles.venmo) {
                const vUser = paymentHandles.venmo.replace('@', '');
                paymentHtml += `<div style="margin-bottom: 15px;">
                    <a href="https://venmo.com/u/${vUser}" style="background-color: #008CFF; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Pay $${totalCost} on Venmo (@${vUser})</a>
                </div>`;
            }
            if (paymentHandles.googlePay) {
                paymentHtml += `<div style="color: #334155; font-size: 14px;">
                    <strong>Google Pay:</strong> ${paymentHandles.googlePay}
                </div>`;
            }
            paymentHtml += '</div>';
        }

        // --- Final HTML Assembly ---
        const html = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #334155; line-height: 1.6;">
                <div style="text-align: center; margin-bottom: 30px; padding: 20px; background-color: #0f172a; border-radius: 0 0 12px 12px;">
                    <img src="${logoUrl}" alt="March Melee Pools" style="height: 50px; w: auto;" />
                </div>
                
                <h1 style="color: #0f172a; font-size: 24px; margin-bottom: 10px;">You're in the game!</h1>
                <p style="font-size: 16px; margin-bottom: 20px;">Hi ${playerName},</p>
                <p>You have successfully claimed <strong>${squares.length} square(s)</strong> in "<strong>${poolName}</strong>".</p>
                
                ${rulesHtml}
                
                <h3 style="color: #334155; font-size: 16px; margin-bottom: 10px;">Your Selection</h3>
                ${squaresTable}
                
                ${paymentHtml}
                
                <div style="margin-top: 30px; text-align: center;">
                    <a href="${link}" style="background-color: #4f46e5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">View Pool Dashboard</a>
                </div>
                
                <p style="margin-top: 30px; font-size: 14px; color: #94a3b8; text-align: center;">Good luck!</p>
            </div>
        `;

        const text = `Hi ${playerName}, You claimed ${squares.length} squares in ${poolName}. Total: $${totalCost}. View pool: ${link}`;

        return emailService.sendEmail(playerEmail, subject, text, html, { ownerReferralCode });
    },

    sendGridFullNotification: async (
        poolName: string,
        adminEmail: string,
        poolId: string,
        ownerReferralCode?: string
    ) => {
        const link = `${window.location.origin}/#pool/${poolId}`;
        const subject = `Action Required: Grid Full for "${poolName}"`;

        const text = `The grid for "${poolName}" is now FULL (100 squares sold)!
        
Time to generate numbers and manage your pool: ${link}`;

        const html = `
            <p>The grid for "<strong>${poolName}</strong>" is now FULL (100 squares sold)!</p>
            <p>Time to generate numbers and manage your pool:</p>
            <p><a href="${link}">Go to Pool</a></p>
        `;

        return emailService.sendEmail(adminEmail, subject, text, html, { ownerReferralCode });
    },

    sendNumbersSetNotification: async (
        poolName: string,
        playerEmail: string,
        playerName: string,
        poolId: string,
        ownerReferralCode?: string
    ) => {
        const link = `${window.location.origin}/#pool/${poolId}`;
        const subject = `Numbers Generated: "${poolName}"`;

        const text = `Hi ${playerName},
        
The numbers have been generated for "${poolName}"! 

Check the grid to see your luck: ${link}`;

        const html = `
            <p>Hi ${playerName},</p>
            <p>The numbers have been generated for "<strong>${poolName}</strong>"!</p>
            <p><a href="${link}">Check your squares here</a></p>
        `;

        return emailService.sendEmail(playerEmail, subject, text, html, { ownerReferralCode });
    },

    sendWelcomeEmail: async (
        email: string,
        name: string,
        referralCode: string
    ) => {
        const link = "https://www.marchmeleepools.com";
        const subject = "Welcome to March Melee Pools!";

        const text = `Hi ${name},

Welcome to March Melee Pools! Your account has been verified.

You can now:
- Create your own pool
- Join public pools
- Manage your squares

Get started here: ${link}

Your Referral Code: ${referralCode}
Share the fun!`;

        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #4f46e5;">Welcome to March Melee Pools!</h1>
                <p>Hi ${name},</p>
                <p>Your account has been successfully verified.</p>
                <p>You can now:</p>
                <ul>
                    <li>Create specific pools for any game</li>
                    <li>Join pools with your friends</li>
                    <li>Track live scores and winners automatically</li>
                </ul>
                <div style="margin: 30px 0;">
                    <a href="${link}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Dashboard</a>
                </div>
                <p style="font-size: 14px; color: #666;">Your Referral Code: <strong>${referralCode}</strong></p>
            </div>
        `;

        // Send with referral code attached to the sender context (self-referral for signature?)
        // Actually, just send it.
        return emailService.sendEmail(email, subject, text, html, { ownerReferralCode: referralCode });
    }
};
