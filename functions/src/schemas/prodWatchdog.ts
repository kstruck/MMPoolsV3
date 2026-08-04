import { noInputSchema } from "../lib/zodHelpers";

/**
 * No-arg callable. `noInputSchema`, NOT a bare `z.object({}).strict()`.
 *
 * A zero-arg `httpsCallable(fn)()` delivers `request.data` as **null**, and a
 * bare strict object rejects null with invalid-argument before the handler ever
 * runs — so the endpoint's stated no-input contract would be a lie for any
 * caller that does not send an explicit `{}`. That exact bug has shipped in this
 * repo twice (syncMyClaims, then batch 4 / #180), which is why the shared helper
 * with its null→{} preprocess exists. It still rejects unknown fields.
 *
 * The card's own call goes through withCorrelationId, so it sends `{ _correlationId }`
 * and validated() strips that key before parsing — meaning the current caller
 * would not have hit this. It is the NEXT caller that would.
 */
export const getProdWatchdogSchema = noInputSchema;
