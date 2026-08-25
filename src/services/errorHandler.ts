import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { logger } from '../utils/logger';
import { captureSentryException } from '../sentry';
import { sanitizeForSentry } from '../utils/sentrySanitize';
import { redactClientErrorReport, redactFreeText } from '@shared/piiRedaction';

export const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
} as const;

export type ErrorSeverity = typeof ErrorSeverity[keyof typeof ErrorSeverity];

interface ErrorLog {
    message: string;
    code?: string;
    stack?: string;
    context?: Record<string, unknown>;
    severity: ErrorSeverity;
    timestamp: number;
    userId?: string;
    url: string;
}

/**
 * Recursively removes any keys with undefined values from an object
 * to satisfy Firestore's strict serialization requirements.
 */
function cleanUndefined(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(cleanUndefined);
    }
    const newObj: any = {};
    for (const key in obj) {
        if (obj[key] !== undefined) {
            newObj[key] = cleanUndefined(obj[key]);
        }
    }
    return newObj;
}

/**
 * A copy of an error with its message and stack swept for PII.
 *
 * `sanitizeForSentry` only ever covered the CONTEXT object; the exception itself
 * went to Sentry verbatim, and a failed-request error routinely carries the URL
 * it failed on — query params, tokens and all — in exactly those two fields.
 * Sentry is a third party, which `utils/sentrySanitize.ts` already calls the
 * stricter boundary of the two, so it should not be the one sink that sees the
 * raw text (codex round 4).
 *
 * A copy, never a mutation: the caller's error object belongs to the caller and
 * may still be rendered or rethrown. `name` is carried over because Sentry's
 * grouping uses it (a plain `Error` in place of a `FirebaseError` would silently
 * re-bucket every issue).
 */
function redactedForSentry(error: Error): Error {
    const copy = new Error(redactFreeText(error.message));
    copy.name = error.name;
    if (error.stack) copy.stack = redactFreeText(error.stack);
    return copy;
}

class ErrorHandler {
    private static instance: ErrorHandler;

    private constructor() { }

    public static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    /**
     * Logs an error to Firestore and optionally shows a UI notification
     */
    public async handleError(
        error: unknown,
        options: {
            severity?: ErrorSeverity;
            context?: Record<string, unknown>;
            notify?: boolean;
            customMessage?: string;
        } = {}
    ): Promise<void> {
        const {
            severity = ErrorSeverity.MEDIUM,
            context = {},
            notify = true,
            customMessage
        } = options;

        const message = customMessage || (error instanceof Error ? error.message : String(error)) || 'An unexpected error occurred';
        const errObj = error as { code?: string; stack?: string };
        const errorLog: ErrorLog = {
            message,
            code: errObj.code || 'UNKNOWN',
            stack: errObj.stack,
            context: cleanUndefined(context),
            severity,
            timestamp: Date.now(),
            url: window.location.href,
        };

        logger.error(`[ErrorHandler] ${severity.toUpperCase()}:`, message, error, context);

        // One telemetry sink must never take the other down with it. Sentry
        // capture awaits a DYNAMIC import, so a blocked or unavailable
        // @sentry/react chunk rejects here — and before this catch existed that
        // rejection propagated out of handleError, skipping the logClientError
        // call below entirely. Every error report would have been lost in exactly
        // the scenario the Firestore sink exists to cover (codex round 1, P1).
        try {
            await captureSentryException(redactedForSentry(error instanceof Error ? error : new Error(message)), {
                level: severity === ErrorSeverity.CRITICAL ? 'fatal'
                    : severity === ErrorSeverity.LOW ? 'warning'
                        : 'error',
                extra: sanitizeForSentry(errorLog.context ?? {}),
            });
        } catch (e) {
            logger.warn('Sentry capture failed; continuing to the logClientError sink:', e);
        }

        if (notify) {
            // Logic for showing a toast or notification could go here
        }

        try {
            // system_logs is functions-only write now; funnel through the
            // App-Check-gated logClientError callable instead of a direct addDoc.
            //
            // Redacted HERE as well as in the callable (error-tracking audit 21d).
            // The server pass is the authoritative one — this client is untrusted
            // and anyone can call the callable directly — but the Sentry branch
            // above has always sanitized its payload while this branch sent
            // `message`, `stack`, the full `window.location.href` and the raw
            // context verbatim. Redacting before the wire means an email or a
            // `?token=` never leaves the device at all, rather than being cleaned
            // up after it arrives.
            const logFn = httpsCallable(functions, 'logClientError');
            await logFn(
                redactClientErrorReport({
                    message: errorLog.message,
                    code: errorLog.code,
                    stack: errorLog.stack,
                    url: errorLog.url,
                    context: errorLog.context,
                    severity: errorLog.severity,
                }),
            );
        } catch (e) {
            logger.warn('Failed to log error via logClientError callable:', e);
        }
    }
}

export const errorHandler = ErrorHandler.getInstance();
