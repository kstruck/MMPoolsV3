// Shared core for pool creation — the single source of truth for input
// validation, billing defaults, and the create-time side-effect bundle. The
// three create callables (createPool, createNFLPool, createBracketPool) all
// route their common logic through here so validation, billing, activity
// logging, and owner indexes stay identical across pool types.
//
// See ADR 0001 and docs/wizard-unification/PHASE-A-INVENTORY.md.
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { getCreateInputSchema } from '../shared/schemas';
import type { PoolType } from '../shared/poolTypes';
import { isNflSeasonType } from '../shared/poolTypes';

// Roles that must never create pools. Everyone else may (creating a first pool
// upgrades a plain member — preserving today's behavior); we accept both legacy
// and renamed role values from claim and user doc during the role migration.
const BANNED_ROLE = 'BANNED';

/** Deny only BANNED. Claim is authoritative; the doc value is a fallback. */
export function assertNotBanned(
  claimRole: string | undefined,
  docRole: string | undefined,
): void {
  if (claimRole === BANNED_ROLE || docRole === BANNED_ROLE) {
    throw new HttpsError(
      'permission-denied',
      'This account is not permitted to create pools.',
    );
  }
}

/**
 * Validation GATE: throws HttpsError('invalid-argument') if the payload fails
 * the type's CreatePoolInput schema. Returns silently for types without a
 * schema (all seven are modeled today; this keeps migration incremental).
 * The caller persists the ORIGINAL privilege-stripped payload — the schema
 * only gates, it does not transform.
 */
export function validateCreateInput(type: PoolType, data: unknown): void {
  const schema = getCreateInputSchema(type);
  if (!schema) return;
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.join('.') || '(root)';
    throw new HttpsError(
      'invalid-argument',
      `Invalid pool configuration: ${path} — ${issue?.message ?? 'validation failed'}`,
    );
  }
}

// New pools launch on the free plan (no auto-lock). Stamping this explicitly is
// behavior-equivalent to today's absent-billing (checkBillingAccess and
// enforceBillingStatus both treat missing and 'free' identically) but makes the
// state legible. See PHASE-A-INVENTORY.md §5.
export function freeBilling() {
  return { status: 'free' as const, tier: 'free_tier', pricePaid: 0 };
}

// Legacy value the current code upgrades a fresh creator to. The renamed
// 'COMMISSIONER' value is accepted elsewhere; the target stays POOL_MANAGER
// until the role migration lands on this branch.
const CREATOR_ROLE = 'COMMISSIONER';
const UPGRADEABLE_ROLES = new Set(['PARTICIPANT', 'MEMBER', undefined]);

export interface PoolCreationSideEffectOpts {
  uid: string;
  poolId: string;
  poolName: string;
  poolType: PoolType;
  nowMs: number;
  currentRole: string | undefined;
}

/**
 * Emits the uniform create-time side-effect bundle inside an existing
 * transaction: the managedPools owner index (all types), a participations
 * index (NFL season types, preserving createNFLPool's behavior), the
 * POOL_CREATED user Activity Log event (new — CONTEXT.md documents it but no
 * writer existed), and the first-pool role upgrade. The pool doc and pool
 * audit entry are written by the caller.
 */
export function writePoolCreationSideEffects(
  t: admin.firestore.Transaction,
  opts: PoolCreationSideEffectOpts,
): void {
  const db = admin.firestore();
  const userRef = db.collection('users').doc(opts.uid);

  // managedPools — owner index for every pool type
  t.set(userRef.collection('managedPools').doc(opts.poolId), {
    poolId: opts.poolId,
    createdAt: opts.nowMs,
    name: opts.poolName,
    type: opts.poolType,
  });

  // participations — preserved for NFL season pools (createNFLPool wrote this)
  if (isNflSeasonType(opts.poolType)) {
    t.set(userRef.collection('participations').doc(opts.poolId), {
      poolId: opts.poolId,
      joinedAt: opts.nowMs,
      name: opts.poolName,
      type: opts.poolType,
      role: 'MANAGER',
    });
  }

  // POOL_CREATED — per-user Activity Log (new writer; CONTEXT.md)
  t.set(userRef.collection('activity').doc(), {
    type: 'POOL_CREATED',
    poolId: opts.poolId,
    poolName: opts.poolName,
    poolType: opts.poolType,
    timestamp: opts.nowMs,
  });

  // First-pool role upgrade → canonical COMMISSIONER (T6). Accepts legacy or
  // canonical upgradeable current roles (UPGRADEABLE_ROLES).
  if (UPGRADEABLE_ROLES.has(opts.currentRole)) {
    t.update(userRef, { role: CREATOR_ROLE });
  }
}
