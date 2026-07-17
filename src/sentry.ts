import * as Sentry from '@sentry/react';

/**
 * Replay is masked by default (maskAllText + blockAllMedia) regardless of
 * sample rate — PLAN-SECURITY-OBSERVABILITY.md #8: the app renders Payment
 * Handles, emails, and admin data, so masking must be proven before any
 * non-dev sampling, not toggled on after.
 * // ponytail: replay sample rates stay 0 outside DEV until Kevin opts in
 * (Coolify VITE_SENTRY_REPLAY_SAMPLE_RATE), a one-flag flip once masking is
 * verified in dev — no code change needed to turn it on.
 */
export function initSentry(): void {
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) return;

    const isDev = import.meta.env.DEV;
    const replaySessionSampleRate = isDev
        ? Number(import.meta.env.VITE_SENTRY_REPLAY_SAMPLE_RATE ?? 0.1)
        : Number(import.meta.env.VITE_SENTRY_REPLAY_SAMPLE_RATE ?? 0);

    Sentry.init({
        dsn,
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

export { Sentry };
