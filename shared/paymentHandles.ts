// Payment-handle adapter — the ONE place that maps between the canonical
// nested `paymentHandles` shape and the legacy top-level fields
// (venmo/zelle/cashapp/paypal) scattered across pool docs and UserProfile.
//
// Reality this reconciles (verified in the repo):
//   - Squares pools + NFL pools store top-level venmo/zelle/cashapp/paypal
//   - Other configs + UserProfile store nested paymentHandles{...} (subsets)
//   - functions/src/types.ts already carries googlePay (nested-only; there is
//     no legacy top-level googlePay field anywhere)
//
// Canonical target: nested `paymentHandles`. Legacy top-level fields are
// dual-written on every mutate so old readers keep working during migration.

export interface PaymentHandles {
  venmo?: string;
  zelle?: string;
  cashapp?: string;
  paypal?: string;
  googlePay?: string;
}

// The four handles that also live as legacy top-level fields. googlePay is
// deliberately excluded — it never had a top-level field.
export const LEGACY_TOP_LEVEL_HANDLE_KEYS = [
  'venmo',
  'zelle',
  'cashapp',
  'paypal',
] as const;

export type LegacyHandleKey = (typeof LEGACY_TOP_LEVEL_HANDLE_KEYS)[number];

const ALL_HANDLE_KEYS: readonly (keyof PaymentHandles)[] = [
  'venmo',
  'zelle',
  'cashapp',
  'paypal',
  'googlePay',
];

type HandleSource = Partial<PaymentHandles> & {
  paymentHandles?: Partial<PaymentHandles> | null;
};

function cleanHandle(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read the effective payment handles off any pool/profile-shaped object.
 * Nested `paymentHandles` wins per-field; legacy top-level fields fill gaps.
 * Omits empty/blank values so callers never surface an empty handle.
 */
export function readPaymentHandles(
  source: HandleSource | null | undefined,
): PaymentHandles {
  const nested = source?.paymentHandles ?? {};
  const out: PaymentHandles = {};
  for (const key of ALL_HANDLE_KEYS) {
    const nestedVal = cleanHandle((nested as Record<string, unknown>)[key]);
    const legacyVal =
      key === 'googlePay'
        ? undefined
        : cleanHandle((source as Record<string, unknown>)[key]);
    const val = nestedVal ?? legacyVal;
    if (val !== undefined) out[key] = val;
  }
  return out;
}

// A patch value that either sets a string or explicitly clears the field.
// Callers on the server map `null` to admin.firestore.FieldValue.delete();
// client callers map it to field removal. Keeping the adapter framework-free
// (no firebase-admin import) is what lets both src/ and functions/ share it.
export const CLEAR = null;
export type HandlePatchValue = string | typeof CLEAR;

export interface PaymentHandlePatch {
  paymentHandles: PaymentHandles;
  venmo: HandlePatchValue;
  zelle: HandlePatchValue;
  cashapp: HandlePatchValue;
  paypal: HandlePatchValue;
}

/**
 * Build the doc patch for a mutate: canonical nested object plus dual-written
 * legacy top-level fields. A handle that is absent/blank yields CLEAR (null)
 * for its legacy field so stale top-level values don't drift out of sync.
 */
export function writePaymentHandles(
  handles: PaymentHandles | null | undefined,
): PaymentHandlePatch {
  const clean = readPaymentHandles({ paymentHandles: handles ?? {} });
  return {
    paymentHandles: clean,
    venmo: clean.venmo ?? CLEAR,
    zelle: clean.zelle ?? CLEAR,
    cashapp: clean.cashapp ?? CLEAR,
    paypal: clean.paypal ?? CLEAR,
  };
}
