import { defineSecret } from "firebase-functions/params";
import type { DeliveryOutcome } from "../lib/deliveryTally";
import { isMemberSmsEnabled, type SmsAudience } from "../lib/costControls";
import { recordUsageEvent } from "../lib/usageEvents";

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
 *
 * `audience` is REQUIRED and carries the cost-control kill-switch (PLAN-COST-
 * CONTROLS Phase 0.5.3). Only `'member'` sends are gated: Kevin's D4 turns
 * member-facing SMS off while keeping his own security alerts and the
 * SUPER_ADMIN test endpoint working, and both of those flow through THIS
 * function — so a blanket check at the top would take them down with the
 * member sends. It is a required parameter rather than an optional one because
 * a defaulted audience makes a new call site silently member-or-not; the type
 * error is the point.
 *
 * Ops paging is NOT here: `lib/opsAlertDispatcher.ts` `sendOpsSMS` is its own
 * Courier path (deliberately, per its own header) and is exempt per D4.
 */
export async function sendCourierSMS(
    phoneNumber: string,
    message: string,
    audience: SmsAudience
): Promise<DeliveryOutcome> {
    // Phase 1.3 attribution. NOTE: the phone number is deliberately absent from
    // every usage event below — telemetry records shape and cost, never
    // recipients (plan 1.4).
    const startedAt = Date.now();
    const feature = `sms.${audience}`;

    if (audience === 'member' && !(await isMemberSmsEnabled())) {
        // Same 'skipped' semantics as an unconfigured Courier: a deployment
        // choice, not a fault. Returning 'failed' here would mark every
        // reminder pass unhealthy forever — the crying-wolf mode this file's
        // header exists to avoid.
        console.warn("[costControls] member SMS disabled by kill-switch; not sent.");
        // Recorded so a silently-off feature is visible in the rollup rather
        // than looking like nobody ever tried to send.
        await recordUsageEvent({
            provider: "courier", feature, outcome: "skipped",
            latencyMs: Date.now() - startedAt, messageCount: 0,
            errorCode: "killswitch_disabled",
        });
        return 'skipped';
    }

    const token = courierAuthToken.value();
    if (!token) {
        console.warn("Courier Auth Token not configured. SMS not sent.");
        await recordUsageEvent({
            provider: "courier", feature, outcome: "skipped",
            latencyMs: Date.now() - startedAt, messageCount: 0,
            errorCode: "not_configured",
        });
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
            await recordUsageEvent({
                provider: "courier", feature, outcome: "error",
                latencyMs: Date.now() - startedAt, messageCount: 1,
                errorCode: `http_${response.status}`,
            });
            return 'failed';
        }

        console.log(`Courier SMS accepted for ${e164Phone}`);
        await recordUsageEvent({
            provider: "courier", feature, outcome: "success",
            latencyMs: Date.now() - startedAt, messageCount: 1,
        });
        return 'queued';
    } catch (error) {
        console.error("Failed to send Courier SMS:", error);
        await recordUsageEvent({
            provider: "courier", feature, outcome: "error",
            latencyMs: Date.now() - startedAt, messageCount: 1,
            errorCode: "request_failed",
        });
        return 'failed';
    }
}
