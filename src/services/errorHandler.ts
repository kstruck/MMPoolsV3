import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from '../utils/logger';

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
    context?: any;
    severity: ErrorSeverity;
    timestamp: number;
    userId?: string;
    url: string;
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
        error: any,
        options: {
            severity?: ErrorSeverity;
            context?: any;
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

        const message = customMessage || error.message || 'An unexpected error occurred';
        const errorLog: ErrorLog = {
            message,
            code: error.code || 'UNKNOWN',
            stack: error.stack,
            context,
            severity,
            timestamp: Date.now(),
            url: window.location.href,
        };

        logger.error(`[ErrorHandler] ${severity.toUpperCase()}:`, message, error, context);

        if (notify) {
            // Logic for showing a toast or notification could go here
        }

        try {
            await addDoc(collection(db, 'system_logs'), {
                ...errorLog,
                type: 'error'
            });
        } catch (e) {
            logger.warn('Failed to log error to Firestore:', e);
        }
    }
}

export const errorHandler = ErrorHandler.getInstance();
