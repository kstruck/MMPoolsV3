import { describe, it, expect } from 'vitest';
import {
    brandingStyles,
    normalizeHex,
    isValidHex,
    hexToRgba,
    readableTextOn,
    relativeLuminance,
    DEFAULT_ACCENT,
} from './brandingStyles';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T1 (Kevin's issue 1) — "branding page colors do
 * nothing visible". The wizard stored `primaryColor` and `secondaryColor`
 * faithfully; the dashboard read `bgColor` (a field no wizard collects) for the
 * page, gave `secondaryColor` a 2px tab underline, and had NO renderer for
 * `primaryColor` at all.
 */

describe('normalizeHex', () => {
    it('accepts 6-digit hex, lowercased', () => {
        expect(normalizeHex('#4F46E5')).toBe('#4f46e5');
    });

    it('expands 3-digit shorthand so channel maths has one shape', () => {
        expect(normalizeHex('#abc')).toBe('#aabbcc');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeHex('  #4f46e5 ')).toBe('#4f46e5');
    });

    it.each([
        ['a colour name', 'blue'],
        ['a truncated hex', '#12'],
        ['a 5-digit hex', '#12345'],
        ['no hash', '4f46e5'],
        ['non-hex characters', '#gggggg'],
        ['an empty string', ''],
        ['whitespace', '   '],
        ['a number', 123],
        ['null', null],
        ['undefined', undefined],
        ['an object', {}],
    ])('rejects %s', (_label, value) => {
        expect(normalizeHex(value)).toBeUndefined();
        expect(isValidHex(value)).toBe(false);
    });
});

describe('hexToRgba', () => {
    it('splits the channels correctly', () => {
        expect(hexToRgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    });

    it('works from shorthand', () => {
        expect(hexToRgba('#f80', 1)).toBe('rgba(255, 136, 0, 1)');
    });

    it('returns undefined rather than a broken rgba() string', () => {
        // An `rgba(NaN, ...)` would be dropped by the browser silently — the
        // exact failure mode this whole ticket is about.
        expect(hexToRgba('blue', 0.5)).toBeUndefined();
    });
});

describe('readableTextOn', () => {
    it('puts dark text on a light colour', () => {
        expect(readableTextOn('#ffff00')).toBe('#111111');
        expect(readableTextOn('#ffffff')).toBe('#111111');
    });

    it('puts light text on a dark colour', () => {
        expect(readableTextOn('#000000')).toBe('#ffffff');
        expect(readableTextOn('#4f46e5')).toBe('#ffffff');
    });

    it('defaults to white when the colour is unusable', () => {
        expect(readableTextOn('nonsense')).toBe('#ffffff');
    });

    it('luminance is undefined for a bad colour, not 0', () => {
        // 0 would read as "black", and black is a legitimate choice.
        expect(relativeLuminance('nonsense')).toBeUndefined();
        expect(relativeLuminance('#000000')).toBe(0);
    });
});

describe('brandingStyles — the fallback order', () => {
    it('an unbranded pool looks exactly like today: nothing styled, gold underline', () => {
        const b = brandingStyles(undefined);
        expect(b.themed).toBe(false);
        expect(b.primary).toBeUndefined();
        expect(b.accent).toBe(DEFAULT_ACCENT);
        expect(b.page).toEqual({ backgroundColor: undefined });
        expect(b.headerCard).toEqual({});
        expect(b.primaryButton).toEqual({});
        expect(b.activeTabUnderline).toEqual({ borderBottomColor: DEFAULT_ACCENT });
    });

    it('a primary alone themes the page, header and buttons AND the accent', () => {
        // A pool that set only a primary should not get an unrelated gold
        // underline — that is the "my colours did nothing" complaint again.
        const b = brandingStyles({ primaryColor: '#4f46e5' });
        expect(b.themed).toBe(true);
        expect(b.accent).toBe('#4f46e5');
        expect(b.page.backgroundColor).toBe('rgba(79, 70, 229, 0.06)');
        expect(b.headerCard.borderColor).toBe('rgba(79, 70, 229, 0.55)');
        expect(b.primaryButton.backgroundColor).toBe('#4f46e5');
        expect(b.primaryButton.color).toBe('#ffffff');
    });

    it('a secondary wins the accent over the primary', () => {
        const b = brandingStyles({ primaryColor: '#4f46e5', secondaryColor: '#0ea5e9' });
        expect(b.accent).toBe('#0ea5e9');
        expect(b.primaryButton.backgroundColor).toBe('#4f46e5');
    });

    it('a secondary ALONE does not theme the page — it is an accent, not a brand', () => {
        const b = brandingStyles({ secondaryColor: '#0ea5e9' });
        expect(b.themed).toBe(false);
        expect(b.accent).toBe('#0ea5e9');
        expect(b.page.backgroundColor).toBeUndefined();
        expect(b.primaryButton).toEqual({});
    });

    it('legacy bgColor still wins the page background', () => {
        // Those pools already look that way; changing it under them is not this
        // ticket. The primary still themes the header and buttons.
        const b = brandingStyles({ bgColor: '#101820', primaryColor: '#4f46e5' });
        expect(b.page.backgroundColor).toBe('#101820');
        expect(b.headerCard.borderColor).toBe('rgba(79, 70, 229, 0.55)');
    });

    it('an INVALID primary falls back rather than emitting broken CSS', () => {
        const b = brandingStyles({ primaryColor: 'blue', secondaryColor: 'not-a-colour' });
        expect(b.themed).toBe(false);
        expect(b.accent).toBe(DEFAULT_ACCENT);
        expect(b.page.backgroundColor).toBeUndefined();
        expect(b.primaryButton).toEqual({});
    });

    it('an invalid bgColor does not blank the page', () => {
        const b = brandingStyles({ bgColor: 'transparent', primaryColor: '#4f46e5' });
        expect(b.page.backgroundColor).toBe('rgba(79, 70, 229, 0.06)');
    });

    it('a yellow primary still yields a readable button', () => {
        expect(brandingStyles({ primaryColor: '#ffff00' }).primaryButton.color).toBe('#111111');
    });
});
