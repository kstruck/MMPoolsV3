import { defineSecret } from "firebase-functions/params";
import type { DeliveryOutcome } from "../lib/deliveryTally";

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

/**
 * Returns a `DeliveryOutcome` rather than a boolean so callers can tell a
 * CONFIGURATION state from a FAULT.
 *
 * `'skipped'` means Courier is not configured — a deployment choice, not a
 * failure. It used to return the same `false` as a provider refusal, and
 * counting that as a delivery failure would mark every reminder pass unhealthy
 * forever on a project that simply does not send SMS. That is the crying-wolf
 * mode `lib/heartbeatVerdicts.ts` exists to avoid, and the exact shape of a
 * codex finding this repo has rejected before ("marking a job unhealthy forever
 * over a config choice").
 *
 * `'failed'` means the send was attempted and did not get through.
 */
export async function sendCourierSMS(phoneNumber: string, message: string): Promise<DeliveryOutcome> {
    const token = courierAuthToken.value();
    if (!token) {
        console.warn("Courier Auth Token not configured. SMS not sent.");
        return 'skipped';
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
            return 'failed';
        }

        console.log(`Courier SMS accepted for ${e164Phone}`);
        return 'queued';
    } catch (error) {
        console.error("Failed to send Courier SMS:", error);
        return 'failed';
    }
}
