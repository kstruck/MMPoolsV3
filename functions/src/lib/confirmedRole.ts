/**
 * confirmedRole — the BOOLEAN half of the claim+doc role gate
 * (PLAN-AUDIT-BACKEND-RESIDUE 17d).
 *
 * `assertCallerRole` THROWS, which is right for a path that is role-gated end to
 * end. It is the wrong shape for an admin **bypass branch** — `const isAdmin =
 * <claim> === 'SUPER_ADMIN'` sitting beside an owner check — because there the
 * answer feeds an `if`, and a failed role check must fall through to the owner
 * check rather than terminate the call. Those branches were the last claim-only
 * SUPER_ADMIN decisions in the callable surface: a demoted admin holding an
 * un-expired token passed every one of them.
 *
 * THE DOC READ IS SHORT-CIRCUITED. Nothing is read unless the JWT claim already
 * says the caller holds one of the roles in question, so an ordinary member pays
 * zero extra reads and zero extra latency on these paths. That is not a new idea
 * here — `stripe.ts`'s `readCallerRole` (PLAN-COMMISSIONER-TRANSFER K17) is the
 * same shape with the same rationale.
 *
 * FAIL-CLOSED. A `users/{uid}` read that throws yields `false`, never `true`:
 * a principal we cannot confirm gets the un-elevated path. The error is logged
 * rather than swallowed, because "the admin bypass stopped working" and "the
 * users collection is unreadable" must be distinguishable in the logs.
 */

import { assertCallerRole } from "./assertRole";
import { normalizeRole, type CanonicalRole } from "./roles";

/** The minimal request shape this module needs (a real CallableRequest satisfies it). */
export interface RoleCheckRequest {
    auth?: { uid: string; token: Record<string, unknown> } | null;
}

/**
 * Does the caller hold one of `allowedRoles` per BOTH the JWT claim AND the
 * `users/{uid}.role` doc? Never throws — see the fail-closed note above.
 */
export async function hasConfirmedRole(
    request: RoleCheckRequest,
    ...allowedRoles: CanonicalRole[]
): Promise<boolean> {
    if (!request.auth) return false;
    const claimed = normalizeRole((request.auth.token.role as string) ?? null);
    // Not even claiming it — the doc cannot make it true, so do not read it.
    if (!allowedRoles.includes(claimed)) return false;
    try {
        await assertCallerRole(request, ...allowedRoles);
        return true;
    } catch (e) {
        console.warn(
            `[confirmedRole] ${claimed} claim for uid=${request.auth.uid} not confirmed by users/{uid}.role: ` +
            (e instanceof Error ? e.message : String(e)),
        );
        return false;
    }
}

/**
 * The caller's role claim with an UNCONFIRMED `SUPER_ADMIN` stripped to
 * `undefined`; every other claim is passed through untouched.
 *
 * For the two sites that hand a role STRING to `assertPoolOwnerOrSuperAdmin`.
 * That helper is synchronous, pure, and shared with three files outside this
 * change's blast radius, so it is fed a resolved role rather than made async.
 * Passing `undefined` is safe and precise: the helper branches on
 * `=== 'SUPER_ADMIN'` and on nothing else, so any other value — including
 * absence — means "decide this on pool ownership alone".
 */
export async function confirmedAdminClaim(request: RoleCheckRequest): Promise<string | undefined> {
    const claim = (request.auth?.token.role as string | undefined) ?? undefined;
    if (claim !== "SUPER_ADMIN") return claim;
    return (await hasConfirmedRole(request, "SUPER_ADMIN")) ? claim : undefined;
}

/**
 * The HTTP-endpoint sibling of hasConfirmedRole
 * (PLAN-API-TRUST-BOUNDARY-REMEDIATION Phase 3, codex r2 #4).
 *
 * `inspectPoolState` and `testSmsHttp` verify a Bearer ID token themselves, so
 * they hold a DECODED token rather than a CallableRequest. Same contract as the
 * callable side: the claim short-circuits (no read unless the token claims
 * SUPER_ADMIN), the `users/{uid}.role` doc must AGREE, and a doc read failure
 * yields `false` — fail closed, logged. NOT pure: it reads Firestore.
 *
 * Call it OUTSIDE the endpoint's verifyIdToken try/catch: an invalid token is
 * that catch's 401; a valid token this function does not confirm is a 403.
 */
export async function confirmedSuperAdminHttp(
    decoded: { uid: string; role?: unknown },
): Promise<boolean> {
    if (decoded.role !== "SUPER_ADMIN") return false;
    return hasConfirmedRole(
        { auth: { uid: decoded.uid, token: { role: decoded.role } } },
        "SUPER_ADMIN",
    );
}
