import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { logger } from '../utils/logger';
import { captureSentryException } from '../sentry';
import { sanitizeForSentry } from '../utils/sentrySanitize';

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

        await captureSentryException(error instanceof Error ? error : new Error(message), {
            level: severity === ErrorSeverity.CRITICAL ? 'fatal'
                : severity === ErrorSeverity.LOW ? 'warning'
                : 'error',
            extra: sanitizeForSentry(errorLog.context ?? {}),
        });

        if (notify) {
            // Logic for showing a toast or notification could go here
        }

        try {
            // system_logs is functions-only write now; funnel through the
            // App-Check-gated logClientError callable instead of a direct addDoc.
            const logFn = httpsCallable(functions, 'logClientError');
            await logFn({
                message: errorLog.message,
                code: errorLog.code,
                stack: errorLog.stack,
                url: errorLog.url,
                context: errorLog.context,
                severity: errorLog.severity,
            });
        } catch (e) {
            logger.warn('Failed to log error via logClientError callable:', e);
        }
    }
}

export const errorHandler = ErrorHandler.getInstance();
