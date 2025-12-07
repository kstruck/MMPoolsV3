import emailjs from '@emailjs/browser';

interface EmailParams {
    to_name: string;
    to_email: string;
    from_name?: string;
    from_email?: string;
    reply_to: string;
    message: string;
    pool_name: string;
    grid_link: string;
}

export const emailService = {
    sendEmail: async (
        templateId: string,
        params: EmailParams,
        publicKey?: string,
        serviceId?: string
    ) => {
        const pubKey = publicKey || import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
        const srvId = serviceId || import.meta.env.VITE_EMAILJS_SERVICE_ID;

        // Force Sender/From if not provided, though template usually overrides
        const finalParams = {
            ...params,
            from_name: params.from_name || 'March Melee Pools',
            from_email: params.from_email || 'support@marchmeleepools.com'
        };

        if (!pubKey || !srvId) {
            console.warn('EmailJS keys missing. Email not sent.', { params: finalParams });
            return { status: 200, text: 'Simulated Success' };
        }

        try {
            const response = await emailjs.send(srvId, templateId, finalParams as any, pubKey);
            return response;
        } catch (error) {
            console.error('EmailJS Error:', error);
            throw error;
        }
    },

    sendConfirmation: async (
        poolName: string,
        squaresInitials: string[], // e.g. ["#4 (Kevin)", "#12 (Kevin)"]
        playerEmail: string,
        playerName: string,
        poolOwnerEmail: string,
        poolId: string
    ) => {
        const link = `${window.location.origin}${window.location.pathname}#pool/${poolId}`;
        const message = `You have successfully claimed ${squaresInitials.length} square(s) in "${poolName}".\n\nSquares: ${squaresInitials.join(', ')}\n\nGood luck!`;

        // Use a default confirmation template ID or env var
        const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_CONFIRM_ID || 'template_confirm';

        return emailService.sendEmail(
            templateId,
            {
                to_name: playerName,
                to_email: playerEmail,
                reply_to: poolOwnerEmail,
                message: message,
                pool_name: poolName,
                grid_link: link
            }
        );
    },

    sendGridFullNotification: async (
        poolName: string,
        adminEmail: string,
        poolId: string
    ) => {
        const link = `${window.location.origin}${window.location.pathname}#pool/${poolId}`;
        const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ADMIN_ID || 'template_admin_notification'; // Ensure you have this template in EmailJS

        console.log(`[EmailService] Sending Grid Full Alert to ${adminEmail}`);

        return emailService.sendEmail(
            templateId,
            {
                to_name: "Admin",
                to_email: adminEmail,
                reply_to: "support@marchmeleepools.com",
                message: `The grid for "${poolName}" is now FULL (100 squares sold)! Time to generate numbers.`,
                pool_name: poolName,
                grid_link: link
            }
        );
    },

    sendNumbersSetNotification: async (
        poolName: string,
        playerEmail: string,
        playerName: string,
        poolId: string
    ) => {
        const link = `${window.location.origin}${window.location.pathname}#pool/${poolId}`;
        const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_UPDATE_ID || 'template_update';

        return emailService.sendEmail(
            templateId,
            {
                to_name: playerName,
                to_email: playerEmail,
                reply_to: "support@marchmeleepools.com",
                message: `The numbers have been generated for "${poolName}"! Check the grid to see your luck.`,
                pool_name: poolName,
                grid_link: link
            }
        );
    }
};
