/**
 * Server-authoritative feature-flag + maintenance-mode guards for callables.
 * Reads system/config once per call (fail-open on any read error) and applies
 * the pure predicates from featureFlags.ts.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { isPoolTypeEnabled, isMaintenanceMode, type FlagConfig } from "./featureFlags";
import { normalizeRole } from "./roles";
import { isSimPool } from "../shared/testPool";

async function loadConfig(): Promise<FlagConfig | null> {
  try {
    const snap = await admin.firestore().collection("system").doc("config").get();
    return snap.exists ? (snap.data() as FlagConfig) : null;
  } catch {
    // Fail open: a config-read failure must never block legitimate actions.
    return null;
  }
}

/**
 * PURE predicate: may this creation bypass the pool-type kill-switch?
 * Both legs required — the server-verified SUPER_ADMIN claim AND a payload
 * that self-identifies as a sim pool (`simRunId` / `season: sim-…`). A
 * non-admin forging a sim season fails the role leg; a SUPER_ADMIN creating
 * a REAL pool fails the payload leg, so the kill-switch keeps meaning what
 * it says for real pools even for the operator. (PLAN-SIM-CREATION-BYPASS —
 * the 45-scenario E2E suite failed 45/45 against the launch kill-switch and
 * running it required flipping prod flags on and back off by hand.)
 */
export function simCreationBypassAllowed(
  role: string | null | undefined,
  payload: { season?: unknown; simRunId?: unknown } | null | undefined,
): boolean {
  return normalizeRole(role) === "SUPER_ADMIN" && isSimPool(payload ?? undefined);
}

/**
 * Guard for pool-CREATION callables: rejects when the platform is in
 * maintenance mode or the specific pool type is disabled.
 *
 * `opts.simBypass` (computed via simCreationBypassAllowed at the call site)
 * skips ONLY the pool-type-flag check. Maintenance mode is checked first and
 * unconditionally — it means "no writes", and a bypass never crosses it.
 */
export async function assertPoolCreationAllowed(
  type: string,
  opts?: { simBypass?: boolean }
): Promise<void> {
  const cfg = await loadConfig();
  if (isMaintenanceMode(cfg)) {
    throw new HttpsError(
      "failed-precondition",
      "The platform is in maintenance mode; new pools are temporarily disabled."
    );
  }
  if (opts?.simBypass === true) return;
  if (!isPoolTypeEnabled(cfg, type)) {
    throw new HttpsError(
      "failed-precondition",
      `New ${type} pools are temporarily disabled by the site administrator.`
    );
  }
}

/**
 * Guard for state-changing NON-creation callables (join/submit/pay/grade):
 * rejects only when the platform is in maintenance mode.
 */
export async function assertNotMaintenance(): Promise<void> {
  const cfg = await loadConfig();
  if (isMaintenanceMode(cfg)) {
    throw new HttpsError(
      "failed-precondition",
      "The platform is in maintenance mode; changes are temporarily disabled."
    );
  }
}

/**
 * Reject a BANNED user at the callable layer (T6/CONTEXT.md — BANNED is blocked
 * at UI AND server). Distinct from the pure claim-based assertNotBanned in
 * lib/poolCreation: this reads the rules-protected Firestore role, so a fresh
 * ban bites on the very NEXT call rather than after token refresh. Fail-open on
 * a read error (never block a legitimate user because a lookup hiccuped). Call
 * at the top of participation/state-changing callables that lack a ban check.
 */
export async function assertNotBannedLive(uid: string | undefined): Promise<void> {
  if (!uid) return;
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    if (normalizeRole((snap.data()?.role as string) ?? null) === "BANNED") {
      throw new HttpsError("permission-denied", "This account is banned from interacting with pools.");
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e; // the ban itself — propagate
    console.warn("[assertNotBanned] role read failed; failing open:", e);
  }
}
