import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The SERVER side of error-tracking audit 21d.
 *
 * `tests/pii-redaction.test.ts` covers the shared redactor itself; this covers
 * the thing that actually matters operationally — that the callable which writes
 * `system_logs` runs it BEFORE the write, and before the size caps. The client
 * pass is defence in depth and cannot be relied on: `logClientError` is a public
 * callable with App Check currently OFF, so a hand-written payload reaches this
 * handler directly.
 */

type Handler = (req: { data: unknown; auth?: { uid: string } }) => Promise<{ ok: boolean }>;

// `vi.hoisted`, not plain module scope: vi.mock factories are hoisted above every
// declaration in the file, so a `let handler` / `const added` they close over is
// still in its temporal dead zone when they run.
const captured = vi.hoisted(() => ({
    handler: undefined as Handler | undefined,
    added: [] as Record<string, unknown>[],
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, h: Handler) => {
        captured.handler = h;
        return h;
    },
}));

vi.mock('firebase-functions/logger', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('firebase-admin', () => {
    const firestore: any = () => ({
        collection: (_name: string) => ({
            add: async (doc: Record<string, unknown>) => {
                captured.added.push(doc);
                return { id: 'fake' };
            },
        }),
    });
    firestore.FieldValue = { serverTimestamp: () => 'SERVER_TS' };
    return { default: { firestore }, firestore };
});

import '../logClientError';

const added = captured.added;

const call = async (data: unknown) => {
    if (!captured.handler) throw new Error('logClientError never registered a handler');
    return captured.handler({ data });
};

describe('logClientError redacts before persisting', () => {
    beforeEach(() => {
        added.length = 0;
    });

    it('strips an email and a token out of message/stack and the query off the url', async () => {
        await call({
            message: 'checkout failed for kevin@example.com',
            code: 'permission-denied',
            stack: 'at f (https://mmp.app/api?token=abcdef123456:1:2)',
            url: 'https://mmp.app/join?email=kevin@example.com#access_token=zzz',
            severity: 'high',
        });
        expect(added).toHaveLength(1);
        const dump = JSON.stringify(added[0]);
        expect(dump).not.toContain('kevin@example.com');
        expect(dump).not.toContain('abcdef123456');
        expect(added[0].url).toBe('https://mmp.app/join');
        // Still a usable error report.
        expect(added[0].code).toBe('permission-denied');
        expect(added[0].severity).toBe('high');
    });

    it('redacts the context by key AND by pattern', async () => {
        await call({
            message: 'boom',
            context: { user: { email: 'kevin@example.com' }, note: 'bounced to kevin@example.com' },
        });
        const context = added[0].context as string;
        expect(context).not.toContain('kevin@example.com');
        expect(context).toContain('[redacted]');
    });

    it('redacts BEFORE the size cap — a truncated secret is still a secret', async () => {
        // A message long enough that the 2000-char cap bites. Both passes must
        // apply — an implementation that capped and returned early, or that only
        // redacted short strings, leaves the address in the stored prefix.
        const message = `contact kevin@example.com ${'x'.repeat(3000)}`;
        await call({ message });
        const stored = added[0].message as string;
        expect(stored).not.toContain('kevin@example.com');
        expect(stored.length).toBeLessThanOrEqual(2000);
    });

    it('still server-stamps and whitelists the schema', async () => {
        await call({ message: 'boom', evil: 'not-in-schema', uid: 'spoofed', source: 'server' });
        expect(added[0].evil).toBeUndefined();
        expect(added[0].source).toBe('client');
        expect(added[0].uid).toBeNull();
    });

    it('never throws back to the caller on a malformed payload', async () => {
        await expect(call(null)).resolves.toEqual({ ok: true });
    });
});
