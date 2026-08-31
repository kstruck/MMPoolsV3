import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

/**
 * Header dropdown — the WAI-ARIA "Disclosure Navigation Menu" pattern, NOT
 * `role="menu"`.
 *
 * The APG is explicit that `role="menu"`/`menuitem` is for application-style
 * command menus, and that applying it to site navigation is a common mistake:
 * it strips the links of their link semantics, so a screen reader stops
 * announcing "link", and browser affordances (open-in-new-tab, copy address,
 * the status-bar URL preview) read as inert commands. A disclosure is a plain
 * button with `aria-expanded` revealing an ordinary list of ordinary `<a>`s,
 * which is what these actually are.
 *
 * That also keeps the a11y invariant this repo already guards — every header
 * destination is a real `<a href>` (tests/a11y-invariants.test.ts), so
 * middle-click and Cmd-click still work now that the destinations live one
 * level down.
 *
 * Behaviour: click toggles. Esc closes and returns focus to the trigger.
 * ArrowDown opens and lands on the first item (keyboard users should not have
 * to Tab past the trigger to reach what they just opened). A click anywhere
 * outside, or focus leaving the group entirely, closes it. Hover does NOT
 * open: hover menus fire on cursor pass-through, have no touch equivalent, and
 * were a large share of the "menu is chaotic" complaints this redesign answers.
 */
export const NavMenu: React.FC<{
    /** Trigger content — text, or an icon plus text. */
    label: React.ReactNode;
    /** Screen-reader name when `label` alone is not descriptive. */
    ariaLabel?: string;
    /** Which edge the panel is pinned to. Right for the account cluster. */
    align?: 'left' | 'right';
    /** Trigger gets the active treatment when a child route is current. */
    active?: boolean;
    triggerClassName?: string;
    panelClassName?: string;
    children: React.ReactNode;
}> = ({ label, ariaLabel, align = 'left', active = false, triggerClassName, panelClassName, children }) => {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    // Set only when the menu was opened from the keyboard, so a mouse user's
    // focus is never yanked off the trigger they just clicked.
    const focusFirstOnOpen = useRef(false);
    const panelId = useId();

    const close = useCallback((returnFocus = false) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    }, []);

    // Close on outside pointer-down. Pointer-down rather than click so the
    // panel is gone before the click lands on whatever is underneath — a click
    // handler would let the same press both close this and activate that.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onDown, true);
        return () => document.removeEventListener('pointerdown', onDown, true);
    }, [open]);

    // Close when focus leaves the group (Tab off the last item).
    useEffect(() => {
        if (!open) return;
        const onFocusIn = (e: FocusEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('focusin', onFocusIn, true);
        return () => document.removeEventListener('focusin', onFocusIn, true);
    }, [open]);

    // Esc closes from anywhere inside and hands focus back to the trigger.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close(true);
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [open, close]);

    useEffect(() => {
        if (!open || !focusFirstOnOpen.current) return;
        focusFirstOnOpen.current = false;
        panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
    }, [open]);

    return (
        <div ref={wrapRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={ariaLabel}
                onClick={() => setOpen(o => !o)}
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    if (open) {
                        // Already open: `setOpen(true)` is a no-op, so the
                        // effect below would never run and the flag would sit
                        // armed until some LATER mouse click, stealing focus
                        // from the trigger the user just pressed. Move focus
                        // here instead and leave the flag alone.
                        panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
                        return;
                    }
                    focusFirstOnOpen.current = true;
                    setOpen(true);
                }}
                className={cn(
                    'relative flex items-center gap-1 min-h-[24px] font-display font-semibold uppercase',
                    'text-[14px] tracking-[0.06em] pb-0.5 transition-colors rounded-[6px]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                    active || open ? 'text-white' : 'text-white/70 hover:text-white',
                    triggerClassName,
                )}
            >
                {label}
                <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={cn('transition-transform duration-150', open && 'rotate-180')}
                />
            </button>
            {/* Kept mounted-on-open (not hidden) so the panel's links are out of
                the Tab order entirely while closed. */}
            {open && (
                <div
                    ref={panelRef}
                    id={panelId}
                    // A click on any item closes the menu. Capture phase so it
                    // runs even when the item's own handler navigates away.
                    onClickCapture={() => setOpen(false)}
                    className={cn(
                        'absolute top-full mt-2 z-50 min-w-[220px] rounded-[12px] p-1.5',
                        'bg-navy-800 border border-[rgba(230,206,150,0.22)]',
                        'shadow-[0_18px_40px_rgba(4,10,24,0.55)]',
                        align === 'right' ? 'right-0' : 'left-0',
                        panelClassName,
                    )}
                >
                    {children}
                </div>
            )}
        </div>
    );
};

const itemBase =
    'w-full flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition-colors ' +
    'font-display font-semibold uppercase text-[13px] tracking-[0.05em] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500';

/**
 * A destination inside a NavMenu. A real `<a href>`: plain left-click is SPA
 * navigation, modified clicks fall through to the browser.
 */
export const NavMenuItem: React.FC<{
    to: string;
    onClick: () => void;
    active?: boolean;
    icon?: React.ReactNode;
    hint?: string;
    className?: string;
    children: React.ReactNode;
}> = ({ to, onClick, active = false, icon, hint, className, children }) => (
    <a
        href={to}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onClick();
        }}
        className={cn(
            itemBase,
            active ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
            hint && 'items-start',
            className,
        )}
    >
        {icon && <span className={cn('shrink-0 text-gold-400', hint && 'mt-0.5')} aria-hidden="true">{icon}</span>}
        <span className="flex flex-col gap-0.5">
            <span>{children}</span>
            {/* One short line of "what is this" — the redesign moved
                destinations behind a trigger, and a label alone loses the
                context the flat bar had. */}
            {hint && <span className="font-body font-normal normal-case tracking-normal text-[11px] text-white/50">{hint}</span>}
        </span>
    </a>
);

/** A command (not a destination) inside a NavMenu — logout, theme, etc. */
export const NavMenuAction: React.FC<{
    onClick: () => void;
    icon?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}> = ({ onClick, icon, className, children }) => (
    <button type="button" onClick={onClick} className={cn(itemBase, 'text-white/80 hover:bg-white/10 hover:text-white', className)}>
        {icon && <span className="shrink-0 text-gold-400" aria-hidden="true">{icon}</span>}
        {children}
    </button>
);

/** Hairline between groups of items inside a panel. */
export const NavMenuSeparator: React.FC = () => (
    <div role="separator" className="my-1.5 h-px bg-white/12" />
);
