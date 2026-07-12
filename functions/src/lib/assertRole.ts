/**
 * assertCallerRole — the shared claim+doc role gate. Lives in lib/ (not
 * adminClaims.ts) so lib/validated.ts can import it without a module cycle once
 * adminClaims' own callables are wrapped in validated(). adminClaims re-exports
 * it for the existing importers.
 */

import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { normalizeRole, type CanonicalRole } from "./roles";

/**
 * Assert the caller holds one of `allowedRoles` per BOTH the JWT claim AND the
 * Firestore users/{uid}.role doc (normalized). Requiring both agree blocks a
 * demoted-but-not-yet-refreshed token from acting on a stale claim. Returns the
 * caller's uid + email for audit logging.
 */
export async function assertCallerRole(
  request: { auth?: { uid: string; token: Record<string, unknown> } | null },
  ...allowedRoles: CanonicalRole[]
): Promise<{ uid: string; email?: string }> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  const uid = request.auth.uid;
  const claimRole = normalizeRole((request.auth.token.role as string) ?? null);

  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const docRole = normalizeRole((snap.data()?.role as string) ?? null);

  const allowed = new Set(allowedRoles);
  if (!allowed.has(claimRole) || !allowed.has(docRole)) {
    throw new HttpsError(
      "permission-denied",
      "Caller lacks the required role (claim and profile must agree)."
    );
  }
  return { uid, email: (request.auth.token.email as string) ?? undefined };
}
