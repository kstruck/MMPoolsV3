// The inline `?` affordance — PLAN-HELP-SYSTEM.md §3 D2 (T1).
//
// IT TAKES AN ID AND NOTHING ELSE. The Spectrum Price Intel tooltip this ports
// from accepts an inline `text=` prop and 191 of its 213 call sites use it, so
// its "one source of copy" was routed around in practice (PLAN §1a). There is
// no `text` prop here and there must never be one: a second way to write help
// copy is the failure this whole feature exists to prevent.

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { helpRegistry, resolveCopy } from '../../help/registry';
import { useHelpPanel, useHelpScope } from '../../help/scope';

export type TipSide = 'top' | 'bottom';

/** Just enough of a `DOMRect` to place the bubble, so the maths is testable. */
export interface TipRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface TipViewport {
  width: number;
  height: number;
}

/** Bubble width in px. Fixed so the position can be computed before it renders. */
export const TOOLTIP_WIDTH = 260;
/** Gap between the trigger and the bubble, and the minimum viewport margin. */
const GAP = 8;
/**
 * Assumed bubble height, used ONLY to decide which side it opens on.
 *
 * The real height is not known until after it renders, and measuring it would
 * mean painting the bubble in the wrong place first. `short` is capped at 160
 * characters (`COPY_LIMITS.topicShort`), which is about five lines at this
 * width — so this is an upper bound on the copy the registry will accept, not
 * a guess.
 */
const ASSUMED_HEIGHT = 120;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the bubble goes, in viewport coordinates.
 *
 * `position: fixed` from the trigger's own rect, portalled to `document.body`
 * — an ancestor with a `transform` breaks `fixed`, and the wizard, the pool
 * dashboards and the modals all have transformed ancestors somewhere.
 *
 * Anchored by `bottom` when it opens upward, so the bubble's unknown height
 * never enters the calculation.
 */
export function tooltipStyle(rect: TipRect, side: TipSide, viewport: TipViewport): CSSProperties {
  const roomAbove = rect.top;
  const roomBelow = viewport.height - rect.bottom;
  const needed = ASSUMED_HEIGHT + GAP;
  // Flip only when the preferred side does not fit AND the other one does —
  // with no room either way, honour the caller rather than thrashing.
  let placed = side;
  if (side === 'top' && roomAbove < needed && roomBelow >= needed) placed = 'bottom';
  if (side === 'bottom' && roomBelow < needed && roomAbove >= needed) placed = 'top';

  const left = clamp(
    rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2,
    GAP,
    viewport.width - TOOLTIP_WIDTH - GAP,
  );

  return placed === 'top'
    ? { position: 'fixed', left, bottom: viewport.height - rect.top + GAP, width: TOOLTIP_WIDTH }
    : { position: 'fixed', left, top: rect.bottom + GAP, width: TOOLTIP_WIDTH };
}

export interface HelpTipProps {
  /** A `HelpTopic` id, or a form path that resolves to one. Never free copy. */
  helpId: string;
  side?: TipSide;
  className?: string;
}

const measure = (el: HTMLElement): { rect: TipRect; viewport: TipViewport } => {
  const r = el.getBoundingClientRect();
  return {
    rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
};

export function HelpTip({ helpId, side = 'top', className }: HelpTipProps) {
  const scope = useHelpScope();
  const panel = useHelpPanel();
  const tipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<{ rect: TipRect; viewport: TipViewport } | null>(null);
  // `pinned` survives a mouseleave; a hover does not.
  const [pinned, setPinned] = useState(false);

  // While the bubble is up, the page can still scroll under it (a wizard step
  // is taller than the viewport on a phone). `true` for the capture phase, so
  // a scroll inside any container is seen, not only the window's.
  useEffect(() => {
    if (!placement) return;
    const remeasure = () => {
      if (triggerRef.current) setPlacement(measure(triggerRef.current));
    };
    window.addEventListener('scroll', remeasure, true);
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('scroll', remeasure, true);
      window.removeEventListener('resize', remeasure);
    };
  }, [placement]);

  // Resolution is scoped: `resolveTopic` filters BOTH pool type and audience on
  // every return path, and nothing filters after it — this component renders
  // whatever it is handed.
  const topic = helpRegistry.resolveTopic(scope, helpId);

  // No topic = no affordance. NOT a throw: content lands ticket by ticket
  // (T9–T13), so throwing in dev would break the wizard for every field whose
  // copy is not written yet, and a placeholder `?` that explains nothing is
  // worse than none. `tests/help-ui-coverage.test.ts` is the guard instead — a
  // wizard field whose id is neither a topic nor an allowlist row fails there.
  if (!topic) return null;

  const open = placement !== null;
  const show = () => {
    if (triggerRef.current) setPlacement(measure(triggerRef.current));
  };
  const hide = () => {
    setPinned(false);
    setPlacement(null);
  };

  const activate = () => {
    if (panel) {
      panel.openTo({ topicId: topic.id });
      hide();
      return;
    }
    // No panel mounted (all of T1 — it lands in T2). A tap has no hover to fall
    // back on, so it pins the bubble instead of doing nothing at all. It closes
    // on a second tap or on blur; there is no outside-click listener, because
    // the bubble is `pointer-events-none` and cannot trap anything.
    if (pinned) {
      hide();
      return;
    }
    setPinned(true);
    show();
  };

  return (
    <>
      {/* `aria-describedby` is set only while the bubble exists — otherwise it
          names an element that is not in the document and a screen reader
          announces nothing at all. */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`About ${topic.title}`}
        aria-describedby={open ? tipId : undefined}
        data-help-id={topic.id}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned) setPlacement(null);
        }}
        onFocus={show}
        onBlur={hide}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            hide();
          }
        }}
        className={`inline-flex shrink-0 items-center text-faint transition-colors hover:text-[color:var(--text)] focus-visible:text-[color:var(--text)] print:hidden ${className ?? ''}`}
      >
        <HelpCircle size={14} aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={tipId}
              role="tooltip"
              // Text only, and it cannot be pointed at: a `role="tooltip"` that
              // holds a link or a button is not a tooltip. The long copy lives
              // in the panel, one click away (D2/K2).
              className="pointer-events-none z-[70] rounded-lg border border-line bg-[color:var(--card)] px-3 py-2 font-body text-xs leading-relaxed text-[color:var(--text)] shadow-panel print:hidden"
              style={tooltipStyle(placement.rect, side, placement.viewport)}
            >
              {resolveCopy(topic.short, { poolType: scope.poolType })}
              {panel ? <span className="mt-1 block text-faint">More in Help</span> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
