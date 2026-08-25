import { describe, it, expect, vi, beforeEach } from 'vitest';

// handleError reads `window.location.href` for the report's url field. Stubbed
// rather than pulling in the jsdom environment: this suite exercises pure
// service logic and has no DOM to speak of.
vi.stubGlobal('window', { location: { href: 'https://mmp.app/pool/p1?email=kevin@example.com' } });

/**
 * The two sinks in `handleError` are INDEPENDENT, and this file exists because
 * they were not.
 *
 * `captureSentryException` awaits a dynamic `import('@sentry/react')`. When that
 * chunk is blocked (an ad/tracker blocker, a CDN failure, an offline tab) the
 * promise REJECTS — and the original code awaited it un-guarded, so the
 * rejection propagated out of `handleError` and the `logClientError` call below
 * it never ran. Every error report would have been lost precisely when Sentry
 * was unavailable, which is the case the Firestore sink exists to cover. Found
 * by codex round 1 (P1) on the global-error-handler change, which made the
 * failure reachable from any unhandled rejection.
 *
 * Also covers the 21d requirement that nothing recognisable as PII leaves the
 * browser on this path.
 */

const captureSentryException = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../sentry', () => ({ captureSentryException }));

// The payload parameter is declared even though the mock ignores it: `tsc -b`
// compiles everything under src/, and a zero-arg mock makes `mock.calls[0][0]`
// a TS2493 error — which fails the Docker build's `RUN npx tsc -b` layer, not
// just the test (codex round 3).
const callable = vi.hoisted(() => vi.fn(async (_payload?: unknown) => ({ data: { ok: true } })));
vi.mock('firebase/functions', () => ({ httpsCallable: () => callable }));
vi.mock('../firebase', () => ({ functions: {} }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

describe('errorHandler.handleError', () => {
    beforeEach(() => {
        captureSentryException.mockReset();
        captureSentryException.mockResolvedValue(undefined);
        callable.mockClear();
    });

    it('still reaches the logClientError sink when Sentry capture REJECTS', async () => {
        captureSentryException.mockRejectedValueOnce(new Error('chunk load failed'));
        const { errorHandler } = await import('./errorHandler');
        await errorHandler.handleError(new Error('boom'), { notify: false });
        expect(callable).toHaveBeenCalledTimes(1);
    });

    it('does not reject when both sinks fail — logging must not cascade', async () => {
        captureSentryException.mockRejectedValueOnce(new Error('chunk load failed'));
        callable.mockRejectedValueOnce(new Error('callable unavailable'));
        const { errorHandler } = await import('./errorHandler');
        await expect(errorHandler.handleError(new Error('boom'), { notify: false })).resolves.toBeUndefined();
    });

    it('redacts PII before the payload leaves the browser', async () => {
        const { errorHandler } = await import('./errorHandler');
        const err = new Error('checkout failed for kevin@example.com');
        err.stack = 'at f (https://mmp.app/api?token=abcdef123456:1:2)';
        await errorHandler.handleError(err, {
            notify: false,
            context: { user: { email: 'kevin@example.com' } },
        });
        const payload = JSON.stringify(callable.mock.calls[0][0]);
        expect(payload).not.toContain('kevin@example.com');
        expect(payload).not.toContain('abcdef123456');
    });
});
