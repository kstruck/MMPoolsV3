/**
 * Server-authoritative feature-flag + maintenance-mode guards for callables.
 * Reads system/config once per call (fail-open on any read error) and applies
 * the pure predicates from featureFlags.ts.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { isPoolTypeEnabled, isMaintenanceMode, HARD_CLOSED_POOL_TYPES, type FlagConfig } from "./featureFlags";
import { normalizeRole } from "./roles";

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
 * Guard for pool-CREATION callables: rejects when the platform is in
 * maintenance mode or the specific pool type is disabled.
 *
 * `opts.simBypass` - computed at the call site as "simRunIdForCreate stamped
 * a run id", i.e. a server-verified SUPER_ADMIN with a well-formed sim run id
 * that WILL be persisted on the pool doc - skips ONLY the pool-type-flag
 * check (PLAN-SIM-CREATION-BYPASS). Maintenance mode is checked first and
 * unconditionally — it means "no writes", and a bypass never crosses it. A HARD-CLOSED type is checked first for the same reason.
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
  // 🛑 A HARD-CLOSED TYPE IS CLOSED TO THE SIM HARNESS TOO (codex r2 on the
  // squares closure). The bypass is a SUPER_ADMIN path, and the whole claim of
  // `HARD_CLOSED_POOL_TYPES` is that nothing creates the type while it is
  // listed — a carve-out here would make that claim false, and would let the
  // simulator mint pools that exercise the very defect the closure hides.
  // Checked BEFORE the bypass, for the same reason maintenance mode is.
  if ((HARD_CLOSED_POOL_TYPES as readonly string[]).includes(type)) {
    throw new HttpsError(
      "failed-precondition",
      `New ${type} pools are temporarily disabled by the site administrator.`
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
 * Guard for pool PURCHASE / ACTIVATION paths (codex r3 on the squares closure).
 *
 * Closing CREATION does not close BUYING: a commissioner who already holds a
 * draft or trial pool of a hard-closed type could still take it through
 * `createCheckoutSession` (Stripe, or the $0 path) or `redeemPoolCreditForPool`
 * (a bundle credit). Kevin's instruction was "purchased OR setup", so both have
 * to refuse.
 *
 * ⚠️ Pass the PERSISTED `pool.type`, never the client-supplied one — the
 * caller chooses the latter and would simply send a different string.
 *
 * PURE and config-free, so it is safe to call inside a Firestore transaction.
 * An ALREADY-ACTIVE pool is not affected: both call sites refuse before this
 * matters, and nothing here revokes an entitlement somebody already paid for.
 */
export function assertPoolTypePurchasable(type: string | undefined | null): void {
  if (typeof type === "string" && (HARD_CLOSED_POOL_TYPES as readonly string[]).includes(type)) {
    throw new HttpsError(
      "failed-precondition",
      `${type} pools cannot be purchased or upgraded right now. Nothing was charged.`
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
