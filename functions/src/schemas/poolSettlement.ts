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
    entryIds: z.array(z.string().min(1).max(100)).min(1).max(50),
    note: z.string().trim().max(500).optional(),
    notifyMembers: z.boolean().default(true),
});

export type SettlePoolInput = z.infer<typeof settlePoolSchema>;
