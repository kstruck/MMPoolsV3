import type * as SentryReact from '@sentry/react';

/**
 * Replay is masked by default (maskAllText + blockAllMedia) regardless of
 * sample rate — PLAN-SECURITY-OBSERVABILITY.md #8: the app renders Payment
 * Handles, emails, and admin data, so masking must be proven before any
 * non-dev sampling, not toggled on after.
 * // ponytail: replay sample rates stay 0 outside DEV until Kevin opts in
 * (Coolify VITE_SENTRY_REPLAY_SAMPLE_RATE), a one-flag flip once masking is
 * verified in dev — no code change needed to turn it on.
 *
 * @sentry/react is dynamically imported (not a static top-of-file import) so
 * its ~40kb chunk doesn't sit in the initial bundle/load path — the compliance
 * rule this repo enforces for analytics/logging/error-tracking libraries.
 * initSentry() and captureSentryException() share ONE cached import() promise,
 * so the chunk only ever downloads once regardless of call order.
 */

let sentryModulePromise: Promise<typeof SentryReact> | null = null;

function loadSentry(): Promise<typeof SentryReact> | null {
    if (!import.meta.env.VITE_SENTRY_DSN) return null;
    if (!sentryModulePromise) {
        sentryModulePromise = import('@sentry/react');
    }
    return sentryModulePromise;
}

/** Clamps an env-supplied sample rate to a valid [0,1] finite number, falling
 *  back to the intended default on anything malformed (NaN, out of range,
 *  unset) rather than passing garbage straight into Sentry.init(). */
function parseSampleRate(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
    return n;
}

export async function initSentry(): Promise<void> {
    const modPromise = loadSentry();
    if (!modPromise) return;
    const Sentry = await modPromise;

    const isDev = import.meta.env.DEV;
    const replaySessionSampleRate = parseSampleRate(
        import.meta.env.VITE_SENTRY_REPLAY_SAMPLE_RATE,
        isDev ? 0.1 : 0,
    );

    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: isDev ? 'development' : 'production',
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],
        tracesSampleRate: isDev ? 1.0 : 0.2,
        replaysSessionSampleRate: replaySessionSampleRate,
        replaysOnErrorSampleRate: replaySessionSampleRate > 0 ? 1.0 : 0,
    });
}

/** Lazy captureException — safe to call whether or not initSentry() has run
 *  yet (awaits the same cached module load) and no-ops when VITE_SENTRY_DSN
 *  is unset, so callers never need to check config presence themselves. */
export async function captureSentryException(
    error: Error,
    options: { level: 'fatal' | 'error' | 'warning'; extra?: Record<string, unknown> },
): Promise<void> {
    const modPromise = loadSentry();
    if (!modPromise) return;
    const Sentry = await modPromise;
    Sentry.captureException(error, options);
}
