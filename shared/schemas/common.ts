// Reusable CreatePoolInput building blocks. These validate wizard form input
// (not stored docs). Kept framework-free so both src/ (RHF zodResolver) and
// functions/ (createPool) validate against the exact same source.
//
// Schemas are used as GATES: the callable calls .parse() to throw on invalid
// input, then persists the original (privilege-stripped) payload. Unknown keys
// are therefore intentionally ignored, not an error — they are legitimate
// per-type wizard config the gate doesn't need to enumerate.
import { z } from 'zod';

// Forms submit '' (not undefined) for empty optional fields, which would fail a
// bare .min(1)/.email() optional. Coerce blank/whitespace to undefined first so
// an empty optional is genuinely "not provided" — for the client RHF resolver
// AND the server gate (both use these schemas).
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
export const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());
export const optionalEmail = z.preprocess(blankToUndefined, z.string().trim().email().optional());
// For number-typed fields fed by a plain <input> left untouched at its blank
// default — z.number() has no string coercion, so a bare '' would fail
// validation invisibly. Distinct from numberSets-style <select> fields, which
// always carry a real option value, never blank.
export const optionalNumber = z.preprocess(blankToUndefined, z.coerce.number().optional());

// For a millis-since-epoch field whose schema is shared by BOTH the client
// resolver (raw <input type="datetime-local"> string, e.g. "2026-01-10T18:00")
// and the server gate (already-converted millis number from the payload
// builder). z.coerce.number() can't parse a datetime string (Number(iso) is
// NaN) — parse it as a date instead, falling through to plain numeric coercion
// for an already-millis value.
const toDateMillis = (v: unknown) => {
  const cleaned = blankToUndefined(v);
  if (cleaned === undefined) return undefined;
  if (typeof cleaned === 'number') return cleaned;
  if (typeof cleaned === 'string') {
    const ms = new Date(cleaned).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return cleaned;
};
export const optionalDateMillis = z.preprocess(toDateMillis, z.number().optional());

// Mirrors shared/paymentHandles.ts PaymentHandles.
export const paymentHandlesSchema = z
  .object({
    venmo: optionalText,
    zelle: optionalText,
    cashapp: optionalText,
    paypal: optionalText,
    googlePay: optionalText,
  })
  .partial();

export const entryFeeSchema = z.number().min(0);

export const payoutPlaceSchema = z.object({
  rank: z.number().int().positive(),
  percentage: z.number().min(0).max(100),
});

// PayoutSettings bonuses are keyed by `name` (src/types/index.ts:755).
export const payoutBonusSchema = z.object({
  name: z.string().optional(),
  percentage: z.number().min(0).max(100),
});

// places + bonuses must not distribute more than 100% of the pot.
export const payoutsSchema = z
  .object({
    places: z.array(payoutPlaceSchema).default([]),
    bonuses: z.array(payoutBonusSchema).default([]),
  })
  .refine(
    (p) => {
      const total = [...p.places, ...p.bonuses].reduce(
        (sum, x) => sum + (x.percentage || 0),
        0,
      );
      return total <= 100 + 1e-9;
    },
    { message: 'Payout percentages exceed 100%.' },
  );

export const basicsSchema = z.object({
  name: z.string().trim().min(1, 'Pool name is required.'),
  managerName: optionalText,
  contactEmail: optionalEmail,
  isPublic: z.boolean().optional(),
});

// Contact + payment fields shared by every pool type's create payload. Legacy
// top-level venmo/zelle/cashapp/paypal are accepted alongside nested
// paymentHandles; the payment-handle adapter reconciles them on write.
export const contactFieldsSchema = z.object({
  managerName: optionalText,
  contactEmail: optionalEmail,
  contactPhone: optionalText,
  paymentInstructions: z.string().optional(),
  paymentHandles: paymentHandlesSchema.optional(),
  venmo: optionalText,
  zelle: optionalText,
  cashapp: optionalText,
  paypal: optionalText,
});

export const brandingSchema = z
  .object({
    logoUrl: z.string().optional(),
    logo: z.string().optional(),
    bgColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
  })
  .partial();
