import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Generate promo signature with optional referral link
const getPromoSignature = (ownerReferralCode?: string) => {
    const referralUrl = ownerReferralCode
        ? `https://marchmeleepools.com?ref=${ownerReferralCode}`
        : 'https://marchmeleepools.com';

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
        ownerReferralCode?: string
    ) => {
        const link = `${window.location.origin}/#pool/${poolId}`;
        const subject = `Confirmation: You joined "${poolName}"`;

        const text = `Hi ${playerName},

You have successfully claimed ${squaresInitials.length} square(s) in "${poolName}".

Squares: ${squaresInitials.join(', ')}

View the pool here: ${link}

Good luck!`;

        const html = `
            <p>Hi ${playerName},</p>
            <p>You have successfully claimed <strong>${squaresInitials.length} square(s)</strong> in "<strong>${poolName}</strong>".</p>
            <p><strong>Squares:</strong> ${squaresInitials.join(', ')}</p>
            <p><a href="${link}">View Pool</a></p>
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
    }
};
