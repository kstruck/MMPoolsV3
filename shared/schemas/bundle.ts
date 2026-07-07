// Canonical entitlement model (PLAN Phase 4 #14) — the ONE model that replaces
// today's four parallel legacy fields on users/{uid}
// (`freePoolsAvailable`, `activeBundleType`, `bundleExpiresAt`, `poolCredits[]`).
//
// Two orthogonal type fields:
//   - productKind : WHAT it is   — CREDIT_BUNDLE | UNLIMITED_PASS
//   - source      : WHERE it came from — PURCHASE | ADMIN_GRANT | REFERRAL | MIGRATION
//
// Firestore layout:
//   bundles/{bundleId}                       — one owner-scoped entitlement doc
//   bundles/{bundleId}/credits/{creditId}    — one doc per redeemable Pool Credit
//                                              (CREDIT_BUNDLE only; passes have none)
//
// Invariants (also enforced at the creation entrypoints):
//   - CREDIT_BUNDLE: creditsTotal in 1..100, NO termEndsAt (Pool Credits never
//     expire, per CONTEXT.md glossary). creditsTotal === number of credit docs.
//   - UNLIMITED_PASS: creditsTotal === 0, MUST carry termEndsAt, no credit docs.
//   - The 100-credit cap keeps grant + N credit docs + ledger row inside one
//     Firestore transaction (500-write limit) with wide margin.
//
// Shared by the client (@shared/schemas/bundle) and Cloud Functions
// (./shared/schemas/bundle via the copy-shared mirror). Value/type exports are
// also surfaced from '@shared/schemas' — but note billingConfig is imported by
// its own path, and this module mirrors that convention.
import { z } from 'zod';
import { POOL_TYPES } from '../poolTypes';
import type { PoolType } from '../poolTypes';

// --- Enums --------------------------------------------------------------------

export const productKindSchema = z.enum(['CREDIT_BUNDLE', 'UNLIMITED_PASS']);
export type ProductKind = z.infer<typeof productKindSchema>;

export const bundleSourceSchema = z.enum([
  'PURCHASE',
  'ADMIN_GRANT',
  'REFERRAL',
  'MIGRATION',
]);
export type BundleSource = z.infer<typeof bundleSourceSchema>;

export const bundleStatusSchema = z.enum([
  'active',
  'revoked',
  'exhausted',
  'expired',
]);
export type BundleStatus = z.infer<typeof bundleStatusSchema>;

export const creditStatusSchema = z.enum(['available', 'used', 'revoked']);
export type CreditStatus = z.infer<typeof creditStatusSchema>;

/** The hard ceiling on credits per bundle — enforced at EVERY creation entrypoint. */
export const MAX_CREDITS_PER_BUNDLE = 100;

// --- Constraints & product snapshot -------------------------------------------

/** A pool-type value that a credit/bundle may target, or 'ALL' for any format. */
export const bundlePoolTypeSchema = z.union([z.literal('ALL'), z.enum(POOL_TYPES)]);
export type BundlePoolType = z.infer<typeof bundlePoolTypeSchema>;

/**
 * Per-credit constraints. A credit is redeemable against a pool only if these
 * are satisfied (poolType matches or is 'ALL'/absent; the pool's player ceiling
 * is <= maxPlayersPerPool when set).
 */
export const creditConstraintsSchema = z.object({
  poolType: bundlePoolTypeSchema.optional(),
  maxPlayersPerPool: z.number().int().positive().optional(),
});
export type CreditConstraints = z.infer<typeof creditConstraintsSchema>;

/**
 * Immutable snapshot of the product at grant/purchase time. Copied onto the
 * bundle so display + audit are stable even if the billing config later changes.
 */
export const productSnapshotSchema = z.object({
  name: z.string(),
  price: z.number().min(0),
  poolType: bundlePoolTypeSchema,
  maxPlayersPerPool: z.number().int().positive(),
});
export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;

// --- Bundle doc ---------------------------------------------------------------

/**
 * bundles/{bundleId}. Base shape is refine-free so consumers can .pick() slices;
 * the cross-field invariants live in {@link bundleDocSchema} as a superRefine.
 */
const bundleBaseShape = {
  ownerId: z.string().min(1),
  productKind: productKindSchema,
  source: bundleSourceSchema,
  productSnapshot: productSnapshotSchema,
  /** CREDIT_BUNDLE: 1..100. UNLIMITED_PASS: 0 (unlimited activations, term-bound). */
  creditsTotal: z.number().int().min(0).max(MAX_CREDITS_PER_BUNDLE),
  creditsUsed: z.number().int().min(0),
  /** UNLIMITED_PASS only — ms since epoch. Pool Credits never expire. */
  termEndsAt: z.number().int().positive().optional(),
  status: bundleStatusSchema,
  /** source PURCHASE only. */
  stripeSessionId: z.string().optional(),
  paymentIntentId: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  revokedReason: z.string().optional(),
  revokedAt: z.number().int().nonnegative().optional(),
};

export const bundleDocSchema = z
  .object(bundleBaseShape)
  .superRefine((b, ctx) => {
    if (b.productKind === 'UNLIMITED_PASS') {
      if (b.termEndsAt === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['termEndsAt'],
          message: 'UNLIMITED_PASS must carry termEndsAt.',
        });
      }
      if (b.creditsTotal !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['creditsTotal'],
          message: 'UNLIMITED_PASS must have creditsTotal === 0 (unlimited, term-bound).',
        });
      }
    } else {
      // CREDIT_BUNDLE
      if (b.termEndsAt !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['termEndsAt'],
          message: 'CREDIT_BUNDLE must not carry termEndsAt (Pool Credits never expire).',
        });
      }
      if (b.creditsTotal < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['creditsTotal'],
          message: 'CREDIT_BUNDLE must have creditsTotal >= 1.',
        });
      }
    }
    if (b.creditsUsed > b.creditsTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['creditsUsed'],
        message: 'creditsUsed cannot exceed creditsTotal.',
      });
    }
  });
export type BundleDoc = z.infer<typeof bundleDocSchema>;

// --- Credit doc ---------------------------------------------------------------

export const creditDocSchema = z.object({
  constraints: creditConstraintsSchema,
  status: creditStatusSchema,
  /** Set when status === 'used'. */
  usedByPoolId: z.string().optional(),
  usedAt: z.number().int().nonnegative().optional(),
});
export type CreditDoc = z.infer<typeof creditDocSchema>;

// --- Pure helpers (unit-testable; no I/O) -------------------------------------

/**
 * True when a credit with the given constraints may be redeemed against a pool
 * of `poolType` with `poolMaxPlayers` players. Rules:
 *   - poolType: satisfied when the constraint is absent, 'ALL', or an exact match.
 *   - maxPlayersPerPool: satisfied when the constraint is absent, or the pool's
 *     player count is <= the constraint.
 * Total function: never throws.
 */
export function creditSatisfiesPool(
  constraints: CreditConstraints | undefined,
  poolType: PoolType,
  poolMaxPlayers: number | undefined
): boolean {
  const c = constraints ?? {};
  if (c.poolType && c.poolType !== 'ALL' && c.poolType !== poolType) return false;
  if (
    typeof c.maxPlayersPerPool === 'number' &&
    typeof poolMaxPlayers === 'number' &&
    poolMaxPlayers > c.maxPlayersPerPool
  ) {
    return false;
  }
  return true;
}

/** An UNLIMITED_PASS is live only while active AND before its term ends. */
export function isPassLive(bundle: Pick<BundleDoc, 'productKind' | 'status' | 'termEndsAt'>, nowMs: number): boolean {
  if (bundle.productKind !== 'UNLIMITED_PASS') return false;
  if (bundle.status !== 'active') return false;
  return typeof bundle.termEndsAt === 'number' && bundle.termEndsAt > nowMs;
}

/**
 * Given a bundle's current counts, compute the status after consuming one more
 * credit. Pure — the redemption transaction uses this to decide the exhausted
 * transition (creditsUsed === creditsTotal). Passes never call this.
 */
export function statusAfterConsume(
  creditsTotal: number,
  creditsUsedAfter: number
): BundleStatus {
  return creditsUsedAfter >= creditsTotal ? 'exhausted' : 'active';
}
