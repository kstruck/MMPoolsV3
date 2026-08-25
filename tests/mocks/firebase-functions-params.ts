import { vi } from 'vitest';

export const defineString = vi.fn((name: string) => ({
    value: () => name === 'STRIPE_SECRET_KEY' ? 'mock-stripe-secret-key' : 'mock-webhook-secret'
}));

// PLAN-STRIPE-FAIL-CLOSED.md: `classifyStripeKey` now rejects anything that is
// not a Stripe secret/restricted key shape (`sk_`/`rk_`), so a deployed
// environment with a junk key refuses the purchase instead of granting paid
// state for free. The old literal 'mock-secret-value' was junk by that rule, so
// the STRIPE_SECRET_KEY fake has to LOOK like a key — otherwise the suite's
// happy-path checkout tests exercise the refusal instead of the live path.
// Other secrets keep the generic value; nothing asserts on it.
export const defineSecret = vi.fn((name: string) => ({
    value: () => (name === 'STRIPE_SECRET_KEY' ? 'sk_test_mock_secret_value' : 'mock-secret-value')
}));

export default {
    defineString,
    defineSecret
};
