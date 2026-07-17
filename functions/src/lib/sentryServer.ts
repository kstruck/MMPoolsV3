import * as Sentry from "@sentry/node";
import * as logger from "firebase-functions/logger";

/**
 * Business-failure monitoring (PLAN-SECURITY-OBSERVABILITY.md #10) — mirrors an
 * existing `monetization_alerts` Firestore doc into a Sentry custom event,
 * best-effort. No-ops until a `SENTRY_DSN` env var/secret is configured (backend
 * Sentry is a separate opt-in from the FE DSN — Kevin has not wired a functions
 * secret for it yet; see PICKUP-PHASE2-OBSERVABILITY.md). The Firestore doc stays
 * the source of truth either way — this is additive, not a replacement.
 *
 * Never throws — a monitoring failure must never break the handler it observes
 * (same swallow-and-log principle as logClientError.ts).
 */

let initAttempted = false;
let initialized = false;

function ensureInit(): boolean {
    if (initAttempted) return initialized;
    initAttempted = true;
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return false;
    try {
        Sentry.init({
            dsn,
            environment: process.env.GCLOUD_PROJECT ? "production" : "development",
            tracesSampleRate: 0, // this is error/alert capture only, not perf tracing
        });
        initialized = true;
    } catch (e) {
        logger.warn("[sentryServer] Sentry.init failed (non-fatal)", e);
        initialized = false;
    }
    return initialized;
}

export function captureMonetizationAlert(type: string, context: Record<string, unknown>): void {
    try {
        if (!ensureInit()) return;
        Sentry.captureMessage(`[monetization_alert] ${type}`, {
            level: "error",
            tags: { alertType: type },
            extra: context,
        });
    } catch (e) {
        logger.warn(`[sentryServer] captureMonetizationAlert(${type}) failed (non-fatal)`, e);
    }
}
