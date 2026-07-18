import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

/**
 * Ops alert dispatcher (PLAN-SECURITY-OBSERVABILITY.md #11) — server-only,
 * SEPARATE from the end-user notification paths (sendEmail's opt-out/unsub
 * machinery in reminders.ts, sendCourierSMS's per-user phone in
 * notifications/smsService.ts). Ops recipients are Kevin's configured
 * on-call list, not pool participants, so this deliberately bypasses
 * unsubscribe/opt-out checks entirely.
 *
 * Recipient config lives in Firestore `system/config.opsAlerts`
 * (Kevin's decision, kickoff 2026-07-17 — matches the existing kill-switch
 * config convention, not Secret Manager/env):
 *   { emailRecipients: string[], smsRecipients: string[] }
 * Missing/empty config = no-op (fail-safe, not fail-loud) — this ships
 * inert until Kevin populates the doc.
 *
 * High-priority set (SMS + email; everything else is email-only) is
 * Kevin's kickoff decision — all 4 of the plan's proposed defaults:
 * webhook failure/dead-letter, site-down, auth/App-Check outage, checkout
 * SLO breach. NOTE: site-down alerting is wired through GCP Cloud
 * Monitoring's own notification channel (Kevin's #13 manual GCP-console
 * step), NOT through this dispatcher — if the backend itself is down, a
 * Firestore/Functions-dependent dispatcher can't fire either, so uptime
 * paging must not depend on the thing it's watching.
 */

export const opsCourierAuthToken = defineSecret("COURIER_AUTH_TOKEN");

export type OpsAlertType =
    | "WEBHOOK_FAILED"
    | "DOUBLE_CHARGE_REVIEW"
    | "ASYNC_PAYMENT_FAILED"
    | "PAYMENT_FAILED"
    | "REFUND"
    | "DISPUTE"
    | "SITE_DOWN"
    | "AUTH_APPCHECK_OUTAGE"
    | "CHECKOUT_SLO_BREACH"
    | "NFL_SPREADS_NOT_LOCKED"
    | "NFL_STAT_CORRECTION";

const HIGH_PRIORITY_TYPES: ReadonlySet<OpsAlertType> = new Set([
    "WEBHOOK_FAILED",
    "SITE_DOWN",
    "AUTH_APPCHECK_OUTAGE",
    "CHECKOUT_SLO_BREACH",
    // Every member of every pool on the slate is blocked from submitting picks
    // and the window closes at kickoff — email alone is too slow to act on.
    "NFL_SPREADS_NOT_LOCKED",
]);

interface OpsAlertsConfig {
    emailRecipients: string[];
    smsRecipients: string[];
}

async function readOpsAlertsConfig(db: admin.firestore.Firestore): Promise<OpsAlertsConfig> {
    try {
        const raw = (await db.doc("system/config").get()).data()?.opsAlerts as
            | { emailRecipients?: unknown; smsRecipients?: unknown }
            | undefined;
        const emailRecipients = Array.isArray(raw?.emailRecipients)
            ? raw!.emailRecipients.filter((e): e is string => typeof e === "string" && e.includes("@"))
            : [];
        const smsRecipients = Array.isArray(raw?.smsRecipients)
            ? raw!.smsRecipients.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            : [];
        return { emailRecipients, smsRecipients };
    } catch (e) {
        logger.warn("[opsAlertDispatcher] config read failed; staying silent (fail-safe)", e);
        return { emailRecipients: [], smsRecipients: [] };
    }
}

/** Writes directly to the `mail` collection (same Trigger-Email-extension delivery
 *  every other sender in this app uses) — deliberately skips reminders.ts's
 *  sendEmail() so ops paging never gets suppressed by a pool member's
 *  unsubscribe/opt-out preference matching an ops recipient's address. */
async function sendOpsEmail(db: admin.firestore.Firestore, to: string, subject: string, text: string): Promise<void> {
    try {
        await db.collection("mail").add({
            to,
            message: { subject, text },
            source: "opsAlertDispatcher",
            createdAt: FieldValue.serverTimestamp(),
        });
    } catch (e) {
        logger.warn(`[opsAlertDispatcher] failed to queue ops email to ${to}`, e);
    }
}

function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    return `+${digits}`;
}

/** Distinct code path from sendCourierSMS (PLAN #11 — do not reuse the end-user
 *  SMS path). Shares the same Courier account/secret (no new vendor account
 *  needed tonight); framing and recipient source are ops-specific. */
async function sendOpsSMS(phone: string, message: string): Promise<void> {
    const token = opsCourierAuthToken.value();
    if (!token) {
        logger.warn("[opsAlertDispatcher] COURIER_AUTH_TOKEN not configured; ops SMS not sent.");
        return;
    }
    try {
        const response = await fetch("https://api.courier.com/send", {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: {
                    to: { phone_number: normalizePhone(phone) },
                    content: { title: "MMP OPS ALERT", body: message },
                    routing: { method: "single", channels: ["sms"] },
                },
            }),
        });
        if (!response.ok) {
            logger.error(`[opsAlertDispatcher] Courier ops SMS failed (${response.status})`, await response.text());
        }
    } catch (e) {
        logger.warn(`[opsAlertDispatcher] ops SMS to ${phone} failed (non-fatal)`, e);
    }
}

export interface OpsAlertInput {
    type: OpsAlertType;
    title: string;
    message: string;
    context?: Record<string, unknown>;
}

/** Best-effort — never throws. A paging failure must never break the handler
 *  that detected the underlying failure (same principle as sentryServer.ts). */
export async function dispatchOpsAlert(db: admin.firestore.Firestore, input: OpsAlertInput): Promise<void> {
    try {
        const cfg = await readOpsAlertsConfig(db);
        if (cfg.emailRecipients.length === 0 && cfg.smsRecipients.length === 0) return;

        const detailLines = input.context
            ? Object.entries(input.context).map(([k, v]) => `${k}: ${String(v)}`).join("\n")
            : "";
        const body = detailLines ? `${input.message}\n\n${detailLines}` : input.message;
        const subject = `[MMP OPS] ${input.title}`;

        await Promise.all(cfg.emailRecipients.map((to) => sendOpsEmail(db, to, subject, body)));

        if (HIGH_PRIORITY_TYPES.has(input.type)) {
            await Promise.all(cfg.smsRecipients.map((phone) => sendOpsSMS(phone, `${subject}: ${input.message}`)));
        }
    } catch (e) {
        logger.warn(`[opsAlertDispatcher] dispatchOpsAlert(${input.type}) failed (non-fatal)`, e);
    }
}
