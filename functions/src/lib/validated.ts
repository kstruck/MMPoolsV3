/**
 * validated() — the shared trust-boundary wrapper for callables (PLAN Phase 1).
 *
 * Enforces, in this exact order (sweep C3 — auth must precede schema so an
 * unauthenticated caller cannot probe input-shape errors):
 *   1. App Check  (monitor | enforce | exempt)
 *   2. Auth       (required | public)
 *   3. Role       (JWT claim AND users/{uid}.role, via assertCallerRole — C5)
 *   4. Schema     (zod; use .strict()/strictObject or discriminatedUnion so
 *                  unknown fields are REJECTED, wrong types REJECTED — PLAN #1)
 *
 * The handler receives the PARSED, typed data (never raw request.data) plus the
 * raw CallableRequest for auth/rawRequest access.
 *
 * App Check note: fleet-wide enforcement is rolled out monitor→enforce per
 * endpoint (PLAN #5). Default is "monitor": we do NOT block, but log calls that
 * arrive without a token so coverage can be measured before flipping to
 * "enforce". "exempt" is for public/boot/crash/webhook paths (sweep Sweep 2).
 */

import {
    onCall,
    type CallableRequest,
    type CallableOptions,
    HttpsError,
} from "firebase-functions/v2/https";
import { z } from "zod";
import { assertCallerRole } from "../adminClaims";
import type { CanonicalRole } from "./roles";

export type AppCheckMode = "monitor" | "enforce" | "exempt";
export type AuthMode = "required" | "public";

export interface ValidatedConfig<S extends z.ZodType> {
    /** Zod schema. Prefer strictObject / .strict() / discriminatedUnion. */
    schema: S;
    /** Short label for App-Check-monitor logs (usually the function name). */
    label: string;
    /** "required" (default) throws if !request.auth; "public" allows anon. */
    auth?: AuthMode;
    /** If set, assertCallerRole enforces claim+doc role agreement. */
    role?: CanonicalRole | CanonicalRole[];
    /** App Check posture. Default "monitor". */
    appCheck?: AppCheckMode;
    /** Passthrough onCall options (cors, secrets, memory, timeoutSeconds). */
    options?: CallableOptions;
}

/**
 * Pure validation seam — auth/role/schema gate WITHOUT the onCall harness, so it
 * is unit-testable. Returns the parsed data or throws HttpsError. App Check is
 * handled by the onCall option (pre-invocation) + the monitor log in validated();
 * it is intentionally not re-checked here.
 */
/** Minimal request shape the pure gate needs (real CallableRequest satisfies it). */
export interface GateRequest {
    auth?: { uid: string; token: Record<string, unknown> } | null;
    data: unknown;
}

export async function runGate<S extends z.ZodType>(
    cfg: Pick<ValidatedConfig<S>, "schema" | "auth" | "role">,
    request: GateRequest,
): Promise<z.infer<S>> {
    // 1. Auth (before schema — C3)
    if ((cfg.auth ?? "required") === "required" && !request.auth) {
        throw new HttpsError("unauthenticated", "Must be logged in.");
    }
    // 2. Role (claim AND doc, via assertCallerRole — C5)
    if (cfg.role) {
        const roles = Array.isArray(cfg.role) ? cfg.role : [cfg.role];
        await assertCallerRole(request, ...roles);
    }
    // 3. Schema — reject unknown fields / wrong types / missing required
    const parsed = cfg.schema.safeParse(request.data);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path?.join(".") || "(root)";
        throw new HttpsError(
            "invalid-argument",
            `Invalid request: ${path} — ${issue?.message ?? "validation failed"}`,
        );
    }
    return parsed.data;
}

/** Wrap a handler in the trust-boundary gate and return a deployable onCall. */
export function validated<S extends z.ZodType, R>(
    cfg: ValidatedConfig<S>,
    handler: (data: z.infer<S>, request: CallableRequest) => R | Promise<R>,
) {
    const appCheck = cfg.appCheck ?? "monitor";
    const callOptions: CallableOptions = {
        ...(cfg.options ?? {}),
        enforceAppCheck: appCheck === "enforce",
    };

    return onCall(callOptions, async (request) => {
        // App Check monitor: log token-less calls to measure coverage before enforce.
        if (appCheck === "monitor" && !request.app) {
            console.warn(
                `[appcheck-monitor] ${cfg.label}: call WITHOUT a valid App Check token (uid=${request.auth?.uid ?? "anon"})`,
            );
        }
        const data = await runGate(cfg, request);
        return handler(data, request);
    });
}

/**
 * nullish(schema) — normalizes JSON `null` to `undefined` before applying an
 * optional schema (sweep C2 / PLAN #2): Firebase's callable serializer strips
 * `undefined` client-side but some call sites still send `null`, which a strict
 * optional would reject. Use for optional fields under strictObject.
 */
export function nullish<S extends z.ZodType>(schema: S) {
    return z.preprocess((v) => (v === null ? undefined : v), schema.optional());
}
