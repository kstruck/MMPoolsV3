/**
 * Dev-only logger utility.
 * Wraps console.* methods so they are silenced in production builds.
 * `logger.error` always logs (errors should never be hidden).
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.log('debug info', someData);
 */

const isDev = import.meta.env.DEV;

export const logger = {
    log: (...args: unknown[]) => { if (isDev) console.log(...args); },
    warn: (...args: unknown[]) => { if (isDev) console.warn(...args); },
    info: (...args: unknown[]) => { if (isDev) console.info(...args); },
    debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
    error: (...args: unknown[]) => { console.error(...args); },
};
