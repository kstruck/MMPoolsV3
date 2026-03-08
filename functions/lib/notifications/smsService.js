"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.courierAuthToken = void 0;
exports.sendCourierSMS = sendCourierSMS;
const params_1 = require("firebase-functions/params");
exports.courierAuthToken = (0, params_1.defineSecret)("COURIER_AUTH_TOKEN");
async function sendCourierSMS(phoneNumber, message) {
    const token = exports.courierAuthToken.value();
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
    }
    catch (error) {
        console.error("Failed to send Courier SMS:", error);
        return false;
    }
}
//# sourceMappingURL=smsService.js.map