// Which overlay owns the screen — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// WHY THIS EXISTS. The `?` shortcut must not fire while a modal is open, and
// Escape must close exactly one thing. A `role="dialog"` selector alone does
// not hold here: 6 modal shells carry the role and there are ~41 `fixed
// inset-0` overlay backdrops in `src/`, most with no role at all (measured in
// PLAN §3 D3 / SWEEPS §C5). So there are two mechanisms, deliberately:
//
//   1. A STACK that migrated overlays push onto while they are open. It is
//      authoritative — it knows the order, so Escape can be given to the top
//      one only. T2 registers the accessible modals; T16 migrates the rest.
//   2. A DOM FALLBACK for everything not yet migrated. It is a heuristic and
//      is only consulted when the stack is EMPTY, so a migrated overlay is
//      never second-guessed by a class name.
//
// PUSH ON `active`, NOT ON MOUNT. `AuthModal` and `ShareModal` stay mounted
// while closed behind an `isOpen` prop; pushing on mount would let a closed
// modal own the stack for the life of the app and the `?` key would never
// work again.

import { useEffect, useRef } from 'react';

interface OverlayOwner {
  id: string;
  onEscape?: () => void;
}

/** Innermost-last. Only the last entry handles Escape. */
const stack: OverlayOwner[] = [];
let listenerAttached = false;

/**
 * Marks an element as part of the Help panel itself, so the DOM fallback below
 * does not report the panel as "some other overlay is open" and refuse to
 * toggle itself.
 */
export const HELP_OVERLAY_ATTR = 'data-help-overlay';

/**
 * One selector string, four clauses, in order of how much they prove: an
 * explicit dialog role, an explicit modal, an opt-in marker, and finally the
 * literal Tailwind class pair every one of the measured backdrops carries.
 * The last clause is why unmigrated overlays are covered in the interim.
 */
const FALLBACK_SELECTOR = [
  `[role="dialog"]:not([${HELP_OVERLAY_ATTR}])`,
  `[aria-modal="true"]:not([${HELP_OVERLAY_ATTR}])`,
  `[data-overlay-root]:not([${HELP_OVERLAY_ATTR}])`,
  `.fixed.inset-0:not([${HELP_OVERLAY_ATTR}])`,
].join(', ');

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top?.onEscape) return;
  // `stopPropagation` is not enough: the unmigrated modals attach their own
  // Escape listeners to `document`, which is the SAME target, and propagation
  // stopping does not affect sibling listeners on one target. Without this,
  // Escape over the Help panel would also close the modal underneath it.
  event.stopImmediatePropagation();
  event.preventDefault();
  top.onEscape();
}

function attach(): void {
  if (listenerAttached || typeof document === 'undefined') return;
  document.addEventListener('keydown', handleKeydown, true);
  listenerAttached = true;
}

function detachIfEmpty(): void {
  if (stack.length > 0 || !listenerAttached || typeof document === 'undefined') return;
  document.removeEventListener('keydown', handleKeydown, true);
  listenerAttached = false;
}

/** The id of the overlay currently owning the screen, or `null` if none has. */
export function overlayStackTop(): string | null {
  return stack.length > 0 ? stack[stack.length - 1].id : null;
}

/**
 * Is some overlay OTHER than `id` on screen?
 *
 * The stack answers first, because it is the thing that actually knows. Only
 * when nothing has registered does the DOM heuristic run — so a correctly
 * registered overlay is never overruled by an unrelated `fixed inset-0`
 * element elsewhere on the page.
 */
export function isForeignOverlayOpen(id: string): boolean {
  const top = overlayStackTop();
  if (top !== null) return top !== id;
  if (typeof document === 'undefined') return false;
  return document.querySelector(FALLBACK_SELECTOR) !== null;
}

/**
 * Own the screen while `active`. Returns nothing: the stack is read through
 * `overlayStackTop` / `isForeignOverlayOpen`, never held by a caller.
 */
export function useOverlayOwner(id: string, options: { active: boolean; onEscape?: () => void }): void {
  const { active, onEscape } = options;
  // The handler is read through a ref so that a caller passing an inline arrow
  // (every caller) does not re-push on every render. Written in an effect, not
  // during render: a ref touched while rendering is not safe under concurrent
  // React, and the lint rule that says so is right.
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const owner: OverlayOwner = { id, onEscape: () => escapeRef.current?.() };
    stack.push(owner);
    attach();
    return () => {
      const at = stack.indexOf(owner);
      if (at !== -1) stack.splice(at, 1);
      detachIfEmpty();
    };
  }, [id, active]);
}

/** Test-only: drop every registration so one spec cannot leak into the next. */
export function __resetOverlayStack(): void {
  stack.length = 0;
  detachIfEmpty();
}
