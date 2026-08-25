import { describe, it, expect } from 'vitest';
import {
    redactFreeText,
    stripUrlParams,
    redactDeep,
    redactClientErrorReport,
} from '@shared/piiRedaction';

/**
 * Error-tracking audit 21d. `system_logs` is readable by every admin and its
 * rows come from the browser, so anything a user typed, was sent, or had in
 * their address bar can land there. The schema whitelist in
 * `functions/src/logClientError.ts` bounds WHICH fields are stored; these tests
 * cover what is INSIDE them.
 *
 * The cases below are the ones a key-based redactor alone gets wrong: an email
 * inside `message`, a token inside `stack`, a `?token=` inside `url` — all under
 * key names that look completely benign.
 */

describe('stripUrlParams', () => {
    it('drops the query string', () => {
        expect(stripUrlParams('https://mmp.app/join?email=kevin@example.com&token=abc123'))
            .toBe('https://mmp.app/join');
    });

    it('drops the fragment', () => {
        expect(stripUrlParams('https://mmp.app/pool/p1#access_token=xyz')).toBe('https://mmp.app/pool/p1');
    });

    it('drops from whichever comes first', () => {
        expect(stripUrlParams('https://mmp.app/p#frag?q=1')).toBe('https://mmp.app/p');
    });

    it('leaves a clean URL and the diagnostic path alone', () => {
        expect(stripUrlParams('https://mmp.app/pool/abc123/picks')).toBe('https://mmp.app/pool/abc123/picks');
    });
});

describe('redactFreeText — the patterns a key-based redactor cannot see', () => {
    it('redacts an email in a message', () => {
        const out = redactFreeText('Checkout failed for kevin@example.com after retry');
        expect(out).not.toContain('kevin@example.com');
        expect(out).toContain('[redacted-email]');
    });

    it('redacts a JWT', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.QWxhZGRpbjpvcGVuc2VzYW1l';
        expect(redactFreeText(`auth failed with ${jwt}`)).not.toContain(jwt);
    });

    it('redacts a bare Bearer credential but keeps the scheme', () => {
        const out = redactFreeText('request sent with Bearer sk_live_abcdef1234567890');
        expect(out).not.toContain('sk_live_abcdef1234567890');
        expect(out).toContain('Bearer');
    });

    it('redacts an Authorization header value', () => {
        // Both the Bearer pattern and the credential-pair pattern fire here, so
        // the scheme word is swallowed too. Over-redaction is the safe direction:
        // the header name survives, which is all a reader needs.
        const out = redactFreeText('Authorization: Bearer sk_live_abcdef1234567890');
        expect(out).not.toContain('sk_live_abcdef1234567890');
        expect(out).toContain('Authorization');
    });

    it('redacts token=/password= pairs', () => {
        const out = redactFreeText('retry with token=abc123def456 password=hunter2000');
        expect(out).not.toContain('abc123def456');
        expect(out).not.toContain('hunter2000');
    });

    it('strips query strings off URLs embedded in a stack frame', () => {
        const stack = 'at fetch (https://mmp.app/api/join?email=a@b.com&token=zzz:12:5)';
        const out = redactFreeText(stack);
        expect(out).not.toContain('a@b.com');
        expect(out).not.toContain('token=zzz');
    });

    it('redacts a Google/Firebase API key', () => {
        const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuvw';
        expect(redactFreeText(`bad request ${key}`)).not.toContain(key);
    });

    it('redacts a long opaque hex blob', () => {
        const hex = 'a'.repeat(40);
        expect(redactFreeText(`session ${hex} expired`)).not.toContain(hex);
    });

    it('KEEPS ordinary diagnostics — a redactor that eats the error code gets turned off', () => {
        const out = redactFreeText('FirebaseError: code: permission-denied on pools/abc123');
        expect(out).toContain('permission-denied');
        expect(out).toContain('pools/abc123');
    });

    it('is a no-op on an empty string', () => {
        expect(redactFreeText('')).toBe('');
    });
});

describe('redactDeep — key-based AND pattern-based, not either', () => {
    it('redacts by key name at depth', () => {
        const out = redactDeep({ operation: 'saveUser', user: { name: 'Kevin', email: 'k@e.com' } }) as any;
        expect(out.user.email).toBe('[redacted]');
        expect(out.user.name).toBe('Kevin');
        expect(out.operation).toBe('saveUser');
    });

    it('redacts an email hiding under a NON-sensitive key', () => {
        const out = redactDeep({ note: 'invite bounced for kevin@example.com' }) as any;
        expect(out.note).not.toContain('kevin@example.com');
    });

    it('bounds depth, string length and array size', () => {
        const deep = { a: { b: { c: { d: { e: 'too deep' } } } } };
        expect(JSON.stringify(redactDeep(deep))).toContain('max depth');
        const long = redactDeep({ s: 'x'.repeat(5000) }) as any;
        expect(long.s.length).toBeLessThan(600);
        const arr = redactDeep({ list: [1, 2, 3, 4, 5, 6, 7, 8, 9] }) as any;
        expect(arr.list).toHaveLength(5);
    });
});

describe('redactClientErrorReport — the whole payload', () => {
    it('cleans message, stack, url and context together', () => {
        const out = redactClientErrorReport({
            message: 'failed for kevin@example.com',
            code: 'permission-denied',
            stack: 'at x (https://mmp.app/j?token=abc123def:1:1)',
            url: 'https://mmp.app/join?email=kevin@example.com',
            context: { user: { email: 'kevin@example.com' }, note: 'sent to kevin@example.com' },
            severity: 'high',
        });
        const dump = JSON.stringify(out);
        expect(dump).not.toContain('kevin@example.com');
        expect(dump).not.toContain('abc123def');
        expect(out.url).toBe('https://mmp.app/join');
        // Diagnostics survive — the report has to stay worth reading.
        expect(out.code).toBe('permission-denied');
        expect(out.severity).toBe('high');
    });

    it('omits absent fields rather than emitting undefined (Firestore rejects it)', () => {
        const out = redactClientErrorReport({ message: 'boom' });
        expect(Object.keys(out)).toEqual(['message']);
    });

    it('passes a non-string message through untouched rather than crashing', () => {
        const out = redactClientErrorReport({ message: 42 });
        expect(out.message).toBe(42);
    });
});
