import { defineSecret } from "firebase-functions/params";

export const courierAuthToken = defineSecret("COURIER_AUTH_TOKEN");

export async function sendCourierSMS(phoneNumber: string, message: string): Promise<boolean> {
    const token = courierAuthToken.value();
    if (!token) {
        console.warn("Courier Auth Token not configured. SMS not sent.");
        return false;
    }

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
                        phone_number: phoneNumber
                    },
                    content: {
                        title: "Pool Update",
                        body: message
                    },
                    routing: {
                        method: "single",
                        channels: ["sms"]
                    }
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error(`Courier API error (${response.status}):`, errorData);
            return false;
        }

        console.log(`Courier SMS sent successfully to ${phoneNumber}`);
        return true;
    } catch (error) {
        console.error("Failed to send Courier SMS:", error);
        return false;
    }
}
