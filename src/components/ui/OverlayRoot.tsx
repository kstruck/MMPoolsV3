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
import { useOverlayOwner } from './overlayStack';

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
      // A node detached with the overlay cannot take focus back.
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [active]);

  const isDialog = dialog && active;

  return (
    <div
      data-overlay-root={active ? '' : undefined}
      role={isDialog ? 'dialog' : undefined}
      aria-modal={isDialog ? true : undefined}
      aria-label={isDialog ? label : undefined}
      className={className}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
