/** Input schema for getPoolPicks (PLAN-COMMISSIONER-BLIND-PICKS T2). PURE: zod only. */
import { z } from "zod";

export const getPoolPicksSchema = z.strictObject({
    poolId: z.string().trim().min(1).max(200),
    /** NFL week: regular season + postseason, same bounds as proxyPick. */
    week: z.number().int().min(1).max(23),
});

export type GetPoolPicksInput = z.infer<typeof getPoolPicksSchema>;
