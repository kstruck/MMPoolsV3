import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);

/**
 * settlePool (PLAN-SPLIT-POT-SETTLEMENT §2.2). Strict: an unknown key is a
 * client/server mismatch, not something to ignore. The correlation id is
 * stripped by `validated` before this runs.
 *
 * `entryIds` is not a CHOICE of winners — the server refuses anything but the
 * exact ALIVE set (D3). The client sends what it showed, so a stale screen (a
 * player eliminated since it loaded) is refused instead of silently settling a
 * different field than the commissioner confirmed.
 */
export const settlePoolSchema = z.strictObject({
    poolId,
    outcome: z.literal("SPLIT"),
    /**
     * Read-only: return the ALIVE entries, the pot and the per-winner share the
     * settlement WOULD record, computed by the finalizer's own functions. The
     * panel shows this and sends back exactly these ids (codex code-review r1
     * P1: the client's standings projection cannot tell an unscored ALIVE entry
     * from a roster-only member, so the client must not derive the set).
     */
    preview: z.boolean().optional(),
    entryIds: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
    note: z.string().trim().max(500).optional(),
    notifyMembers: z.boolean().default(true),
}).refine((d) => d.preview === true || (d.entryIds?.length ?? 0) > 0, {
    message: "entryIds is required unless preview is true",
    path: ["entryIds"],
});

export type SettlePoolInput = z.infer<typeof settlePoolSchema>;
