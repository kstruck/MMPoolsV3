/**
 * Input schemas for the no-input SUPER_ADMIN SWEEP-LATER callables:
 * getAdminHealthSnapshot, backfillPools, refreshExpertPicks, syncPlayoffPools.
 * All four take NO client input — see noInputSchema's doc comment for the
 * null-vs-{} transport quirk. PURE: zod only, no firebase imports.
 */

import { noInputSchema } from "../lib/zodHelpers";

export const getAdminHealthSnapshotSchema = noInputSchema;
export const backfillPoolsSchema = noInputSchema;
export const refreshExpertPicksSchema = noInputSchema;
export const syncPlayoffPoolsSchema = noInputSchema;
