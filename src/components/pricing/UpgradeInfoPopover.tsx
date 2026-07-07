import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Click-toggled info popover for the premium upgrade rows on the pricing page.
 * Replaces the old hover (`group-hover`) tooltip, which opened every tooltip at
 * once when hovering anywhere on the estimator card. Closes on outside click
 * and Escape. Safe to render inside a <label>: the trigger is a real button
 * that prevents default + stops propagation so it never toggles the checkbox.
 */
export const UpgradeInfoPopover: React.FC<{ title: string; description: string }> = ({ title, description }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const popoverId = useId();

    useEffect(() => {
        if (!open) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    return (
        <span ref={rootRef} className="relative inline-block ml-1 align-middle">
            <button
                type="button"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? popoverId : undefined}
                aria-label={`What is ${title}?`}
                onClick={(e) => {
                    // Rendered inside a <label>: block the label's default
                    // activation so the row's checkbox does not toggle.
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(prev => !prev);
                }}
                className="inline-flex items-center justify-center rounded-full text-faint hover:text-muted cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60"
            >
                <HelpCircle size={14} className="shrink-0" />
            </button>
            {open && (
                <span
                    id={popoverId}
                    role="tooltip"
                    onClick={(e) => {
                        // Keep clicks on the popover body from reaching the wrapping <label>.
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-card border border-line p-3.5 rounded-xl text-[11px] leading-relaxed text-[color:var(--text)] font-body normal-case tracking-normal text-left cursor-default shadow-panel z-50 backdrop-blur-md block animate-in fade-in zoom-in-95 duration-150"
                >
                    <strong className="text-gold-600 dark:text-gold-400 block mb-1 font-display font-bold uppercase tracking-[0.08em] text-[10px]">{title}</strong>
                    {description}
                    <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[color:var(--card)]" />
                </span>
            )}
        </span>
    );
};
