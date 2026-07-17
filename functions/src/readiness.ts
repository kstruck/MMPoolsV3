import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Minimal readiness endpoint (PLAN-SECURITY-OBSERVABILITY.md #13) for GCP
 * Uptime Checks. Deliberately tiny: 200/503 only, no internals, no auth (Uptime
 * Checks are unauthenticated GETs) — the rich probe (ESPN/email/etc.) lives in
 * adminHealth.ts's SUPER_ADMIN-gated callable + hourly scheduler and stays
 * there; this endpoint exists only because Uptime Checks need a plain HTTP
 * surface, which the existing health check (a callable) isn't.
 *
 * "Ready" = the function executed and can reach Firestore — a cheap read of
 * the same always-present system/config doc adminHealth.ts's checkFirestore
 * uses, with a short timeout so a slow dependency reads as unready rather
 * than hanging the check.
 */
export const readiness = onRequest(
    { timeoutSeconds: 10, memory: "256MiB" },
    async (req, res) => {
        try {
            // Firestore Admin SDK reads don't take an AbortSignal, so race a
            // timeout instead — a hung dependency must read as unready, not
            // hang the check up to the function's own timeoutSeconds.
            await Promise.race([
                admin.firestore().collection("system").doc("config").get(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
            ]);
            res.status(200).send("OK");
        } catch {
            res.status(503).send("UNAVAILABLE");
        }
    }
);
