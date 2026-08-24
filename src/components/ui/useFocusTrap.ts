import { useEffect } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab/Shift+Tab cycling inside `ref` while `active` (a11y audit
 * 2026-08-23: AuthModal declared aria-modal="true" and then let focus walk out
 * onto the page behind it — 12 Tabs landed on the header nav). Standard
 * wrap-around trap: Tab on the last focusable wraps to the first, Shift+Tab on
 * the first wraps to the last, and focus that ESCAPED the container (browser
 * chrome aside) is pulled back to the first focusable.
 *
 * Listener is registered on `active`, NOT mount, mirroring useOverlayOwner —
 * these modals stay mounted while closed.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
    useEffect(() => {
        if (!active) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            const root = ref.current;
            if (!root) return;
            // No offsetParent visibility filter on purpose: it reports null for
            // children of position:fixed containers (which these modals are)
            // and in jsdom, so it filtered out real focusables. The selector's
            // :not([disabled]) covers the common case; a rare hidden element
            // receiving focus is a lesser bug than the trap skipping elements.
            const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (focusables.length === 0) {
                // Nothing focusable — keep focus on the container itself.
                e.preventDefault();
                root.focus();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const current = document.activeElement as HTMLElement | null;
            const inside = current !== null && root.contains(current);
            if (!inside) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
                return;
            }
            if (!e.shiftKey && current === last) {
                e.preventDefault();
                first.focus();
            } else if (e.shiftKey && (current === first || current === root)) {
                e.preventDefault();
                last.focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [ref, active]);
}
