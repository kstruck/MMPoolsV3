/**
 * Turns a pool's stored branding into the handful of CSS values the dashboard
 * actually paints (PLAN-WIZARD-BUYFLOW-FIXES T1, Kevin's issue 1).
 *
 * The defect: the wizard collected `branding.primaryColor` and
 * `branding.secondaryColor`, the payload stored them faithfully — and then the
 * NFL dashboard read DIFFERENT fields. Page background came from
 * `branding.bgColor`, a field no wizard collects; `secondaryColor` drove only a
 * 2px active-tab underline; and `primaryColor` had **no renderer at all** (its
 * only occurrences in `src/` were the wizard field and its help copy). Logo
 * worked, colours appeared to do nothing. Designed-broken, not data loss.
 *
 * ⚠️ Everything here VALIDATES before it returns. A commissioner typing
 * `blue` or `#12` used to style nothing silently; now a bad value falls back to
 * the theme default and the wizard tells them, so "my colour did nothing" can
 * only mean they did not pick one.
 */

/** The gold the pool chrome uses when a pool has chosen no accent. */
export const DEFAULT_ACCENT = '#C9A867';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * A valid CSS hex colour, or undefined. Deliberately hex-only rather than
 * "anything the browser accepts": these values are also fed to `<input
 * type="color">`, which silently rewrites anything else to `#000000`, and they
 * are mixed into rgba() tints below, which needs the channels.
 */
export function normalizeHex(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!HEX.test(trimmed)) return undefined;
    // Expand #abc → #aabbcc so downstream channel maths has one shape to read.
    if (trimmed.length === 4) {
        const [, r, g, b] = trimmed;
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
}

export function isValidHex(value: unknown): boolean {
    return normalizeHex(value) !== undefined;
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`. Returns undefined for anything invalid. */
export function hexToRgba(value: unknown, alpha: number): string | undefined {
    const hex = normalizeHex(value);
    if (!hex) return undefined;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Relative luminance (WCAG). Used only to decide black-vs-white text ON the
 * primary colour, so a commissioner who picks `#ffff00` still gets a readable
 * button instead of white-on-yellow.
 */
export function relativeLuminance(value: unknown): number | undefined {
    const hex = normalizeHex(value);
    if (!hex) return undefined;
    const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => {
        const v = parseInt(c, 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Black or white, whichever is readable on `value`. Defaults to white. */
export function readableTextOn(value: unknown): string {
    const lum = relativeLuminance(value);
    if (lum === undefined) return '#ffffff';
    // 0.45 rather than the naive 0.5: the WCAG curve puts mid greys and
    // saturated blues/reds below it, where white is the better contrast.
    return lum > 0.45 ? '#111111' : '#ffffff';
}

export interface PoolBranding {
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    /** Legacy: a literal page background some older pools carry. */
    bgColor?: string;
}

export interface BrandingStyles {
    /** The pool's chosen primary, or undefined when it has none/an invalid one. */
    primary?: string;
    /** The accent for underlines and secondary highlights. Never undefined. */
    accent: string;
    /** True when the pool set a usable primary — i.e. anything is themed at all. */
    themed: boolean;
    /** Inline style for the page shell. */
    page: { backgroundColor?: string };
    /** Inline style for the pool header card. */
    headerCard: { borderColor?: string; boxShadow?: string; background?: string };
    /** Inline style for a primary action button. */
    primaryButton: { backgroundColor?: string; color?: string; borderColor?: string };
    /** Inline style for the ACTIVE tab underline. */
    activeTabUnderline: { borderBottomColor: string };
}

/**
 * The resolution order, which is the part worth reading:
 *
 *  - accent  ← `secondaryColor`, else `primaryColor`, else the theme gold. A
 *    pool that set only a primary still gets a matching underline rather than
 *    an unrelated gold one.
 *  - page    ← legacy `bgColor` if present (those pools already look that way
 *    and changing it under them is not this ticket), else a very light tint of
 *    the primary. The tint is 6% so it reads as "this pool has a colour",
 *    never as a background that fights the card surfaces or the dark theme.
 *  - header  ← primary border plus a soft glow of the same colour.
 *  - button  ← solid primary with automatically readable text.
 *
 * Every branch is undefined-safe: with no branding at all, every style object
 * is empty except the underline, which is the pre-existing gold — i.e. today's
 * appearance exactly.
 */
export function brandingStyles(branding: PoolBranding | null | undefined): BrandingStyles {
    const primary = normalizeHex(branding?.primaryColor);
    const secondary = normalizeHex(branding?.secondaryColor);
    const legacyBg = normalizeHex(branding?.bgColor);

    const accent = secondary || primary || DEFAULT_ACCENT;

    return {
        primary,
        accent,
        themed: !!primary,
        page: {
            backgroundColor: legacyBg || (primary ? hexToRgba(primary, 0.06) : undefined),
        },
        headerCard: primary
            ? { borderColor: hexToRgba(primary, 0.55), boxShadow: `0 1px 24px ${hexToRgba(primary, 0.14)}` }
            : {},
        primaryButton: primary
            ? { backgroundColor: primary, color: readableTextOn(primary), borderColor: primary }
            : {},
        activeTabUnderline: { borderBottomColor: accent },
    };
}
