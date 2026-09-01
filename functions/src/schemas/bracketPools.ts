/**
 * Input schemas for the bracket-pool lifecycle callables publishBracketPool
 * and joinBracketPool (bracketPools.ts). createBracketPool is deliberately
 * NOT here — it is gated by the SHARED `bracketCreateInputSchema`
 * (shared/schemas/bracket.ts) via validateCreateInput, plus a strict
 * `bracketSettingsSchema` re-parse of `settings`, plus a pre-destructure
 * shape guard (`assertCreatePayloadIsObject`). The old note about a
 * `...settings` passthrough spread is STALE: the spread was removed by
 * PLAN-AUDIT-AUTH-HARDENING A2 and every accepted settings field is now
 * enumerated in the handler. Top-level non-strictness remains deliberate
 * (launch fields ride at top level; ADR-0001 permissive-create shape).
 * PURE: zod + zodHelpers only.
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
 *
 * ⚠️ OMITTING `password` MEANS "LEAVE IT ALONE", NOT "CLEAR IT". A commissioner
 * can set a password on a DRAFT via `setPoolPassword`, and publish must not
 * silently open the pool (codex r2 P1). Clearing is `setPoolPassword(id, null)`.
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
