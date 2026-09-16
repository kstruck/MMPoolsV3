/**
 * The marketing blurb at the bottom of every member-facing email.
 *
 * ONE definition for both senders: the Cloud Functions template
 * (`functions/src/emailStyles.ts` → `renderEmailHtml`, every server email) and
 * the browser sender (`src/services/emailService.ts`, squares confirmations,
 * welcome mail, contact replies). They used to carry two copies of the same
 * sentence (Kevin, 2026-09-16: "Add a blurb at the bottom of each email").
 *
 * SEASONAL SPECIALS ARE THE PLANNED NEXT STEP (Kevin, 2026-09-16 — e.g. "Save
 * 20% — Thanksgiving Special, limited time"). This module is shaped for it and
 * deliberately stops there: `renderEmailPromoHtml` already accepts a promo with
 * an optional coupon code and end date, and `activeEmailPromo` already picks a
 * special over the default inside its window. What does not exist yet is any
 * STORE for specials — today `activeEmailPromo` is only ever called with no
 * specials, so every email gets `DEFAULT_EMAIL_PROMO`. Wiring a config doc (and
 * an admin editor) into those callers is the future change; no copy or markup
 * here needs to move for it.
 *
 * Pure and dependency-free: `shared/` is copied into `functions/src/shared`, so
 * nothing here may import from either side.
 */

export interface EmailPromo {
    /** Big line, e.g. "Run your own pool today". */
    headline: string;
    /** One supporting sentence. */
    body: string;
    /** Button text. */
    ctaText: string;
    /** Button link. Absolute URL. */
    ctaUrl: string;
    /** Optional coupon code, shown prominently (seasonal specials). */
    couponCode?: string;
    /** Special window, epoch ms. Both optional; the default promo has neither. */
    startsAt?: number;
    endsAt?: number;
}

export const EMAIL_PROMO_BASE_URL = 'https://www.marchmeleepools.com';

export const DEFAULT_EMAIL_PROMO: EmailPromo = {
    headline: 'Run your own pool today',
    body: "Pick'em, Survivor, Squares, Brackets and more — for your office, your friends, or your favorite charity.",
    ctaText: 'Start a pool at MarchMeleePools.com',
    ctaUrl: EMAIL_PROMO_BASE_URL,
};

/**
 * The promo to show at `now`: the first special whose window contains `now`,
 * else the default. A special with no `startsAt` starts immediately; one with no
 * `endsAt` never ends.
 */
export function activeEmailPromo(now: number, specials: readonly EmailPromo[] = []): EmailPromo {
    return specials.find(p => (p.startsAt ?? -Infinity) <= now && now < (p.endsAt ?? Infinity)) ?? DEFAULT_EMAIL_PROMO;
}

const esc = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** Only http(s) links reach an href — a config typo must never become `javascript:`. */
const safeUrl = (u: string): string => (/^https?:\/\//i.test(u) ? u : EMAIL_PROMO_BASE_URL);

/** "Ends Nov 30" — US Eastern, the timezone every other email date uses. */
function endsLabel(endsAt: number | undefined): string {
    if (endsAt === undefined || !Number.isFinite(endsAt)) return '';
    // The window is half-open ([startsAt, endsAt)), so the last day it runs is
    // the day of the millisecond before endsAt — a special ending at midnight
    // ET on Dec 1 reads "Ends Nov 30", not "Ends Dec 1".
    const d = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(endsAt - 1));
    return `Ends ${d}`;
}

/** The blurb as email-safe HTML: inline styles, no table, no external CSS. */
export function renderEmailPromoHtml(promo: EmailPromo = DEFAULT_EMAIL_PROMO, opts: { ctaUrl?: string } = {}): string {
    const url = esc(safeUrl(opts.ctaUrl ?? promo.ctaUrl));
    const code = promo.couponCode
        ? `<p style="margin: 10px 0 0 0; font-size: 14px; color: #0f172a;">Use code <strong style="font-size: 16px; letter-spacing: 1px; color: #4f46e5;">${esc(promo.couponCode)}</strong></p>`
        : '';
    const ends = endsLabel(promo.endsAt);
    const endsHtml = ends ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #64748b;">${esc(ends)}</p>` : '';
    return `
<div style="margin: 30px 0 10px 0; padding: 20px; background-color: #eef2ff; border: 1px solid #c7d2fe; border-radius: 10px; text-align: center;">
    <p style="margin: 0; font-size: 18px; font-weight: bold; color: #0f172a;">${esc(promo.headline)}</p>
    <p style="margin: 8px 0 0 0; font-size: 14px; color: #475569;">${esc(promo.body)}</p>
    ${code}
    <p style="margin: 14px 0 0 0;"><a href="${url}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 10px 22px; border-radius: 6px; font-weight: bold; font-size: 14px; text-decoration: none;">${esc(promo.ctaText)}</a></p>
    ${endsHtml}
</div>`.trim();
}

/** Plain-text twin for the text/plain part the browser sender writes. */
export function renderEmailPromoText(promo: EmailPromo = DEFAULT_EMAIL_PROMO, opts: { ctaUrl?: string } = {}): string {
    const lines = [promo.headline, promo.body];
    if (promo.couponCode) lines.push(`Use code ${promo.couponCode}`);
    lines.push(`${promo.ctaText}: ${safeUrl(opts.ctaUrl ?? promo.ctaUrl)}`);
    const ends = endsLabel(promo.endsAt);
    if (ends) lines.push(ends);
    return lines.join('\n');
}
