import emailjs from '@emailjs/browser';

interface EmailParams {
    to_name: string;
    to_email: string;
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

        if (!pubKey || !srvId) {
            console.warn('EmailJS keys missing. Email not sent.', { params });
            return { status: 200, text: 'Simulated Success' };
        }

        try {
            const response = await emailjs.send(srvId, templateId, params as any, pubKey);
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
    }
};
