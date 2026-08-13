import React, { useEffect, useRef } from 'react';
import { Zap, Home, Plane, TrendingUp, TrendingDown, X } from 'lucide-react';
import type { NFLGame } from '../../../types';
import { planQuickPicks, type QuickPickStrategy } from './quickPicks';

/**
 * The Quick Picks chooser — four mechanical fills for an empty pick'em sheet.
 *
 * ⚠️ IT SHOWS THE OUTCOME BEFORE THE PRESS. Each option prints how many games
 * it would fill and how many it would leave alone, computed from the same
 * `planQuickPicks` the press then applies. That is the point rather than a
 * flourish: preseason weeks 3 and 4 carry ZERO lines across 32 games today, so
 * "Favorites" on those weeks fills NOTHING, and a button that silently did
 * nothing would read as broken. Kevin's instruction was to say so in the modal.
 *
 * ⚠️ NO "OPTIMAL PICKS" OPTION, by instruction (Kevin, 2026-08-12). Every
 * strategy here is a read of stored data, not a recommendation.
 *
 * ponytail: no focus trap. Escape closes, the backdrop closes, and the first
 * option takes focus on open — which is what the app's own confirm dialog does
 * (`ui/Toast.tsx`). A real trap belongs in a shared dialog primitive if this
 * app ever grows one, not in the second hand-rolled copy of one.
 */

interface QuickPicksDialogProps {
  games: NFLGame[];
  /** The sheet's current picks — already-answered games are never overwritten. */
  picks: Record<string, string>;
  /** The sheet's clock-corrected "can this game still move" predicate. */
  eligible: (game: NFLGame) => boolean;
  /**
   * ⚠️ Receives the STRATEGY, not the plan the counts were rendered from.
   *
   * The counts below are computed when this dialog renders. A member who opens
   * it a minute before a kickoff and then chooses can be choosing AFTER that
   * game locked — the sheet re-evaluates lock state only every 30s — and a
   * cached plan would then write a pick the server refuses, turning a Quick
   * Pick into a failed save. The sheet re-plans against the live predicate at
   * the moment of the press instead. (codex round 1 on this PR.)
   *
   * The consequence is deliberate: the numbers on screen are a PREVIEW and may
   * be one game higher than what lands. The toast reports what was actually
   * filled, so the member is told the true number either way.
   */
  onApply: (strategy: QuickPickStrategy) => void;
  onClose: () => void;
}

const STRATEGIES: Array<{
  id: QuickPickStrategy;
  label: string;
  hint: string;
  Icon: typeof Zap;
}> = [
  { id: 'FAVORITES', label: 'Favorites', hint: 'The side the betting line favours', Icon: TrendingUp },
  { id: 'UNDERDOGS', label: 'Underdogs', hint: 'The other side of every line', Icon: TrendingDown },
  { id: 'HOME', label: 'Home Teams', hint: 'Every home team', Icon: Home },
  { id: 'AWAY', label: 'Away Teams', hint: 'Every road team', Icon: Plane },
];

export const QuickPicksDialog: React.FC<QuickPicksDialogProps> = ({
  games,
  picks,
  eligible,
  onApply,
  onClose,
}) => {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const plans = STRATEGIES.map(s => ({
    ...s,
    plan: planQuickPicks(games, s.id, picks, eligible),
  }));

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-picks-title"
        className="w-full max-w-md rounded-xl border border-line bg-card p-6 shadow-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2
            id="quick-picks-title"
            className="font-display font-bold uppercase text-lg text-[color:var(--text)] flex items-center gap-2"
          >
            <Zap size={18} aria-hidden="true" /> Quick Picks
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Picks"
            className="shrink-0 text-muted hover:text-[color:var(--text)] p-1 -m-1"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="font-body text-[12px] text-muted mb-5">
          Fills only the games you have not picked yet — nothing you have already chosen is
          changed, and you can adjust anything before you save.
        </p>

        <div className="space-y-2">
          {plans.map(({ id, label, hint, Icon, plan }, i) => {
            // Nothing to fill: every game is already picked, or (on a spread
            // strategy) none of the remaining ones has a line. Disabled rather
            // than hidden, so the reason is visible instead of the option
            // vanishing without explanation.
            const empty = plan.pickCount === 0;
            return (
              <button
                key={id}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                disabled={empty}
                onClick={() => { onApply(id); onClose(); }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all duration-150 ${
                  empty
                    ? 'bg-page border-line opacity-50 cursor-not-allowed'
                    : 'bg-page border-line hover:border-gold-500/60 hover:-translate-y-0.5 hover:shadow-card-hover'
                }`}
              >
                <Icon size={18} className="shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display font-bold uppercase text-[13px] tracking-[0.05em] text-[color:var(--text)]">
                    {label}
                  </span>
                  <span className="block font-body text-[11px] text-muted">{hint}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display font-bold text-[13px] num text-[color:var(--text)]">
                    {plan.pickCount}
                  </span>
                  <span className="block text-[9px] font-display font-bold uppercase tracking-[0.08em] text-faint">
                    to fill
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Every strategy empty AND nothing was skipped for want of a line, so
            the only explanation left is that the remaining games have locked.
            Without this the dialog is four disabled rows and no reason — which
            reads as broken. (self-review, before the PR.) */}
        {plans.every(p => p.plan.pickCount === 0) && plans[0].plan.skipCount === 0 && (
          <p className="mt-4 font-body text-[11px] text-muted bg-page border border-line rounded-lg px-3 py-2">
            Nothing left to fill — the games you have not picked have already locked.
          </p>
        )}

        {/* The unpriced-games notice. `skipCount` is identical for FAVORITES and
            UNDERDOGS — both need the same line — so it is stated once, from the
            first of the two, rather than repeated on each row. */}
        {plans[0].plan.skipCount > 0 && (
          <p className="mt-4 font-body text-[11px] text-gold-700 dark:text-gold-400 bg-gold-400/10 border border-gold-500/40 rounded-lg px-3 py-2 num">
            {plans[0].plan.skipCount} {plans[0].plan.skipCount === 1 ? 'game has' : 'games have'} no
            line yet — Favorites and Underdogs will skip {plans[0].plan.skipCount === 1 ? 'it' : 'those'}.
            Pick {plans[0].plan.skipCount === 1 ? 'it' : 'them'} by hand.
          </p>
        )}
      </div>
    </div>
  );
};
