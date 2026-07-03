// Reusable CreatePoolInput building blocks. These validate wizard form input
// (not stored docs). Kept framework-free so both src/ (RHF zodResolver) and
// functions/ (createPool) validate against the exact same source.
//
// Schemas are used as GATES: the callable calls .parse() to throw on invalid
// input, then persists the original (privilege-stripped) payload. Unknown keys
// are therefore intentionally ignored, not an error — they are legitimate
// per-type wizard config the gate doesn't need to enumerate.
import { z } from 'zod';

// Mirrors shared/paymentHandles.ts PaymentHandles. Blank strings are a form
// artifact, so require min-length when present; the adapter drops blanks anyway.
export const paymentHandlesSchema = z
  .object({
    venmo: z.string().trim().min(1).optional(),
    zelle: z.string().trim().min(1).optional(),
    cashapp: z.string().trim().min(1).optional(),
    paypal: z.string().trim().min(1).optional(),
    googlePay: z.string().trim().min(1).optional(),
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
  managerName: z.string().trim().min(1).optional(),
  contactEmail: z.string().trim().email().optional(),
  isPublic: z.boolean().optional(),
});

// Contact + payment fields shared by every pool type's create payload. Legacy
// top-level venmo/zelle/cashapp/paypal are accepted alongside nested
// paymentHandles; the payment-handle adapter reconciles them on write.
export const contactFieldsSchema = z.object({
  managerName: z.string().trim().min(1).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().min(1).optional(),
  paymentInstructions: z.string().optional(),
  paymentHandles: paymentHandlesSchema.optional(),
  venmo: z.string().trim().min(1).optional(),
  zelle: z.string().trim().min(1).optional(),
  cashapp: z.string().trim().min(1).optional(),
  paypal: z.string().trim().min(1).optional(),
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
