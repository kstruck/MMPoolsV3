/**
 * Pure zod helpers for callable input schemas.
 *
 * Deliberately imports NOTHING but zod: callable schemas must be importable by
 * unit tests without pulling in firebase-admin (several modules call
 * admin.firestore() at module scope, which throws without initializeApp()).
 */

import { z } from "zod";

/**
 * nullish(schema) — normalizes JSON `null` to `undefined` before applying an
 * optional schema (PLAN #2 / sweep C2). Firebase's callable serializer strips
 * `undefined` client-side, but some call sites still send `null`, which a strict
 * optional field would otherwise reject. Use for optional fields under strictObject.
 */
export function nullish<S extends z.ZodType>(schema: S) {
    return z.preprocess((v) => (v === null ? undefined : v), schema.optional());
}

/**
 * noInputSchema — for callables that take NO client input. A no-arg
 * `httpsCallable(fn)()` call delivers `request.data` as `null` (not
 * `undefined`), which a bare `z.strictObject({})` rejects with
 * invalid-argument before the handler ever runs — a real bug caught in
 * syncMyClaims (PICKUP-CALLABLE-SWEEP.md). Normalize null/undefined to {}
 * first, still reject any actual field. Reuse this exact instance for every
 * true no-input callable — zod schemas are stateless and safely shared.
 */
export const noInputSchema = z.preprocess((v) => v ?? {}, z.strictObject({}));
