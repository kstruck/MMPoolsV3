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
export function banterAuthorName(m: BanterMessage): string {
    return (m.authorName || m.userName || 'Commissioner').trim() || 'Commissioner';
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
