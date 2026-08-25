/**
 * Input schemas for the pool-password callables (PLAN-AUDIT-AUTH-HARDENING
 * Phase B). PURE: zod + zodHelpers only.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";
import { MAX_POOL_PASSWORD_LENGTH } from "../lib/poolPassword";

const poolId = z.string().trim().min(1).max(200);

/**
 * setPoolPassword — `{ poolId, password }`.
 *
 * `password: null` CLEARS the pool's password; a non-empty string sets it. An
 * EMPTY string is rejected rather than treated as a clear: the difference
 * between "the commissioner cleared the gate" and "a form submitted its empty
 * default" is exactly the difference between a deliberate act and a pool
 * silently going public, and the two must not share an encoding.
 */
export const setPoolPasswordSchema = z.strictObject({
    poolId,
    password: z.union([z.string().min(1).max(MAX_POOL_PASSWORD_LENGTH), z.null()]),
});

/** verifyPoolAccess — `{ poolId, password }`. Public (guest share links). */
export const verifyPoolAccessSchema = z.strictObject({
    poolId,
    password: z.string().max(MAX_POOL_PASSWORD_LENGTH),
});

/**
 * migratePoolPasswords — the Rule 1 sweep. `dryRun` DEFAULTS TRUE at the schema
 * layer (not a handler `=== true`), so an omitted field can never mutate
 * production data.
 */
export const migratePoolPasswordsSchema = z.strictObject({
    dryRun: z.boolean().default(true),
    limit: nullish(z.number().int().min(1).max(500)),
    startAfter: nullish(z.string().max(200)),
});

export type SetPoolPasswordInput = z.infer<typeof setPoolPasswordSchema>;
export type VerifyPoolAccessInput = z.infer<typeof verifyPoolAccessSchema>;
export type MigratePoolPasswordsInput = z.infer<typeof migratePoolPasswordsSchema>;
