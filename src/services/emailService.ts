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
        squaresInitials: string[], // e.g. ["#4 (Kevin)", "#12 (Kevin)"]
        playerEmail: string,
        playerName: string,
        _poolOwnerEmail: string,
        poolId: string,
        ownerReferralCode?: string,
        paymentHandles?: { venmo?: string, googlePay?: string }
    ) => {
        const link = `${window.location.origin}/#pool/${poolId}`;
        const subject = `Confirmation: You joined "${poolName}"`;

        let paymentText = '';
        let paymentHtml = '';

        if (paymentHandles?.venmo || paymentHandles?.googlePay) {
            paymentText += '\n\nPayment Options:';
            paymentHtml += '<div style="margin-top: 20px; padding: 15px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;"><strong>Payment Options:</strong><br>';

            if (paymentHandles.venmo) {
                const vUser = paymentHandles.venmo.replace('@', '');
                paymentText += `\nVenmo: https://venmo.com/u/${vUser}`;
                paymentHtml += `<div style="margin-top: 8px;"><a href="https://venmo.com/u/${vUser}" style="background-color: #008CFF; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Pay with Venmo (@${vUser})</a></div>`;
            }
            if (paymentHandles.googlePay) {
                paymentText += `\nGoogle Pay: ${paymentHandles.googlePay}`;
                paymentHtml += `<div style="margin-top: 8px; color: #475569;"><strong>Google Pay:</strong> ${paymentHandles.googlePay}</div>`;
            }
            paymentHtml += '</div>';
        }

        const text = `Hi ${playerName},

You have successfully claimed ${squaresInitials.length} square(s) in "${poolName}".

Squares: ${squaresInitials.join(', ')}

View the pool here: ${link}${paymentText}

Good luck!`;

        const html = `
            <p>Hi ${playerName},</p>
            <p>You have successfully claimed <strong>${squaresInitials.length} square(s)</strong> in "<strong>${poolName}</strong>".</p>
            <p><strong>Squares:</strong> ${squaresInitials.join(', ')}</p>
            <p><a href="${link}">View Pool</a></p>
            ${paymentHtml}
            <p>Good luck!</p>
        `;

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
