/**
 * Admin Claims — Cloud Functions for managing user roles via Custom Claims.
 *
 * The canonical role model lives in ./lib/roles.ts (T6). The custom claim
 * (request.auth.token.role) is authoritative for Firestore rules; the
 * users/{uid}.role field is the mirror for display + the token-refresh fallback.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { CANONICAL_ROLES, normalizeRole, type CanonicalRole } from "./lib/roles";
import { writeAdminAudit } from "./lib/adminAudit";

/** Roles ranked low→high for detecting a downward change (token revocation). */
const ROLE_RANK: Record<CanonicalRole, number> = {
  BANNED: 0,
  MEMBER: 1,
  COMMISSIONER: 2,
  MODERATOR: 3,
  SUPER_ADMIN: 4,
};

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

/**
 * setUserRole — the single authoritative role-change callable (T6).
 * Caller must be SUPER_ADMIN (claim + doc agree). Accepts any canonical role.
 *
 * Write sequence is NOT atomic across Auth and Firestore: set the custom claim
 * first, then mirror the Firestore field. If the mirror write fails the function
 * throws and the admin re-runs — setCustomUserClaims is idempotent, so this is
 * the accepted split-brain recovery path. On any downward change the target's
 * refresh tokens are revoked so a stale elevated token cannot linger.
 */
export const setUserRole = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");

  const { targetUid, role } = request.data as { targetUid: string; role: string };
  if (!targetUid || typeof targetUid !== "string") {
    throw new HttpsError("invalid-argument", "targetUid (string) is required.");
  }
  if (!role || !(CANONICAL_ROLES as readonly string[]).includes(role)) {
    throw new HttpsError(
      "invalid-argument",
      `role must be one of: ${CANONICAL_ROLES.join(", ")}.`
    );
  }
  const nextRole = role as CanonicalRole;

  // Determine prior role for downward-change detection (best-effort).
  const targetDoc = await admin.firestore().doc(`users/${targetUid}`).get();
  const priorRole = normalizeRole((targetDoc.data()?.role as string) ?? null);

  await admin.auth().getUser(targetUid); // throws not-found if target is missing

  // (a) authoritative claim, then (b) Firestore mirror.
  await admin.auth().setCustomUserClaims(targetUid, { role: nextRole });
  await admin.firestore().doc(`users/${targetUid}`).set({ role: nextRole }, { merge: true });

  // Revoke refresh tokens on any downward move (demotion or ban).
  if (ROLE_RANK[nextRole] < ROLE_RANK[priorRole]) {
    await admin.auth().revokeRefreshTokens(targetUid);
  }

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "ROLE_CHANGED",
    targetType: "user",
    targetId: targetUid,
    metadata: { from: priorRole, to: nextRole },
    status: "success",
  });

  return { success: true, role: nextRole, message: `User ${targetUid} is now ${nextRole}.` };
});

/**
 * setSuperAdminClaim — DEPRECATED. Kept as a thin passthrough so any un-migrated
 * caller keeps working; new code uses setUserRole. Grants/revokes SUPER_ADMIN,
 * demoting to MEMBER (canonical) rather than the legacy PARTICIPANT.
 */
export const setSuperAdminClaim = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const { targetUid, isSuperAdmin } = request.data as { targetUid: string; isSuperAdmin: boolean };
  if (!targetUid || typeof isSuperAdmin !== "boolean") {
    throw new HttpsError("invalid-argument", "targetUid (string) and isSuperAdmin (boolean) are required.");
  }
  const nextRole: CanonicalRole = isSuperAdmin ? "SUPER_ADMIN" : "MEMBER";

  const targetDoc = await admin.firestore().doc(`users/${targetUid}`).get();
  const priorRole = normalizeRole((targetDoc.data()?.role as string) ?? null);

  await admin.auth().getUser(targetUid);
  await admin.auth().setCustomUserClaims(targetUid, { role: nextRole });
  await admin.firestore().doc(`users/${targetUid}`).set({ role: nextRole }, { merge: true });
  if (ROLE_RANK[nextRole] < ROLE_RANK[priorRole]) {
    await admin.auth().revokeRefreshTokens(targetUid);
  }

  await writeAdminAudit({
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: "ROLE_CHANGED",
    targetType: "user",
    targetId: targetUid,
    metadata: { from: priorRole, to: nextRole, via: "setSuperAdminClaim" },
    status: "success",
  });

  return { success: true, message: `User ${targetUid} is now ${nextRole}.` };
});

/**
 * syncMyClaims — self-only bootstrap recovery for the SUPER_ADMIN catch-22
 * (Firestore says SUPER_ADMIN but the token lacks the claim, so no admin write
 * can succeed to fix it). Hardened per PLAN-USER-MGMT:
 *  - self-only: a caller may only sync THEIR OWN claims.
 *  - privileged mint gated on Firestore role: only re-mints a privileged claim
 *    when the rules-protected users/{uid}.role already says so. Non-privileged
 *    users just get their (normalized) role reflected — no escalation is possible
 *    because rules forbid a user from writing their own role field.
 *  - legacy values are normalized (PARTICIPANT→MEMBER) before minting.
 */
export const syncMyClaims = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  const uid = request.auth.uid;

  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User document not found in Firestore.");
  }

  const role = normalizeRole((userDoc.data()?.role as string) ?? null);
  await admin.auth().setCustomUserClaims(uid, { role });

  return {
    success: true,
    role,
    message: `Auth custom claims synced with Firestore. Role is now ${role}.`,
  };
});

/**
 * backfillUserRoles (T6) — one-time migration of EXISTING stored data. Rewrites
 * legacy global roles (POOL_MANAGER/PARTICIPANT/MANAGER/USER) to canonical
 * values in BOTH the users/{uid}.role doc AND the Auth custom claim, so
 * canonical role-filtered queries (where('role','==','MEMBER')) stop silently
 * missing legacy docs. SUPER_ADMIN only. dryRun (default true) reports counts
 * without writing. Bounded per run; re-run until remaining === 0.
 */
const LEGACY_ROLE_VALUES = ["POOL_MANAGER", "PARTICIPANT", "MANAGER", "USER"];
const BACKFILL_MAX = 400;

export const backfillUserRoles = onCall(async (request) => {
  const caller = await assertCallerRole(request, "SUPER_ADMIN");
  const dryRun = (request.data as { dryRun?: boolean })?.dryRun !== false; // default true

  const snap = await admin.firestore()
    .collection("users")
    .where("role", "in", LEGACY_ROLE_VALUES)
    .limit(BACKFILL_MAX + 1)
    .get();

  const docs = snap.docs.slice(0, BACKFILL_MAX);
  const more = snap.size > BACKFILL_MAX;

  if (dryRun) {
    await writeAdminAudit({
      actorUid: caller.uid, actorEmail: caller.email,
      action: "ROLE_BACKFILL", targetType: "user",
      metadata: { dryRun: true, wouldMigrate: docs.length, more },
      status: "success",
    });
    return { success: true, dryRun: true, wouldMigrate: docs.length, more };
  }

  let migrated = 0;
  for (const d of docs) {
    const canonical = normalizeRole(d.data()?.role as string);
    try {
      await d.ref.update({ role: canonical });
      await admin.auth().setCustomUserClaims(d.id, { role: canonical });
      migrated++;
    } catch (e) {
      console.error(`[backfillUserRoles] failed for ${d.id}:`, e);
    }
  }

  await writeAdminAudit({
    actorUid: caller.uid, actorEmail: caller.email,
    action: "ROLE_BACKFILL", targetType: "user",
    metadata: { dryRun: false, migrated, more },
    status: "success",
  });
  return { success: true, dryRun: false, migrated, more };
});
