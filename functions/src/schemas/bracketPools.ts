/**
 * Input schemas for the bracket-pool lifecycle callables publishBracketPool
 * and joinBracketPool (bracketPools.ts). createBracketPool is deliberately
 * NOT here — it takes a rich nested `settings` object with a `...settings`
 * passthrough spread (stores arbitrary client-supplied settings fields),
 * spiritually the same migration/heterogeneous shape as the ADR-0001
 * PERMISSIVE creates (createPool/createNFLPool); a flat .strict() schema would
 * reject fields it currently stores, so it needs a passthrough envelope or a
 * client cutover — deferred to its own batch. PURE: zod + zodHelpers only.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

const poolId = z.string().trim().min(1).max(200);

/**
 * publishBracketPool — { poolId, slug, password?, isListedPublic? }. slug is
 * length-bounded here; its charset is validated in-handler AFTER lowercasing
 * (kept there so mixed-case input isn't rejected before normalization).
 * password is a user-chosen POOL password (hashed server-side with PBKDF2 and
 * stored in `pools/{id}/private/access`, never on the world-readable pool doc —
 * PLAN-AUDIT-AUTH-HARDENING Phase B), not a system credential.
 */
export const publishBracketPoolSchema = z.strictObject({
    poolId,
    slug: z.string().trim().min(1).max(100),
    password: nullish(z.string().max(200)),
    isListedPublic: nullish(z.boolean()),
});

/** joinBracketPool — { poolId, password? }. */
export const joinBracketPoolSchema = z.strictObject({
    poolId,
    password: nullish(z.string().max(200)),
});

export type PublishBracketPoolInput = z.infer<typeof publishBracketPoolSchema>;
export type JoinBracketPoolInput = z.infer<typeof joinBracketPoolSchema>;
