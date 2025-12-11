import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const emailService = {
    // Generic helper to write to the 'mail' collection
    sendEmail: async (
        to: string | string[],
        subject: string,
        text: string,
        html?: string
    ) => {
        try {
            await addDoc(collection(db, 'mail'), {
                to,
                message: {
                    subject,
                    text,
                    html: html || text.replace(/\n/g, '<br>')
                }
            });
            console.log(`Email trigger created for: ${to}`);
            return { success: true };
        } catch (error) {
            console.error('Error creating email trigger:', error);
            // Non-blocking error
            return { success: false, error };
        }
    },

    sendConfirmation: async (
        poolName: string,
        squaresInitials: string[], // e.g. ["#4 (Kevin)", "#12 (Kevin)"]
        playerEmail: string,
        playerName: string,
        _poolOwnerEmail: string,
        poolId: string
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

        return emailService.sendEmail(playerEmail, subject, text, html);
    },

    sendGridFullNotification: async (
        poolName: string,
        adminEmail: string,
        poolId: string
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

        return emailService.sendEmail(adminEmail, subject, text, html);
    },

    sendNumbersSetNotification: async (
        poolName: string,
        playerEmail: string,
        playerName: string,
        poolId: string
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

        return emailService.sendEmail(playerEmail, subject, text, html);
    }
};
