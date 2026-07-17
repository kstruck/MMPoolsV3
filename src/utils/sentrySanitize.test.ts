import { describe, it, expect } from 'vitest';
import { sanitizeForSentry } from './sentrySanitize';

describe('sanitizeForSentry', () => {
    it('redacts a top-level sensitive key', () => {
        const out = sanitizeForSentry({ operation: 'addToWaitlist', poolId: 'p1', email: 'kevin@example.com' });
        expect(out.email).toBe('[redacted]');
        expect(out.operation).toBe('addToWaitlist');
        expect(out.poolId).toBe('p1');
    });

    it('redacts a sensitive key nested inside another object (e.g. context.user.email)', () => {
        const out = sanitizeForSentry({
            operation: 'saveUser',
            user: { id: 'u1', displayName: 'Kevin', email: 'kevin@example.com', phone: '555-1234' },
        });
        const user = out.user as Record<string, unknown>;
        expect(user.email).toBe('[redacted]');
        expect(user.phone).toBe('[redacted]');
        expect(user.id).toBe('u1');
        expect(user.displayName).toBe('Kevin');
    });

    it('redacts payment/token/secret-shaped keys at any depth', () => {
        const out = sanitizeForSentry({
            data: { paymentMethod: 'card_123', authToken: 'secret-abc', note: 'fine to keep' },
        });
        const data = out.data as Record<string, unknown>;
        expect(data.paymentMethod).toBe('[redacted]');
        expect(data.authToken).toBe('[redacted]');
        expect(data.note).toBe('fine to keep');
    });

    it('truncates long strings and caps array length', () => {
        const longString = 'x'.repeat(500);
        const out = sanitizeForSentry({ note: longString, list: [1, 2, 3, 4, 5, 6, 7, 8] });
        expect((out.note as string).length).toBeLessThan(longString.length);
        expect((out.list as unknown[]).length).toBeLessThanOrEqual(5);
    });

    it('caps overall depth rather than recursing forever', () => {
        const deep = { a: { b: { c: { d: { e: { secret: 'nope' } } } } } };
        const out = sanitizeForSentry(deep);
        expect(() => JSON.stringify(out)).not.toThrow();
    });

    it('falls back to a size-only note when the sanitized result is still too large', () => {
        const huge: Record<string, string> = {};
        for (let i = 0; i < 50; i++) huge[`field${i}`] = 'y'.repeat(200);
        const out = sanitizeForSentry(huge);
        expect(out.note).toBe('[context too large — omitted]');
        expect(typeof out.originalSize).toBe('number');
    });

    it('passes through an empty context untouched', () => {
        expect(sanitizeForSentry({})).toEqual({});
    });
});
