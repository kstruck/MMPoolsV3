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

/**
 * Global (non-render) error handlers — error-tracking audit 21b.
 *
 * The two properties under test are the two constraints that shaped the design,
 * and a simpler implementation fails both:
 *
 *  - it must NOT report when Sentry is live, or every such error is filed twice
 *    (Sentry's GlobalHandlers integration already captures both events);
 *  - it must rate-limit itself, because the sink is a callable that writes a
 *    Firestore document and `handleError` has no dedupe of its own. One
 *    rejection inside a poller would otherwise bill an unbounded stream of
 *    writes from a single tab.
 */
describe('createErrorReportGate', () => {
    it('reports the first occurrence of a signature', async () => {
        const { createErrorReportGate } = await import('./sentry');
        const gate = createErrorReportGate();
        expect(gate.shouldReport('sig', 0)).toBe(true);
    });

    it('suppresses a repeat of the same signature inside the dedupe TTL', async () => {
        const { createErrorReportGate } = await import('./sentry');
        const gate = createErrorReportGate({ dedupeTtlMs: 1000 });
        expect(gate.shouldReport('sig', 0)).toBe(true);
        expect(gate.shouldReport('sig', 500)).toBe(false);
        expect(gate.shouldReport('sig', 999)).toBe(false);
    });

    it('lets the same signature through again once the TTL expires — a persistent bug stays visible', async () => {
        const { createErrorReportGate } = await import('./sentry');
        const gate = createErrorReportGate({ dedupeTtlMs: 1000 });
        expect(gate.shouldReport('sig', 0)).toBe(true);
        expect(gate.shouldReport('sig', 1000)).toBe(true);
    });

    it('caps the total per window, which the per-signature TTL alone cannot', async () => {
        const { createErrorReportGate } = await import('./sentry');
        // Every signature is unique here, so the dedupe check never fires: this is
        // exactly the loop shape that would sail through a dedupe-only guard.
        const gate = createErrorReportGate({ maxPerWindow: 3, windowMs: 1000 });
        expect(gate.shouldReport('a', 0)).toBe(true);
        expect(gate.shouldReport('b', 1)).toBe(true);
        expect(gate.shouldReport('c', 2)).toBe(true);
        expect(gate.shouldReport('d', 3)).toBe(false);
        expect(gate.shouldReport('e', 4)).toBe(false);
        // …and recovers once the window rolls.
        expect(gate.shouldReport('f', 1001)).toBe(true);
    });

    it('counts what it dropped and reports it once, not forever', async () => {
        const { createErrorReportGate } = await import('./sentry');
        const gate = createErrorReportGate({ dedupeTtlMs: 1000 });
        gate.shouldReport('sig', 0);
        gate.shouldReport('sig', 1);
        gate.shouldReport('sig', 2);
        expect(gate.drainSuppressed()).toBe(2);
        expect(gate.drainSuppressed()).toBe(0);
    });

    it('bounds its memory under a flood of unique signatures', async () => {
        const { createErrorReportGate } = await import('./sentry');
        const gate = createErrorReportGate({ maxPerWindow: 10000, maxTrackedSignatures: 10 });
        for (let i = 0; i < 500; i++) gate.shouldReport('sig-' + i, i);
        // An evicted early entry must be reportable again — the guarantee is
        // bounded memory, not perfect recall.
        expect(gate.shouldReport('sig-0', 500)).toBe(true);
    });
});

describe('installGlobalErrorHandlers', () => {
    /** Minimal EventTarget stand-in with the Window-ish signature. */
    function fakeTarget() {
        const listeners: Record<string, ((e: unknown) => void)[]> = {};
        return {
            addEventListener: (type: string, fn: unknown) => {
                (listeners[type] ??= []).push(fn as (e: unknown) => void);
            },
            removeEventListener: (type: string, fn: unknown) => {
                listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
            },
            fire: (type: string, event: unknown) => (listeners[type] ?? []).forEach((f) => f(event)),
            count: (type: string) => (listeners[type] ?? []).length,
        };
    }

    it('registers both error and unhandledrejection, and uninstalls cleanly', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        const uninstall = installGlobalErrorHandlers(vi.fn(), { target: target as never, sentryActive: () => false });
        expect(target.count('error')).toBe(1);
        expect(target.count('unhandledrejection')).toBe(1);
        uninstall();
        expect(target.count('error')).toBe(0);
        expect(target.count('unhandledrejection')).toBe(0);
    });

    it('reports a window error to the sink', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        const report = vi.fn();
        installGlobalErrorHandlers(report, { target: target as never, sentryActive: () => false });
        const err = new Error('kaboom');
        target.fire('error', { error: err, message: 'kaboom', filename: 'a.js', lineno: 1, colno: 2 });
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toBe(err);
        expect(report.mock.calls[0][1]).toMatchObject({ kind: 'window.error', filename: 'a.js' });
    });

    it('wraps a non-Error rejection reason so the sink always gets an Error', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        const report = vi.fn();
        installGlobalErrorHandlers(report, { target: target as never, sentryActive: () => false });
        target.fire('unhandledrejection', { reason: 'plain string' });
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(report.mock.calls[0][1]).toMatchObject({ kind: 'unhandledrejection' });
    });

    it('DOES NOT report while Sentry is active — no double-reporting', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        const report = vi.fn();
        installGlobalErrorHandlers(report, { target: target as never, sentryActive: () => true });
        target.fire('error', { error: new Error('x'), message: 'x' });
        target.fire('unhandledrejection', { reason: new Error('y') });
        expect(report).not.toHaveBeenCalled();
    });

    it('checks Sentry at EVENT time, so the dynamic-import window is still covered', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        const report = vi.fn();
        let active = false;
        installGlobalErrorHandlers(report, { target: target as never, sentryActive: () => active });
        target.fire('error', { error: new Error('before init'), message: 'before init' });
        active = true;
        target.fire('error', { error: new Error('after init'), message: 'after init' });
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('rate-limits a repeating rejection instead of writing one doc per occurrence', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        const report = vi.fn();
        let clock = 0;
        installGlobalErrorHandlers(report, {
            target: target as never,
            sentryActive: () => false,
            now: () => clock,
        });
        const reason = new Error('poller blew up');
        for (let i = 0; i < 200; i++) {
            clock += 1000; // 200 occurrences over ~3 minutes
            target.fire('unhandledrejection', { reason });
        }
        expect(report).toHaveBeenCalledTimes(1);
        // The drop count rides along on the next one that gets through.
        clock += 10 * 60000;
        target.fire('unhandledrejection', { reason });
        expect(report).toHaveBeenCalledTimes(2);
        expect(report.mock.calls[1][1]).toMatchObject({ suppressedSinceLastReport: 199 });
    });

    it('never throws out of the handler, even when the sink does', async () => {
        const { installGlobalErrorHandlers } = await import('./sentry');
        const target = fakeTarget();
        installGlobalErrorHandlers(
            () => {
                throw new Error('sink exploded');
            },
            { target: target as never, sentryActive: () => false },
        );
        expect(() => target.fire('error', { error: new Error('x'), message: 'x' })).not.toThrow();
    });
});
