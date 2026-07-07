import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

/**
 * Server-side sink for client-side error telemetry (the ErrorBoundary /
 * errorHandler path). Replaces the previous direct client `addDoc(system_logs)`
 * write: `system_logs` create is now locked to functions-only in firestore.rules,
 * so front-end crash reporting must funnel through here.
 *
 * Trust-boundary hardening (this is reachable by anonymous/pre-auth callers, since
 * the whole app is wrapped in a global ErrorBoundary):
 *  - App Check enforced — only genuine app instances can write, not arbitrary scripts.
 *  - Schema-whitelisted: only the known fields are persisted, nothing free-form.
 *  - Size-capped: every string is truncated so this can't be used as a bulk sink.
 *  - Server-stamped: timestamp/source/uid are set here, never trusted from the client.
 *  - Never throws back to the caller — logging must not cascade into another error.
 */

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function cap(v: unknown, max: number): string | undefined {
    if (typeof v !== "string") return undefined;
    return v.length > max ? v.slice(0, max) : v;
}

export const logClientError = onCall(
    // App Check is not yet operational in prod (0% verified requests, no apps
    // registered, products still in Monitoring). Enforcing it here would reject
    // every call and kill the client error telemetry this callable exists to
    // preserve. Left OFF for now — the callable is still schema-whitelisted,
    // size-capped, and server-stamped (not a free-form sink).
    // TODO: set enforceAppCheck back to true once App Check is registered +
    // enforcing (register web app + reCAPTCHA Enterprise, move products to Enforce).
    { cors: true, enforceAppCheck: false, consumeAppCheckToken: false },
    async (request) => {
        try {
            const d = (request.data ?? {}) as Record<string, unknown>;

            const severityRaw = typeof d.severity === "string" ? d.severity : "medium";
            const severity = SEVERITIES.has(severityRaw) ? severityRaw : "medium";

            // context is size-capped by JSON length, not persisted raw/unbounded.
            let context: string | undefined;
            if (d.context && typeof d.context === "object") {
                try {
                    context = cap(JSON.stringify(d.context), 2000);
                } catch {
                    context = undefined;
                }
            }

            const entry: Record<string, unknown> = {
                message: cap(d.message, 2000) ?? "(no message)",
                code: cap(d.code, 200) ?? "UNKNOWN",
                stack: cap(d.stack, 4000),
                url: cap(d.url, 500),
                context,
                severity,
                type: "error",
                source: "client",
                uid: request.auth?.uid ?? null, // optional auth enrichment
                timestamp: Date.now(), // server-stamped, not client-trusted
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            // Strip undefined so Firestore accepts the doc.
            Object.keys(entry).forEach((k) => entry[k] === undefined && delete entry[k]);

            await admin.firestore().collection("system_logs").add(entry);
            return { ok: true };
        } catch (e) {
            // Swallow — a failure to log a client error must never surface as a new one.
            logger.warn("logClientError failed to persist a client error", e);
            return { ok: false };
        }
    }
);
