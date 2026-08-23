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
import { ensureMemberRecord } from './memberRecord';

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

/** All paid features explicitly locked. Stamped on free/trial launches so
 *  deny-by-default access checks (billing.ts checkBillingAccess) are legible and
 *  a missing flag never accidentally unlocks a paid feature. */
export const LOCKED_FEATURES = {
  aiCommissioner: false,
  smsNotifications: false,
  whatIfSimulator: false,
  customBranding: false,
} as const;

export type LaunchBillingMode = 'free' | 'trial';

/**
 * Launch billing mode (PLAN Phase 2, amends ADR-0001 point 5). The create
 * callables compute a server-validated mode and stamp it here:
 *   - 'free'  → { status:'free', tier:'free_tier', pricePaid:0 } (as today) +
 *               explicit locked features.
 *   - 'trial' → { status:'trial', trialEndsAt: now + trialDays*86400000,
 *               tier:'standard_tier', pricePaid:0 } + explicit locked features.
 *
 * `trialDays` comes from billing_config (default 14). `nowMs` is injected for
 * deterministic tests. Backward-compatible: {@link freeBilling} delegates here
 * with 'free' so existing callers keep working unchanged in shape (plus the new
 * explicit featuresUnlocked stamp).
 */
export function billingForLaunch(
  mode: LaunchBillingMode = 'free',
  trialDays = 14,
  nowMs: number = Date.now(),
  /**
   * The add-ons the commissioner selected in the wizard
   * (PLAN-WIZARD-BUYFLOW-FIXES T5, Kevin's D2: approved).
   *
   * A trial used to stamp `featuresUnlocked` ALL FALSE regardless, so a
   * commissioner who ticked AI Commissioner and started the trial had no AI tab
   * for the whole trial — they could not try the very thing the trial exists to
   * sell, and add-ons only turned on after payment. `featuresUnlocked` is what
   * gates the AI tab (`NFLPoolDashboard`) and `checkBillingAccess`.
   *
   * ⚠️ The FREE path stays all-false, and that is not an oversight: any paid
   * add-on forces `computeLaunchMode` to 'trial', so a free pool by definition
   * selected none. Unlocking there would hand out paid features permanently to
   * pools that never enter a trial at all.
   *
   * Expiry is the only guard needed: trial → grace → locked already reclaims
   * these. The named risk (codex r1 #4 on the plan) is that trial OUTPUT is
   * durable — a pool can run 14 days, extract the AI recaps and never pay. D2
   * accepts that as the ordinary cost of a free trial; the exposure is one pool
   * for 14 days, and the alternative is selling add-ons nobody can try.
   */
  addons?: Partial<Record<keyof typeof LOCKED_FEATURES, boolean>>,
) {
  if (mode === 'trial') {
    return {
      status: 'trial' as const,
      tier: 'standard_tier' as const,
      pricePaid: 0,
      trialEndsAt: nowMs + Math.max(1, Math.round(trialDays)) * 24 * 60 * 60 * 1000,
      featuresUnlocked: trialFeaturesUnlocked(addons),
    };
  }
  return {
    status: 'free' as const,
    tier: 'free_tier' as const,
    pricePaid: 0,
    featuresUnlocked: { ...LOCKED_FEATURES },
  };
}

/**
 * The trial's `featuresUnlocked`: every selected add-on on, everything else
 * explicitly off. Only an explicit `true` counts — Firestore payload shapes are
 * untrusted, and a truthy string must not unlock a paid feature.
 *
 * Keyed off LOCKED_FEATURES so a feature added there is off by default here
 * rather than silently absent, which `checkBillingAccess` would read as denied
 * anyway but leaves the document illegible.
 */
export function trialFeaturesUnlocked(
  addons?: Partial<Record<keyof typeof LOCKED_FEATURES, boolean>>,
): typeof LOCKED_FEATURES {
  const out = { ...LOCKED_FEATURES } as Record<string, boolean>;
  for (const key of Object.keys(LOCKED_FEATURES)) {
    out[key] = addons?.[key as keyof typeof LOCKED_FEATURES] === true;
  }
  return out as typeof LOCKED_FEATURES;
}

/** @deprecated Use billingForLaunch('free'). Retained so existing create
 *  callables keep compiling/working; now stamps explicit locked features too. */
export function freeBilling() {
  return billingForLaunch('free');
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
  ownerName?: string;
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

  // Owner Member Record (roster truth, ADR 0003). NFL season pools seed it in
  // createNFLPool (which also stamps role/name); here it covers Squares/Bracket/
  // Props/Playoff owners. Brand-new pool -> no existing record.
  if (!isNflSeasonType(opts.poolType)) {
    ensureMemberRecord(t, db, opts.poolId, opts.uid,
      { userName: opts.ownerName || 'Host', role: 'MANAGER', poolType: opts.poolType, present: true },
      null, opts.nowMs);
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
