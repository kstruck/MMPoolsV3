import { describe, it, expect } from 'vitest';
import { banterAuthorName, formatBanterTime } from './banterFormat';

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
