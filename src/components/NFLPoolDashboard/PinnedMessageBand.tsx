import React from 'react';
import { Pin, Sparkles } from 'lucide-react';
import type { BanterMessage } from '../../types';
import { banterAuthorName, formatBanterTime } from './banterFormat';

/**
 * The commissioner's pinned message, directly below the score ticker on the
 * pool home page (Kevin, 2026-08-23: "I also want the Pool manager to be able
 * to PIN a message to the top of the Pool home page, right below the score
 * ticker.").
 *
 * Read-only by design. The pin and unpin controls live on the commissioner's
 * feed card, next to the delete control that was already there — one place
 * where a commissioner acts on a post, rather than two.
 *
 * Renders NOTHING when there is nothing pinned, when the pinned post has since
 * been deleted, or when the reader is not a member of the pool. A failed read
 * says so rather than silently rendering an empty band: this repo's recurring
 * defect is an error that looks like an absence.
 */
export const PinnedMessageBand: React.FC<{
  message: BanterMessage | null;
  error?: boolean;
}> = ({ message, error = false }) => {
  if (error) {
    return (
      <div className="rounded-xl border border-line bg-card px-5 py-3 my-6 font-body text-xs text-amber-600 dark:text-amber-300">
        The pinned message could not be loaded right now. Nothing has been lost — try again in a moment.
      </div>
    );
  }

  if (!message) return null;

  const isAI = message.kind === 'AI';

  return (
    <div
      role="note"
      aria-label="Pinned message from your commissioner"
      className="rounded-xl border border-gold-500/50 bg-gold-500/10 px-5 py-4 my-6 flex items-start gap-3 shadow-card"
    >
      <Pin size={15} className="text-gold-700 dark:text-gold-300 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-gold-700 dark:text-gold-300">
            Pinned
          </span>
          <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted flex items-center gap-1">
            {isAI && <Sparkles size={10} aria-hidden="true" />}
            {isAI ? 'AI Commissioner' : banterAuthorName(message)}
          </span>
          <span className="text-[10px] text-faint">{formatBanterTime(message.timestamp)}</span>
        </div>
        <p className="mt-1 font-body text-sm text-[color:var(--text)] whitespace-pre-wrap break-words">
          {message.text}
        </p>
      </div>
    </div>
  );
};
