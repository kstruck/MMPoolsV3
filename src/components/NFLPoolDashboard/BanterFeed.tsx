import React from 'react';
import { Megaphone, Pin, PinOff, Sparkles, Trash2 } from 'lucide-react';
import type { BanterMessage } from '../../types';
import { banterAuthorName, formatBanterTime } from './banterFormat';

/**
 * The pool's banter feed (PLAN-WIZARD-BUYFLOW-FIXES T9).
 *
 * ONE component, rendered in two places — the commissioner's card in the
 * manager view and the Overview tab every member sees. Kevin's question was
 * "where are these messages shown to members?", and the honest answer had been
 * "nowhere": the card kept its feed in React state and threw it away on
 * navigation. Two separate renderers would let those two views drift, which is
 * how "the commissioner sees something the pool does not" happens.
 *
 * `canDelete` and `canPin` are the only differences between them.
 */

interface BanterFeedProps {
    messages: BanterMessage[];
    /** Show a delete control on every row. Owner / co-commissioner only. */
    canDelete?: boolean;
    onDelete?: (messageId: string) => void;
    deletingId?: string | null;
    /**
     * The feed could not be read (a failed subscription), which is NOT the same
     * as an empty feed — and rendering "nothing posted yet" for a failed read is
     * the silence-as-success defect this repo keeps finding.
     */
    error?: boolean;
    /**
     * Show a pin / unpin control on every row. Commissioners only — the pinned
     * post is what every member sees at the top of the pool home page.
     */
    canPin?: boolean;
    /**
     * The pool's currently pinned message id (`pool.pinnedMessageId`). Exactly
     * one row can match, because it is ONE field: pinning a second post
     * necessarily unpins the first, with nothing to enforce.
     */
    pinnedId?: string;
    /** Called with the id to pin, or '' to unpin. */
    onTogglePin?: (messageId: string) => void;
    pinningId?: string | null;
    /** Copy for the empty state; the manager view and the member view differ. */
    emptyText: string;
    maxHeightClass?: string;
}

export const BanterFeed: React.FC<BanterFeedProps> = ({
    messages,
    canDelete = false,
    onDelete,
    deletingId = null,
    canPin = false,
    pinnedId,
    onTogglePin,
    pinningId = null,
    error = false,
    emptyText,
    maxHeightClass = 'max-h-64',
}) => {
    if (error) {
        return (
            <div className="p-3.5 bg-page border border-line rounded-lg font-body text-xs text-amber-600 dark:text-amber-300 leading-relaxed">
                The banter feed could not be loaded right now. Nothing has been lost — try again in a moment.
            </div>
        );
    }

    if (messages.length === 0) {
        return (
            <div className="p-3.5 bg-page border border-line rounded-lg font-body text-xs text-muted leading-relaxed">
                {emptyText}
            </div>
        );
    }

    return (
        <div className={`space-y-3 ${maxHeightClass} overflow-y-auto pr-1`}>
            {messages.map((m) => {
                const isAI = m.kind === 'AI';
                const isPinned = !!m.id && !!pinnedId && m.id === pinnedId;
                return (
                    <div
                        key={m.id}
                        className={`p-3.5 border rounded-lg font-body text-xs text-[color:var(--text)] leading-relaxed flex items-start gap-2 ${
                            isPinned ? 'bg-gold-500/10 border-gold-500/50' : 'bg-page border-line'
                        }`}
                    >
                        {isAI
                            ? <Sparkles size={13} className="text-gold-600 dark:text-gold-400 shrink-0 mt-0.5" aria-hidden="true" />
                            : <Megaphone size={13} className="text-brandred-600 shrink-0 mt-0.5" aria-hidden="true" />}
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted">
                                    {isAI ? 'AI Commissioner' : banterAuthorName(m)}
                                </span>
                                {isAI && m.mood && (
                                    <span className="font-display font-bold uppercase text-[9px] tracking-[0.08em] text-faint">
                                        {m.mood}
                                    </span>
                                )}
                                <span className="text-[10px] text-faint">{formatBanterTime(m.timestamp)}</span>
                                {isPinned && (
                                    <span className="inline-flex items-center gap-1 font-display font-bold uppercase text-[9px] tracking-[0.08em] text-gold-700 dark:text-gold-300">
                                        <Pin size={9} aria-hidden="true" /> Pinned
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 whitespace-pre-wrap break-words">{m.text}</p>
                        </div>
                        {canPin && m.id && (
                            <button
                                type="button"
                                onClick={() => onTogglePin?.(isPinned ? '' : m.id!)}
                                disabled={pinningId === m.id}
                                aria-pressed={isPinned}
                                aria-label={isPinned ? 'Unpin this message from the pool home page' : 'Pin this message to the top of the pool home page'}
                                title={isPinned ? 'Unpin from pool home' : 'Pin to the top of pool home'}
                                className={`shrink-0 rounded p-1 disabled:opacity-40 ${
                                    isPinned ? 'text-gold-700 dark:text-gold-300' : 'text-faint hover:text-gold-700 dark:hover:text-gold-300'
                                }`}
                            >
                                {isPinned
                                    ? <PinOff size={13} aria-hidden="true" />
                                    : <Pin size={13} aria-hidden="true" />}
                            </button>
                        )}
                        {canDelete && m.id && (
                            <button
                                type="button"
                                onClick={() => onDelete?.(m.id!)}
                                disabled={deletingId === m.id}
                                aria-label={`Delete this message from ${isAI ? 'the AI Commissioner' : banterAuthorName(m)}`}
                                className="shrink-0 rounded p-1 text-faint hover:text-brandred-600 disabled:opacity-40"
                            >
                                <Trash2 size={13} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
