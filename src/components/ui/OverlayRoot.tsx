// The backdrop element every full-screen overlay renders — PLAN-HELP-SYSTEM.md
// §3 D3, ticket T16.
//
// WHY THIS EXISTS. `overlayStack.ts` (T2) can only arbitrate the `?` key and
// Escape between overlays that REGISTER. Six modals did; the other ~35
// `fixed inset-0` shells in `src/components` were covered by a DOM heuristic
// that matches the literal Tailwind class pair. The heuristic holds only for as
// long as every backdrop happens to keep those two classes, and nothing fails
// when one does not. This component is the registration, done once, so a shell
// cannot be written without it.
//
// IT MOUNTS WHEN THE OVERLAY OPENS. Every call site renders it inside a
// `{isOpen && …}` (or after an `if (!open) return null`), so `active` defaults
// to true and the stack entry retracts with the unmount — the same shape as
// `QuickPicksDialog`. The one caller that keeps the element mounted while the
// overlay is closed passes `active` explicitly.
//
// A ROLE IT DOES NOT EARN IS WORSE THAN NO ROLE. `role="dialog"` tells a screen
// reader the reader is trapped in something dismissable. A loading scrim, a
// full-bleed editor and a click-away catcher are none of those, so they pass
// `dialog={false}` and get the marker and the stack entry without the role.
// The prop types below make `label` mandatory for the ones that DO claim it —
// a dialog with no accessible name is the other half of the same lie.

import React, { useEffect, useRef, useState } from 'react';
import { overlayStackTop, useOverlayOwner } from './overlayStack';

/** Controls a reader can Tab to. Order is DOM order, which is tab order here. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Whatever has focus right now, if it is a real control.
 *
 * `<body>` is not one: it is what `activeElement` reports when nothing is
 * focused, and focusing it back is worse than leaving focus alone.
 */
function readOpener(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

interface OverlayRootBase {
  /** Stable, unique id for the overlay stack. Kebab-case, names the overlay. */
  id: string;
  /** Backdrop classes. Includes `fixed inset-0` for every real overlay. */
  className?: string;
  /** Escape closes the overlay. Only the top of the stack is offered it. */
  onEscape?: () => void;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  /**
   * Defaults to true because the element is normally mounted only while open.
   * Pass it when the element stays mounted and only its class changes.
   */
  active?: boolean;
  children?: React.ReactNode;
}

type OverlayRootProps =
  | (OverlayRootBase & { dialog?: true; label: string })
  | (OverlayRootBase & { dialog: false; label?: never });

export const OverlayRoot: React.FC<OverlayRootProps> = ({
  id,
  className,
  dialog = true,
  label,
  onEscape,
  onClick,
  active = true,
  children,
}) => {
  useOverlayOwner(id, { active, onEscape });

  // Focus return, the cheap half of focus management. Whatever had focus when
  // the overlay opened gets it back when the overlay goes away. Focus is NOT
  // moved INTO the overlay and NOT trapped inside it — that needs a per-modal
  // decision about which control should receive it, which this component
  // cannot make. The modals that already do it keep doing it.
  //
  // WHEN THE OPENER IS READ depends on how the overlay arrived, and both
  // readings are needed:
  //
  //  - MOUNTED OPEN (32 of the 33 shells): read in a state INITIALISER, which
  //    runs before the commit that fires a child's `autoFocus`. An effect runs
  //    after that commit and would record the autofocused input inside the
  //    overlay — detached by the time the cleanup runs, so focus would land on
  //    nothing (codex round 3: guest details, coupon mint, bracket name).
  //  - MOUNTED CLOSED, then opened (the SuperAdmin seed editor): the mount-time
  //    reading predates the click that opened it. Re-read on the transition,
  //    where an effect is early enough because nothing autofocuses — the
  //    element was already on the page (codex round 4).
  const [openerAtMount] = useState(readOpener);
  const opener = useRef<HTMLElement | null>(openerAtMount);
  const mounting = useRef(true);
  useEffect(() => {
    const firstRender = mounting.current;
    mounting.current = false;
    if (!active) return;
    if (!firstRender) opener.current = readOpener();
    return () => {
      // HAND-OFF, NOT CLOSE. One overlay can be replaced by another in a single
      // update — Grid's guest-details "Continue" closes that dialog and opens
      // the reservation confirmation. Restoring focus then puts the keyboard on
      // a control BEHIND an `aria-modal` dialog (codex round 5). The DOM has
      // already been updated by the time this cleanup runs, so a marker still
      // on screen means the screen still belongs to an overlay.
      if (typeof document !== 'undefined' && document.querySelector('[data-overlay-root]')) return;
      // A node detached with the overlay cannot take focus back.
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [active]);

  const isDialog = dialog && active;
  const rootRef = useRef<HTMLDivElement>(null);

  // `aria-modal="true"` tells a screen reader the rest of the page is inert.
  // Leaving focus outside makes that a lie: Tab would start behind the dialog
  // and walk obscured controls (codex round 5, P1). So focus moves in on open,
  // and Tab wraps inside. A modal that focuses its own control keeps it —
  // `autoFocus` fires during commit and a sibling's effect runs after this one,
  // and both leave focus already inside the root, which this check respects.
  useEffect(() => {
    const root = rootRef.current;
    if (!isDialog || !root) return;
    if (root.contains(document.activeElement)) return;
    // The dialog itself, not its first control: the first control is sometimes
    // the destructive one, and APG's fallback for "no obviously right element"
    // is the dialog. Tab from here goes to the first control anyway. It is also
    // what `ShareModal` has always done.
    root.focus();
  }, [isDialog]);

  useEffect(() => {
    if (!isDialog) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const root = rootRef.current;
      // Only the overlay on top of the stack traps — a dialog underneath
      // another one must not fight it for the keyboard.
      if (!root || overlayStackTop() !== id) return;
      const items = focusableWithin(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!root.contains(at)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && at === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && at === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeydown, true);
    return () => document.removeEventListener('keydown', onKeydown, true);
  }, [isDialog, id]);

  return (
    <div
      ref={rootRef}
      data-overlay-root={active ? '' : undefined}
      role={isDialog ? 'dialog' : undefined}
      aria-modal={isDialog ? true : undefined}
      aria-label={isDialog ? label : undefined}
      tabIndex={isDialog ? -1 : undefined}
      className={className}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
