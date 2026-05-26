import { vi } from 'vitest';

export const defineString = vi.fn((name: string) => ({
    value: () => name === 'STRIPE_SECRET_KEY' ? 'mock-stripe-secret-key' : 'mock-webhook-secret'
}));

export const defineSecret = vi.fn((name: string) => ({
    value: () => 'mock-secret-value'
}));

export default {
    defineString,
    defineSecret
};
