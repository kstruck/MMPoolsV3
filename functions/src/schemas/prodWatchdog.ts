import { z } from "zod";

/** No-arg callable — validated() strips the correlation id before this ever
 *  sees the payload, so the only valid shape is an empty object.
 *  Same shape and same reason as getOpsHealthSummarySchema. */
export const getProdWatchdogSchema = z.object({}).strict();
