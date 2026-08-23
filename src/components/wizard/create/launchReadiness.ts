/**
 * The two "you are about to launch something that will not work" checks the
 * Review & launch step makes (PLAN-WIZARD-BUYFLOW-FIXES T6b: G7 and G14).
 *
 * Pure so both can be asserted directly. Neither is a schema change: the create
 * schemas are shared by seven wizards and validated server-side too, and
 * widening them for a UX gate would be a much larger blast radius than the
 * problem deserves.
 */

/** Handle fields the fee step collects, in the shape the form holds them. */
export interface PaymentHandlesValues {
    venmo?: unknown;
    zelle?: unknown;
    cashapp?: unknown;
    paypal?: unknown;
    googlePay?: unknown;
}

const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

/**
 * G7 — is the player estimate actually set?
 *
 * It defaulted to 0 and was never required, so an untouched field silently
 * routed a 40-person pool onto the free plan and the wall was discovered by the
 * 11th member — mid-season, by someone who is not the commissioner. 0 is not a
 * pool size; it is "nobody answered".
 */
export function estimateIsSet(estimatedPlayers: unknown): boolean {
    const n = Number(estimatedPlayers);
    // INTEGER, not merely >= 1 (codex r2). `poolQuoteInputSchema` is
    // `.int()`, so a fractional estimate makes every quote fail — and the
    // failure surfaces as "Could not load pricing right now", which names
    // nothing the commissioner can act on. Refusing it here points at the
    // field instead.
    return Number.isInteger(n) && n >= 1;
}

/**
 * G14 — a pool charging an entry fee with no way to pay it.
 *
 * `StepFeeAndPayment` shows five handle fields and an instructions box when the
 * fee is above zero, and validates none of them. A pool can therefore launch
 * showing "Entry Fee $25" to every invitee with no handle and no instructions
 * anywhere — money owed to a commissioner nobody can reach.
 *
 * WARNS, never blocks: collecting cash in person is a legitimate answer, and a
 * commissioner who has one is not helped by being stopped. Returns null when
 * there is nothing to say.
 */
export function feeWithoutPaymentPathWarning(args: {
    fee: unknown;
    handles: PaymentHandlesValues | null | undefined;
    instructions: unknown;
}): string | null {
    const fee = Number(args.fee);
    if (!Number.isFinite(fee) || fee <= 0) return null;

    const h = args.handles ?? {};
    const anyHandle = hasText(h.venmo) || hasText(h.zelle) || hasText(h.cashapp) || hasText(h.paypal) || hasText(h.googlePay);
    if (anyHandle || hasText(args.instructions)) return null;

    return 'This pool charges an entry fee but lists no payment handle and no instructions, so members will see the amount with no way to pay it. Add one on the Fee & payment step — or launch anyway if you are collecting in person.';
}
