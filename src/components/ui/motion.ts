import type { Transition } from 'framer-motion';

/**
 * Shared Framer Motion timing. One place, so every JS-driven entrance in the
 * app agrees with the CSS side (`ease-out` / `.animate-in` in index.css).
 *
 * Rules these encode (review-animations, 2026-09-03):
 * - Entering/exiting UI uses a strong ease-out, never `ease-in` or the default.
 * - UI stays under 300ms. Toasts get a touch longer so they read as deliberate.
 * - Animate the full `transform` string, not `x`/`y`/`scale` shorthands —
 *   shorthands run on the main thread and drop frames while the page is busy.
 */
export const UI_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Standard enter/exit for cards, banners, popovers. */
export const UI_TRANSITION: Transition = { duration: 0.22, ease: UI_EASE };

/** Toasts: slightly slower than a card so they feel placed, not flung. */
export const TOAST_TRANSITION: Transition = { duration: 0.28, ease: UI_EASE };

/** Modals: centered, so scale from 0.95 — never from 0. */
export const MODAL_TRANSITION: Transition = { duration: 0.2, ease: UI_EASE };
