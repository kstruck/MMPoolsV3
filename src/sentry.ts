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

/**
 * True once Sentry.init() has actually run. NOT the same as "a DSN is set":
 * initSentry() dynamically imports a ~40kb chunk, so there is a real window
 * after page load where the DSN is configured and Sentry's GlobalHandlers
 * integration is NOT yet listening. `installGlobalErrorHandlers` below reads
 * this at EVENT time precisely to cover that window without double-reporting
 * once Sentry is up.
 */
let sentryActive = false;

export function isSentryActive(): boolean {
    return sentryActive;
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
    // Only AFTER init returns — see the comment on `sentryActive`. Setting it
    // when the DSN is merely present would blind the fallback handlers during
    // the dynamic-import window, which is the one stretch of the page's life
    // where they are the only reporter there is.
    sentryActive = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global (non-render) error handlers
//
// The <ErrorBoundary> only sees errors thrown during React rendering. An
// exception in an event handler, a timer, or an async callback — and every
// unhandled promise rejection — never reaches it, so before this existed those
// errors vanished with no record anywhere.
//
// TWO CONSTRAINTS SHAPE EVERYTHING BELOW, and both were rejections of a simpler
// first draft:
//
//  1. NO DOUBLE-REPORTING. When Sentry is live its GlobalHandlers integration
//     already captures `error` and `unhandledrejection` itself. So these
//     handlers feed ONLY the caller's sink (in practice logClientError →
//     system_logs) and stand down the moment Sentry is actually initialized.
//     The check is at EVENT time, not install time, so the pre-init window is
//     still covered — and covered exactly once, because Sentry's handlers were
//     not attached yet when the event fired.
//
//  2. THEY MUST RATE-LIMIT THEMSELVES. The sink is a Cloud Function that writes
//     a Firestore document. `handleError` has no dedupe of its own, so one
//     rejection inside a render loop or a polling timer would bill an unbounded
//     stream of callable invocations and document writes from a single tab.
//     That is a cost-control requirement, not a nicety — it is the reason this
//     is a gate and not a bare addEventListener.
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorReportGateOptions {
    /** Max reports allowed through per rolling window. */
    maxPerWindow?: number;
    /** Length of the rolling rate-limit window, ms. */
    windowMs?: number;
    /** A given signature reports at most once per this interval, ms. */
    dedupeTtlMs?: number;
    /** Hard cap on remembered signatures, so the map cannot grow without bound. */
    maxTrackedSignatures?: number;
}

export interface ErrorReportGate {
    /** May this error be reported now? Records the decision when it says yes. */
    shouldReport(signature: string, nowMs: number): boolean;
    /**
     * How many reports have been dropped since the last drain — read once per
     * allowed report and reset, so the number attached to a report means
     * "suppressed since the previous one" rather than a lifetime total that
     * re-states the same drops on every subsequent report.
     */
    drainSuppressed(): number;
}

const DEFAULT_GATE: Required<ErrorReportGateOptions> = {
    maxPerWindow: 5,
    windowMs: 60_000,
    dedupeTtlMs: 5 * 60_000,
    maxTrackedSignatures: 50,
};

/**
 * Dedupe + rate limit for global error reports. Pure w.r.t. the clock (`nowMs`
 * is passed in) so the thresholds are unit-tested rather than discovered on a
 * Firestore bill.
 *
 * Two independent limits, because they stop different things:
 *   - the per-signature TTL stops ONE repeating error (the common case: a
 *     rejection re-thrown by a 5-second poller);
 *   - the rolling window caps the total, which the TTL alone cannot, since a
 *     loop generating errors with VARYING messages produces a new signature
 *     every time and would sail through a per-signature check.
 *
 * A dropped report is counted, never silently forgotten: the count rides along
 * on the next report that does get through, so "we suppressed 900 of these"
 * stays visible.
 */
export function createErrorReportGate(options: ErrorReportGateOptions = {}): ErrorReportGate {
    const cfg = { ...DEFAULT_GATE, ...options };
    const lastReportedAt = new Map<string, number>();
    const allowedAt: number[] = [];
    let suppressed = 0;

    return {
        shouldReport(signature: string, nowMs: number): boolean {
            // Drop expired signatures first so the map tracks live noise only.
            for (const [sig, at] of lastReportedAt) {
                if (nowMs - at >= cfg.dedupeTtlMs) lastReportedAt.delete(sig);
            }
            while (allowedAt.length > 0 && nowMs - allowedAt[0] >= cfg.windowMs) allowedAt.shift();

            const last = lastReportedAt.get(signature);
            // Deliberately NOT refreshed on a suppressed hit: a continuously
            // firing error reports once per TTL, so it stays visible in
            // system_logs instead of going silent forever after its first report.
            if (last !== undefined && nowMs - last < cfg.dedupeTtlMs) {
                suppressed++;
                return false;
            }
            if (allowedAt.length >= cfg.maxPerWindow) {
                suppressed++;
                return false;
            }

            lastReportedAt.set(signature, nowMs);
            allowedAt.push(nowMs);
            // Bounded memory: evict the oldest entry rather than trusting the TTL
            // sweep alone, which cannot help against a flood of unique signatures
            // inside a single TTL.
            while (lastReportedAt.size > cfg.maxTrackedSignatures) {
                const oldest = lastReportedAt.keys().next();
                if (oldest.done) break;
                lastReportedAt.delete(oldest.value);
            }
            return true;
        },
        drainSuppressed(): number {
            const n = suppressed;
            suppressed = 0;
            return n;
        },
    };
}

/** Stable identity for an error: same bug ⇒ same signature, bounded length. */
export function errorSignature(kind: string, message: string, stack?: string): string {
    const firstFrame = (stack ?? '').split('\n')[1]?.trim() ?? '';
    return `${kind}|${message.slice(0, 200)}|${firstFrame.slice(0, 200)}`;
}

type GlobalErrorTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface GlobalErrorHandlerOptions extends ErrorReportGateOptions {
    /** Injectable for tests; defaults to `window`. */
    target?: GlobalErrorTarget;
    /** Injectable for tests; defaults to the module's own Sentry state. */
    sentryActive?: () => boolean;
    /** Injectable for tests; defaults to `Date.now`. */
    now?: () => number;
}

/**
 * Register `error` / `unhandledrejection` reporting into `report`.
 *
 * `report` is a callback rather than a direct import of the error handler on
 * purpose: `services/errorHandler.ts` imports THIS module, so importing it back
 * would be a cycle. The wiring lives in `main.tsx`.
 *
 * Returns an uninstall function (used by tests; the app never uninstalls).
 */
export function installGlobalErrorHandlers(
    report: (error: Error, context: Record<string, unknown>) => void,
    options: GlobalErrorHandlerOptions = {},
): () => void {
    const target = options.target ?? (typeof window !== 'undefined' ? window : undefined);
    if (!target) return () => {};
    const isActive = options.sentryActive ?? isSentryActive;
    const now = options.now ?? (() => Date.now());
    const gate = createErrorReportGate(options);

    const dispatch = (kind: string, error: Error, context: Record<string, unknown>): void => {
        try {
            // Constraint 1: Sentry's own GlobalHandlers has this covered.
            if (isActive()) return;
            const signature = errorSignature(kind, error.message, error.stack);
            if (!gate.shouldReport(signature, now())) return;
            const dropped = gate.drainSuppressed();
            report(error, {
                ...context,
                kind,
                ...(dropped > 0 ? { suppressedSinceLastReport: dropped } : {}),
            });
        } catch {
            // A failure INSIDE the global error handler must never re-enter it.
            // Swallowed on purpose: throwing here would fire `error` again.
        }
    };

    const onError = (event: Event): void => {
        const e = event as ErrorEvent;
        const error = e.error instanceof Error ? e.error : new Error(String(e.message ?? 'Unknown window error'));
        dispatch('window.error', error, {
            filename: typeof e.filename === 'string' ? e.filename : undefined,
            lineno: typeof e.lineno === 'number' ? e.lineno : undefined,
            colno: typeof e.colno === 'number' ? e.colno : undefined,
        });
    };

    const onRejection = (event: Event): void => {
        const reason = (event as PromiseRejectionEvent).reason;
        const error = reason instanceof Error ? reason : new Error(`Unhandled rejection: ${String(reason)}`);
        dispatch('unhandledrejection', error, {});
    };

    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
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
