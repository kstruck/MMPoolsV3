import { describe, it, expect } from 'vitest';
import { banterAuthorName, formatBanterTime, AI_BYLINE } from './banterFormat';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T9 — the two decisions the feed row makes that are
 * not markup.
 */

describe('banterAuthorName', () => {
    it('prefers the new authorName field', () => {
        expect(banterAuthorName({ authorName: 'Kevin', text: '', timestamp: 0 })).toBe('Kevin');
    });

    it('falls back to the LEGACY userName so old bracket-chat rows still render', () => {
        // The collection predates T9 and already holds documents written with
        // userId/userName. A migration to read one field would be a migration
        // to lose the other's rows.
        expect(banterAuthorName({ userName: 'Old Row', text: '', timestamp: 0 })).toBe('Old Row');
    });

    it('prefers authorName when BOTH are present', () => {
        expect(banterAuthorName({ authorName: 'New', userName: 'Old', text: '', timestamp: 0 })).toBe('New');
    });

    it('a HUMAN row may not print the AI byline (codex r2 [P1])', () => {
        // The rule refuses that write now, but rows created before it shipped
        // are still in the feed, and this is the one identity here that carries
        // authority. Case-insensitive, which a security rule cannot be.
        expect(banterAuthorName({ authorName: 'AI Commissioner', kind: 'COMMISSIONER', text: '', timestamp: 0 })).toBe('Commissioner');
        expect(banterAuthorName({ authorName: 'ai commissioner', text: '', timestamp: 0 })).toBe('Commissioner');
        expect(banterAuthorName({ userName: 'AI COMMISSIONER', text: '', timestamp: 0 })).toBe('Commissioner');
    });

    it('the real AI row keeps its byline', () => {
        expect(banterAuthorName({ authorName: 'AI Commissioner', kind: 'AI', text: '', timestamp: 0 })).toBe('AI Commissioner');
    });

    it('a name that merely CONTAINS the words is left alone', () => {
        // Only an exact claim is neutralised; this is a byline fix, not a filter.
        expect(banterAuthorName({ authorName: 'Not the AI Commissioner', text: '', timestamp: 0 })).toBe('Not the AI Commissioner');
    });

    it('never renders an empty byline', () => {
        expect(banterAuthorName({ text: '', timestamp: 0 })).toBe('Commissioner');
        expect(banterAuthorName({ authorName: '   ', text: '', timestamp: 0 })).toBe('Commissioner');
    });
});

describe('formatBanterTime', () => {
    const NOW = 1_700_000_000_000;
    const MIN = 60_000;

    it('reads as just now under a minute', () => {
        expect(formatBanterTime(NOW - 30_000, NOW)).toBe('just now');
        expect(formatBanterTime(NOW, NOW)).toBe('just now');
    });

    it('counts minutes, then hours', () => {
        expect(formatBanterTime(NOW - 5 * MIN, NOW)).toBe('5m ago');
        expect(formatBanterTime(NOW - 59 * MIN, NOW)).toBe('59m ago');
        expect(formatBanterTime(NOW - 60 * MIN, NOW)).toBe('1h ago');
        expect(formatBanterTime(NOW - 23 * 60 * MIN, NOW)).toBe('23h ago');
    });

    it('falls back to a date past a day', () => {
        expect(formatBanterTime(NOW - 25 * 60 * MIN, NOW)).toMatch(/\d/);
        expect(formatBanterTime(NOW - 25 * 60 * MIN, NOW)).not.toContain('ago');
    });

    it('renders nothing rather than NaN for a missing or broken timestamp', () => {
        expect(formatBanterTime(undefined, NOW)).toBe('');
        expect(formatBanterTime(Number.NaN, NOW)).toBe('');
        expect(formatBanterTime(0, NOW)).toBe('');
    });
});

describe('AI_BYLINE', () => {
    it('is the exact string the functions writer stamps', () => {
        // If these drift, the guard above stops matching and impersonation
        // silently becomes possible again.
        expect(AI_BYLINE).toBe('AI Commissioner');
    });
});
