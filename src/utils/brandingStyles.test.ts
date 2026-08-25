import { describe, it, expect } from 'vitest';
import {
    brandingStyles,
    normalizeHex,
    isValidHex,
    hexToRgba,
    readableTextOn,
    relativeLuminance,
    DEFAULT_ACCENT,
    PAGE_TINT_ALPHA,
    contrastRatio,
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
        expect(b.page.backgroundColor).toBe(`rgba(79, 70, 229, ${PAGE_TINT_ALPHA})`);
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
        expect(b.page.backgroundColor).toBe(`rgba(79, 70, 229, ${PAGE_TINT_ALPHA})`);
    });

    it('a yellow primary still yields a readable button', () => {
        expect(brandingStyles({ primaryColor: '#ffff00' }).primaryButton.color).toBe('#111111');
    });
});

describe('the branded header band (Kevin 2026-08-24, option (ii))', () => {
    it('paints BOTH its own background and its own text colour', () => {
        // This is the property the whole decision rests on: the band reads no
        // theme token, so it cannot be wrong in light mode or dark mode. A
        // background with no colour beside it would inherit `--text` and be
        // exactly the silent-contrast-failure a full page background risks.
        const b = brandingStyles({ primaryColor: '#0b1d3a' });
        expect(b.headerBand.backgroundColor).toBe('#0b1d3a');
        expect(b.headerBand.color).toBe('#ffffff');
    });

    it('flips the text to black on a light pick', () => {
        expect(brandingStyles({ primaryColor: '#ffff00' }).headerBand.color).toBe('#111111');
        expect(brandingStyles({ primaryColor: '#ffffff' }).headerBand.color).toBe('#111111');
    });

    it('gives secondary band text the SAME ink, FULLY OPAQUE (codex r3)', () => {
        // Not `text-muted` (tuned against `--card`, not against this band), and
        // not a dimmed version of the ink either: `opacity` composites the ink
        // back toward the primary and destroys the contrast choice
        // `readableTextOn` just made. On #007f7f, white at 75% drops the 12px
        // label below a readable ratio.
        for (const hex of ['#ffff00', '#007f7f', '#0b1d3a', '#4f46e5']) {
            const b = brandingStyles({ primaryColor: hex });
            expect(b.headerBandMuted.color).toBe(b.headerBand.color);
            expect(b.headerBandMuted).not.toHaveProperty('opacity');
        }
    });

    it('is EMPTY with no primary, so the header renders as it always did', () => {
        expect(brandingStyles(undefined).headerBand).toEqual({});
        expect(brandingStyles(undefined).headerBandMuted).toEqual({});
        expect(brandingStyles({ secondaryColor: '#ff0000' }).headerBand).toEqual({});
    });

    it('an invalid primary gets no band rather than a broken one', () => {
        expect(brandingStyles({ primaryColor: 'blue' }).headerBand).toEqual({});
        expect(brandingStyles({ primaryColor: '#12' }).headerBand).toEqual({});
    });

    it('the page tint is perceptible now', () => {
        // 0.06 was invisible on the dark navy theme, which is the complaint
        // this change answers. The band does the work; the tint just has to not
        // look broken.
        expect(PAGE_TINT_ALPHA).toBeGreaterThan(0.06);
        expect(brandingStyles({ primaryColor: '#4f46e5' }).page.backgroundColor)
            .toBe(`rgba(79, 70, 229, ${PAGE_TINT_ALPHA})`);
    });

    it('a legacy bgColor still wins the page, untouched by the tint change', () => {
        expect(brandingStyles({ bgColor: '#101010', primaryColor: '#4f46e5' }).page.backgroundColor)
            .toBe('#101010');
    });
});

describe('readableTextOn picks the HIGHER-CONTRAST ink, not a threshold (codex)', () => {
    /**
     * The old rule was `lum > 0.45 ? black : white`. The true crossover — where
     * white-on-colour and black-on-colour are equally legible — is at a relative
     * luminance of about 0.19, so every mid-tone between 0.19 and 0.45 was given
     * white text when black was better, sometimes below the WCAG AA floor.
     */
    const lumOf = (hex: string) => relativeLuminance(hex)!;
    const ratioTo = (hex: string, ink: string) => contrastRatio(lumOf(hex), lumOf(ink));

    it('teal — the case that was actually broken', () => {
        // white 3.2:1 (under the 4.5:1 AA floor) vs black 6.5:1.
        expect(readableTextOn('#00a0a0')).toBe('#111111');
        expect(ratioTo('#00a0a0', '#111111')).toBeGreaterThan(ratioTo('#00a0a0', '#ffffff'));
    });

    it('saturated blue still gets white — the old comment’s intent survives', () => {
        expect(readableTextOn('#0000ff')).toBe('#ffffff');
        expect(ratioTo('#0000ff', '#ffffff')).toBeGreaterThan(ratioTo('#0000ff', '#111111'));
    });

    it('the extremes are unchanged', () => {
        expect(readableTextOn('#000000')).toBe('#ffffff');
        expect(readableTextOn('#ffffff')).toBe('#111111');
        expect(readableTextOn('#ffff00')).toBe('#111111');
    });

    it('whatever it picks is the higher-contrast ink, for every hue', () => {
        // The property, rather than a list of cases: no pick may be beaten by
        // the other ink.
        const hexes = [
            '#0b1d3a', '#4f46e5', '#00a0a0', '#7f7f7f', '#c9a867', '#8b0000',
            '#006400', '#ff6600', '#123456', '#abcdef', '#333333', '#e0e0e0',
        ];
        for (const hex of hexes) {
            const chosen = readableTextOn(hex);
            const other = chosen === '#111111' ? '#ffffff' : '#111111';
            expect(ratioTo(hex, chosen)).toBeGreaterThanOrEqual(ratioTo(hex, other));
        }
    });

    it('an unusable colour still falls back to white rather than throwing', () => {
        expect(readableTextOn('blue')).toBe('#ffffff');
        expect(readableTextOn(undefined)).toBe('#ffffff');
    });

    it('contrastRatio is order-independent and spans 1..21', () => {
        expect(contrastRatio(0, 1)).toBeCloseTo(21, 5);
        expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
        expect(contrastRatio(0.5, 0.5)).toBe(1);
    });
});
