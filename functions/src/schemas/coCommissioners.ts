/**
 * Input schema for setPoolCoCommissioner (PLAN-CO-COMMISSIONERS D2). PURE: zod only.
 *
 * ONE uid per call, never an array — a full-array replacement reinstates the
 * stale-tab race the revision fence exists to close (codex r2 on the plan).
 * `revision` is REQUIRED for `add` (the caller presents the coManagersRevision
 * it saw; a moved revision fails failed-precondition) and absent for `remove`
 * (remove always wins). Discriminated so a client cannot send an add without it.
 */
import { z } from "zod";

const poolId = z.string().trim().min(1).max(200);
const uid = z.string().trim().min(1).max(128);

export const setPoolCoCommissionerSchema = z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("add"), poolId, uid, revision: z.number().int().min(0) }),
    z.strictObject({ op: z.literal("remove"), poolId, uid }),
]);

export type SetPoolCoCommissionerInput = z.infer<typeof setPoolCoCommissionerSchema>;
