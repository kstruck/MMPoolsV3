/**
 * safeError — the one seam between caught errors and the client
 * (PLAN-API-TRUST-BOUNDARY-REMEDIATION Phase 1).
 *
 * A raw caught `error.message` can carry provider text, Firestore internals,
 * file paths, or config values, and an HttpsError message is serialized to the
 * caller verbatim. So: expected HttpsErrors pass through UNCHANGED (their
 * status/code/message are the API contract), and everything else becomes ONE
 * stable generic message while the full error goes to the server log, where
 * operator diagnostics belong.
 *
 * PURE apart from console logging — no firebase-admin import — so it is
 * unit-testable and importable from any handler without cycle risk.
 */

import { HttpsError } from "firebase-functions/v2/https";

/** The single generic message clients see for unexpected failures. */
export const GENERIC_INTERNAL_MESSAGE =
    "Internal error. The details were logged on the server.";

/**
 * Log the real error under `label` and return a generic internal HttpsError.
 * Never embeds any part of `err` in the client-visible message.
 */
export function internalError(label: string, err: unknown): HttpsError {
    console.error(`[${label}] unexpected error:`, err);
    return new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
}

/**
 * Standard catch-block tail: rethrow an expected HttpsError untouched
 * (validation/auth/permission/not-found keep their specific code + message),
 * otherwise throw the generic internal error. Return type `never` so callers
 * can `throw rethrowOrInternal(...)` or call it as a statement.
 */
export function rethrowOrInternal(label: string, err: unknown): never {
    if (err instanceof HttpsError) throw err;
    throw internalError(label, err);
}
