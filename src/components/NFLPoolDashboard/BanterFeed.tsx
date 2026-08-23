import React from 'react';
import { Megaphone, Sparkles, Trash2 } from 'lucide-react';
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
 * `canDelete` is the only difference between them.
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
    /** Copy for the empty state; the manager view and the member view differ. */
    emptyText: string;
    maxHeightClass?: string;
}

export const BanterFeed: React.FC<BanterFeedProps> = ({
    messages,
    canDelete = false,
    onDelete,
    deletingId = null,
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
                return (
                    <div
                        key={m.id}
                        className="p-3.5 bg-page border border-line rounded-lg font-body text-xs text-[color:var(--text)] leading-relaxed flex items-start gap-2"
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
                            </div>
                            <p className="mt-1 whitespace-pre-wrap break-words">{m.text}</p>
                        </div>
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
