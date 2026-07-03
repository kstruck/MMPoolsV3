// Reusable CreatePoolInput building blocks. These validate wizard form input
// (not stored docs). Kept framework-free so both src/ (RHF zodResolver) and
// functions/ (createPool) validate against the exact same source.
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

export const payoutBonusSchema = z.object({
  label: z.string().optional(),
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
