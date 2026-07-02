import { logger } from './logger';

/**
 * localStorage-backed draft persistence for in-progress picks/entries.
 * A closed tab, back-swipe, or crash must never lose a user's unsaved work.
 * Keys are namespaced `draft:{key}`; saves are debounced per key.
 */

const timers = new Map<string, number>();

export function loadDraft<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(`draft:${key}`);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
        logger.error('draftStore: failed to load draft', err);
        return null;
    }
}

export function saveDraft<T>(key: string, value: T): void {
    const existing = timers.get(key);
    if (existing) window.clearTimeout(existing);
    timers.set(key, window.setTimeout(() => {
        try {
            localStorage.setItem(`draft:${key}`, JSON.stringify(value));
        } catch (err) {
            logger.error('draftStore: failed to save draft', err);
        }
    }, 500));
}

export function clearDraft(key: string): void {
    const existing = timers.get(key);
    if (existing) window.clearTimeout(existing);
    timers.delete(key);
    try {
        localStorage.removeItem(`draft:${key}`);
    } catch {
        /* storage unavailable — nothing to clear */
    }
}
