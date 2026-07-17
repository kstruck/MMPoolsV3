import { describe, it, expect, vi, beforeEach } from 'vitest';

const init = vi.fn();
const captureException = vi.fn();
const browserTracingIntegration = vi.fn(() => 'browserTracing');
const replayIntegration = vi.fn((opts: unknown) => ({ replay: opts }));
vi.mock('@sentry/react', () => ({ init, captureException, browserTracingIntegration, replayIntegration }));

describe('sentry.ts', () => {
    beforeEach(() => {
        vi.resetModules();
        init.mockClear();
        captureException.mockClear();
        vi.unstubAllEnvs();
    });

    it('initSentry() no-ops without VITE_SENTRY_DSN', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', '');
        const { initSentry } = await import('./sentry');
        await initSentry();
        expect(init).not.toHaveBeenCalled();
    });

    it('initSentry() initializes with masked Replay when a DSN is present', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
        const { initSentry } = await import('./sentry');
        await initSentry();
        expect(init).toHaveBeenCalledTimes(1);
        expect(replayIntegration).toHaveBeenCalledWith(
            expect.objectContaining({ maskAllText: true, blockAllMedia: true })
        );
    });

    it('clamps an out-of-range VITE_SENTRY_REPLAY_SAMPLE_RATE to the dev/prod default instead of passing it through', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
        vi.stubEnv('VITE_SENTRY_REPLAY_SAMPLE_RATE', '5'); // out of [0,1]
        const { initSentry } = await import('./sentry');
        await initSentry();
        const call = init.mock.calls[0][0];
        // DEV default fallback is 0.1 in this test environment (Vite sets DEV=true under vitest).
        expect(call.replaysSessionSampleRate).toBeGreaterThanOrEqual(0);
        expect(call.replaysSessionSampleRate).toBeLessThanOrEqual(1);
        expect(call.replaysSessionSampleRate).not.toBe(5);
    });

    it('clamps a NaN VITE_SENTRY_REPLAY_SAMPLE_RATE the same way', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
        vi.stubEnv('VITE_SENTRY_REPLAY_SAMPLE_RATE', 'not-a-number');
        const { initSentry } = await import('./sentry');
        await initSentry();
        const call = init.mock.calls[0][0];
        expect(Number.isFinite(call.replaysSessionSampleRate)).toBe(true);
    });

    it('captureSentryException() no-ops without a DSN', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', '');
        const { captureSentryException } = await import('./sentry');
        await captureSentryException(new Error('boom'), { level: 'error' });
        expect(captureException).not.toHaveBeenCalled();
    });

    it('captureSentryException() forwards to Sentry when a DSN is present', async () => {
        vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
        const { captureSentryException } = await import('./sentry');
        const err = new Error('boom');
        await captureSentryException(err, { level: 'fatal', extra: { poolId: 'p1' } });
        expect(captureException).toHaveBeenCalledWith(err, { level: 'fatal', extra: { poolId: 'p1' } });
    });
});
