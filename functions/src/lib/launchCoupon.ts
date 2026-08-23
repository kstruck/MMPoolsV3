// Remembering the wizard's coupon at launch (PLAN-WIZARD-BUYFLOW-FIXES T3, D3).
//
// The wizard's coupon lived only in LaunchStep's local state: "Start trial"
// sent it nowhere, and the upgrade page then read `billing.couponCode` — a
// field no code path wrote. So a commissioner who typed a promo code in the
// wizard, started the trial, and came back to pay was quoted full price with
// no code in the box.
//
// This stamps a REMEMBERED INTENT, not a redemption. Nothing is reserved and no
// usage counter moves: redemption stays in `createCheckoutSession`, where it is
// already atomic with activation. A code stored here is re-validated by the
// upgrade page's own `getPoolQuote` call, so one that expires in between prices
// at full and shows the server's reason — it can never let a pool activate for
// less than the server agrees to.
//
// Kept free of firebase imports on purpose: the caller passes a resolver bound
// to its own `db`, so this is unit-testable without standing up billing.ts.

/** Max stored code length. Coupon codes are short; the cap bounds what a
 *  permissive create envelope can push into a pool document. */
const MAX_CODE_LENGTH = 64;

/**
 * Normalizes a client-supplied coupon code, or undefined when there isn't a
 * usable one. Uppercased and trimmed to match how `coupons.code` is stored and
 * how `resolveCouponForQuote` looks it up.
 */
export function readLaunchCouponCode(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    const code = raw.trim().toUpperCase();
    if (!code || code.length > MAX_CODE_LENGTH) return undefined;
    // Codes are alphanumeric with dashes/underscores. Anything else is not a
    // coupon and has no business being persisted from a permissive envelope.
    if (!/^[A-Z0-9_-]+$/.test(code)) return undefined;
    return code;
}

/** The `resolveCouponForQuote` shape, narrowed to what this needs. */
export type LaunchCouponResolver = (
    code: string,
) => Promise<{ state: { code: string; valid: boolean } } | undefined>;

/**
 * Resolves the code to stamp on `billing.couponCode`, or undefined.
 *
 * ⚠️ Failure here must NEVER fail the pool creation. The coupon is a
 * convenience; the pool is the product. A coupons-collection read that throws
 * (rules, quota, a cold index) would otherwise turn "I typed a promo code" into
 * "your pool could not be created", which is the worst possible trade.
 */
export async function validLaunchCouponCode(
    resolve: LaunchCouponResolver,
    rawCode: unknown,
    logger: { warn: (...args: unknown[]) => void } = console,
): Promise<string | undefined> {
    const code = readLaunchCouponCode(rawCode);
    if (!code) return undefined;
    try {
        const resolved = await resolve(code);
        return resolved?.state.valid ? resolved.state.code : undefined;
    } catch (e) {
        logger.warn("[launchCoupon] could not validate coupon at launch; not stamping", code, e);
        return undefined;
    }
}
