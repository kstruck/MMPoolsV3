// The Help panel shell and its provider — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// Mounted ONCE, in `App.tsx`, next to the router and inside the providers, so
// it can read the route and the auth state. Everything below it publishes
// where the reader is (`src/help/publish.tsx`); nothing below it renders a
// second panel.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { HelpPanelContext, type HelpPanelHandle } from '../../help/scope';
import { HelpRouteStoreProvider } from '../../help/publish';
import { useOverlayOwner } from '../ui/overlayStack';
import { useFocusTrap } from '../ui/useFocusTrap';
import { cn } from '../ui/cn';
import { HelpPanelBody } from './HelpPanelBody';
import { useHelpShortcut } from './useHelpShortcut';
import { HelpPanelControlContext, useHelpPanelState, type HelpPanelState } from './useHelpPanel';

/** The panel's element id. Also its identity in the overlay stack. */
export const HELP_PANEL_ID = 'help-panel';
/** Must match the CSS transition below, or the body unmounts mid-slide. */
const EXIT_MS = 250;

/** Mobile gets a modal panel with a backdrop; desktop gets a side drawer. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/**
 * Everything the panel needs, mounted above the router.
 *
 * `isAdmin` is `isSuperAdmin(user)` — the SAME predicate that decides whether
 * `/super-admin` renders — passed in rather than recomputed, so the admin help
 * chunk cannot be gated on a second, drifting rule.
 */
export function HelpProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  return (
    <HelpRouteStoreProvider>
      <HelpPanelHost isAdmin={isAdmin}>{children}</HelpPanelHost>
    </HelpRouteStoreProvider>
  );
}

function HelpPanelHost({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const state = useHelpPanelState({ isAdmin, defaultAudience: isAdmin ? 'admin' : 'member' });
  const { isOpen, open, close, toggle, openTo, openPage } = state;

  // The tooltip's view of the panel: the two verbs and nothing else. `HelpTip`
  // has read this context since T1 and falls back to pinning its bubble when
  // it is null — which is what made T1 shippable without a panel.
  const handle = useMemo<HelpPanelHandle>(() => ({ openTo, openPage }), [openTo, openPage]);
  const control = useMemo(() => ({ isOpen, open, toggle }), [isOpen, open, toggle]);

  useHelpShortcut(HELP_PANEL_ID, toggle);

  return (
    <HelpPanelContext.Provider value={handle}>
      <HelpPanelControlContext.Provider value={control}>
        {children}
        <HelpPanel state={state} onClose={close} />
      </HelpPanelControlContext.Provider>
    </HelpPanelContext.Provider>
  );
}

export function HelpPanel({ state, onClose }: { state: HelpPanelState; onClose: () => void }) {
  const { isOpen, page } = state;
  const isMobile = useIsMobile();
  const asideRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  // The body outlives `isOpen` by one transition, then unmounts — a closed
  // panel that stays in the DOM is a tab stop for every reader who never asked
  // for it. Spectrum leaves its off-canvas panel mounted and focusable.
  const [bodyMounted, setBodyMounted] = useState(isOpen);

  useOverlayOwner(HELP_PANEL_ID, { active: isOpen, onEscape: onClose });

  // a11y audit item 15a: deliver the containment `aria-modal` promises. The
  // condition MUST match the `aria-modal` expression below — on desktop this is
  // a non-modal side drawer, and trapping Tab there would strand a keyboard
  // reader in a panel the page never claimed to own.
  useFocusTrap(asideRef, isOpen && isMobile);

  useEffect(() => {
    if (isOpen) {
      setBodyMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setBodyMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // Focus in on open, back out on close.
  useEffect(() => {
    if (isOpen) {
      restoreFocusTo.current = document.activeElement as HTMLElement | null;
      // One frame, so the body has mounted and the input exists.
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    const previous = restoreFocusTo.current;
    restoreFocusTo.current = null;
    // Only when focus is still inside the panel — a reader who clicked
    // something else while it was open should keep the focus they chose.
    if (previous && asideRef.current?.contains(document.activeElement)) previous.focus();
  }, [isOpen]);

  // Click outside closes, EXCEPT on a help trigger — a `?` icon opening the
  // panel would otherwise be its own close button on the same click.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (asideRef.current?.contains(target)) return;
      if (target.closest('[data-help-trigger], [data-help-id]')) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {isOpen && isMobile ? (
        <div
          data-help-overlay=""
          aria-hidden="true"
          className="fixed inset-0 z-[59] bg-black/40"
          onClick={onClose}
        />
      ) : null}
      <aside
        ref={asideRef}
        id={HELP_PANEL_ID}
        data-help-overlay=""
        // Out of the accessibility tree AND out of the tab order while closed.
        // `role`/`aria-modal` are dropped rather than left on a hidden element,
        // which would announce a dialog nobody opened.
        role={isOpen ? 'dialog' : undefined}
        aria-modal={isOpen && isMobile ? true : undefined}
        aria-labelledby="help-panel-title"
        aria-hidden={isOpen ? undefined : true}
        inert={isOpen ? undefined : true}
        // Escape is handled by the overlay stack (capture phase) so it closes
        // exactly one overlay; this only stops the key reaching the page behind.
        // Inline, with no `useCallback`: the wrapper had an empty dependency list
        // and this element is not memoised, so it stabilised a reference nothing
        // compared (qodo #3 asked for `useEffectEvent` here — that hook exists in
        // React 19.2, but it is for reading fresh values inside an Effect and
        // React's own guidance is not to pass one as a prop. Deleting the
        // indirection is the version of the finding that is actually right).
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
        className={cn(
          'fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-line bg-page shadow-panel transition-transform duration-250 ease-drawer motion-reduce:duration-0 md:w-[440px]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          {/* K6: "Help", not "Dashboard Help". MMP has no single dashboard. */}
          <h2 id="help-panel-title" className="font-display font-bold uppercase text-[14px] tracking-[0.06em] text-[color:var(--text)]">
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="rounded p-1 text-muted hover:text-[color:var(--text)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {/* Remounted per page, so the search box and the accordions do not
            carry state from the screen the reader has left. */}
        {bodyMounted ? (
          <HelpPanelBody key={page?.id ?? 'no-page'} state={state} searchInputRef={searchInputRef} />
        ) : null}
      </aside>
    </>,
    document.body,
  );
}
