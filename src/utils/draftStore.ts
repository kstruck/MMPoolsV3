import { logger } from './logger';

/**
 * localStorage-backed draft persistence for in-progress picks/entries.
 * A closed tab, back-swipe, or crash must never lose a user's unsaved work.
 * Keys are namespaced `draft:{key}`; saves are debounced per key.
 */

const timers = new Map<string, number>();
/** The value each pending timer would write, so a flush can write it early. */
const pending = new Map<string, unknown>();

function writeNow(key: string, value: unknown): void {
    try {
        localStorage.setItem(`draft:${key}`, JSON.stringify(value));
    } catch (err) {
        logger.error('draftStore: failed to save draft', err);
    }
}

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
    pending.set(key, value);
    timers.set(key, window.setTimeout(() => {
        timers.delete(key);
        pending.delete(key);
        writeNow(key, value);
    }, 500));
}

/**
 * Write every debounced draft immediately.
 *
 * The 500 ms debounce is a real hole, not a theoretical one: a member who picks a
 * game and closes the tab within half a second loses that edit, and the pick
 * sheet now tells them their work is kept as they go. `pagehide` is the event
 * that fires reliably on tab close, navigation, and the iOS back-swipe —
 * `beforeunload` does not fire on mobile Safari, and `unload` is ignored when a
 * page enters the back/forward cache. `visibilitychange` covers the
 * app-switch case on phones, which is how most members leave a pick sheet.
 */
export function flushDrafts(): void {
    for (const [key, value] of pending) {
        const timer = timers.get(key);
        if (timer) window.clearTimeout(timer);
        writeNow(key, value);
    }
    timers.clear();
    pending.clear();
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushDrafts);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushDrafts();
    });
}

/**
 * Whether a draft can actually be persisted in this browser.
 *
 * `saveDraft` swallows its write failure — losing a draft must never break the
 * pick sheet — which means a member in private mode, or with site data blocked,
 * gets no error and no draft. The pick sheet's reassurance line
 * (`pickSheet/draftHint`) would then be a promise the app cannot keep, so it asks
 * here first. (codex r1 P2 on the scope-toggle PR.)
 *
 * The probe is a real write-and-remove, because a `localStorage` object that
 * EXISTS and throws on write is exactly the case that matters; merely testing for
 * the property passes in Safari private mode. Cached: availability does not change
 * within a page's life, and the hint is evaluated on every render of the sheet.
 */
let storageProbe: boolean | null = null;

export function isDraftStorageAvailable(): boolean {
    if (storageProbe !== null) return storageProbe;
    try {
        const probeKey = 'draft:__probe__';
        localStorage.setItem(probeKey, '1');
        localStorage.removeItem(probeKey);
        storageProbe = true;
    } catch {
        storageProbe = false;
    }
    return storageProbe;
}

/** Test-only: clears the cached probe so a suite can exercise both branches. */
export function __resetDraftStorageProbe(): void {
    storageProbe = null;
}

export function clearDraft(key: string): void {
    const existing = timers.get(key);
    if (existing) window.clearTimeout(existing);
    timers.delete(key);
    pending.delete(key);
    try {
        localStorage.removeItem(`draft:${key}`);
    } catch {
        /* storage unavailable — nothing to clear */
    }
}
