/**
 * Input schemas for sendManualReminder (sweep #72) and joinWaitlist (#89).
 * PURE: zod only.
 */

import { z } from "zod";
import { nullish } from "../lib/zodHelpers";

const poolId = z.string().trim().min(1).max(200);

/** sendManualReminder — kind enum mirrors the old hand check; targetUids optional filter. */
export const sendManualReminderSchema = z.strictObject({
    poolId,
    kind: z.enum(["PICKS", "PAYMENT"]),
    targetUids: nullish(z.array(z.string().min(1).max(200)).max(500)),
});

/** joinWaitlist — PUBLIC guest flow: { poolId, name, email } all required (old code threw). */
export const joinWaitlistSchema = z.strictObject({
    poolId,
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().min(3).max(320),
});

export type SendManualReminderInput = z.infer<typeof sendManualReminderSchema>;
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
