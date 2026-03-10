import { defineSecret } from "firebase-functions/params";

export const courierAuthToken = defineSecret("COURIER_AUTH_TOKEN");

/**
 * Normalize a phone number to E.164 format.
 * Strips non-digit chars, prepends +1 for US numbers if missing.
 */
function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("1") && digits.length === 11) {
        return `+${digits}`;
    }
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    // Already has country code or international
    return `+${digits}`;
}

export async function sendCourierSMS(phoneNumber: string, message: string): Promise<boolean> {
    const token = courierAuthToken.value();
    if (!token) {
        console.warn("Courier Auth Token not configured. SMS not sent.");
        return false;
    }

    const e164Phone = normalizePhone(phoneNumber);
    console.log(`Sending SMS to ${e164Phone} (original: ${phoneNumber})`);

    try {
        const response = await fetch("https://api.courier.com/send", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: {
                    to: {
                        phone_number: e164Phone
                    },
                    content: {
                        title: "March Melee Pools",
                        body: message
                    },
                    routing: {
                        method: "single",
                        channels: ["sms"]
                    }
                }
            })
        });

        const responseBody = await response.text();
        console.log(`Courier API response (${response.status}):`, responseBody);

        if (!response.ok) {
            console.error(`Courier API error (${response.status}):`, responseBody);
            return false;
        }

        console.log(`Courier SMS accepted for ${e164Phone}`);
        return true;
    } catch (error) {
        console.error("Failed to send Courier SMS:", error);
        return false;
    }
}
