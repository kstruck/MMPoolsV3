import type { BanterMessage } from '../../types';

// Pure formatting for the banter feed (PLAN-WIZARD-BUYFLOW-FIXES T9).
//
// Split out of BanterFeed.tsx rather than exported alongside the component:
// `react-refresh/only-export-components` flags a component module that also
// exports plain functions, and it is right to — fast refresh cannot tell them
// apart, so editing the helper remounts the feed.

/**
 * The byline for a row.
 *
 * `authorName` is the field T9 writes; `userName` is the LEGACY bracket-chat
 * one. This collection predates T9 and already holds documents written with
 * userId/userName, so reading only the new field would be a migration that
 * loses the old rows' bylines.
 */
export const AI_BYLINE = 'AI Commissioner';

export function banterAuthorName(m: BanterMessage): string {
    const stored = (m.authorName || m.userName || '').trim();
    if (!stored) return 'Commissioner';
    // 🛑 A HUMAN row may never print the AI's byline (codex r2 [P1]). The rule
    // refuses that write now, but rows created before it shipped are still in
    // the feed, and this is the one identity here that carries authority.
    // Checked case-insensitively because a security RULE cannot be.
    if (m.kind !== 'AI' && stored.toLowerCase() === AI_BYLINE.toLowerCase()) {
        return 'Commissioner';
    }
    return stored;
}

/** Relative time, falling back to a date past a day. Empty for a broken stamp. */
export function formatBanterTime(ts: number | undefined, now: number = Date.now()): string {
    if (!ts || !Number.isFinite(ts)) return '';
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleDateString();
}
