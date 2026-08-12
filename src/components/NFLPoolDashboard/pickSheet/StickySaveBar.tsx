import React from 'react';
import { Save, Check } from 'lucide-react';

/**
 * The save control that follows the scroll.
 *
 * Kevin's testers, 2026-08-11, verbatim complaint: the pick page "needs
 * scroll-to-bottom to save". On a sixteen-game slate the button was below every
 * matchup, so saving meant scrolling past the whole sheet — and a member who
 * changed one pick near the top had no way to tell whether the change was in.
 *
 * So: pinned to the bottom of the viewport, greyed until something has actually
 * changed, and it states the current state rather than always saying "Save".
 * `dirty === false` is not just a disabled button — the label switches to a
 * confirmation, which is the answer to "did my pick save?" without scrolling
 * anywhere.
 */

export interface StickySaveBarProps {
  /** True when the on-screen selection differs from what the server holds. */
  dirty: boolean;
  submitting: boolean;
  /** Short summary of the selection, e.g. "KC" or "12 of 16 picked". */
  summary?: string;
  /** Label for the enabled state, e.g. "Save Pick". */
  saveLabel?: string;
  /** Label when there is nothing to save, e.g. "All picks saved". */
  savedLabel?: string;
  /** Disables the button and explains why (locked week, eliminated, no games). */
  blockedReason?: string | null;
  onSave: () => void;
}

export const StickySaveBar: React.FC<StickySaveBarProps> = ({
  dirty,
  submitting,
  summary,
  saveLabel = 'Save Picks',
  savedLabel = 'All picks saved',
  blockedReason,
  onSave,
}) => {
  const disabled = submitting || !dirty || !!blockedReason;

  return (
    // `sticky bottom-0` rather than `fixed`: the bar belongs to the sheet, so it
    // scrolls away with it at the end of the page instead of hovering over the
    // footer and the rest of the app. `env(safe-area-inset-bottom)` keeps it
    // clear of the iOS home indicator, which otherwise sits on top of the button.
    <div
      className="sticky bottom-0 z-30 -mx-1 px-1 pt-2"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="bg-card/95 backdrop-blur border border-line rounded-xl shadow-card-hover px-4 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted truncate">
            {blockedReason ? blockedReason : dirty ? 'Unsaved changes' : savedLabel}
          </p>
          {summary && (
            <p className="font-body text-[12px] text-[color:var(--text)] truncate num">{summary}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className={`shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-display font-bold uppercase text-[12px] tracking-[0.08em] transition-all duration-150 ${
            disabled
              ? 'bg-page border border-line text-faint cursor-not-allowed'
              : 'bg-brandred-600 text-white border border-brandred-600 hover:brightness-110 shadow-card'
          }`}
        >
          {submitting
            ? 'Saving...'
            : dirty
              ? (<><Save size={15} aria-hidden="true" /> {saveLabel}</>)
              : (<><Check size={15} aria-hidden="true" /> Saved</>)}
        </button>
      </div>
    </div>
  );
};
