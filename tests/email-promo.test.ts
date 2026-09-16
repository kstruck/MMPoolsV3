import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    activeEmailPromo, DEFAULT_EMAIL_PROMO, renderEmailPromoHtml, renderEmailPromoText, type EmailPromo,
} from '../shared/emailPromo';
import { renderEmailHtml } from '../functions/src/emailStyles';

/**
 * Marketing blurb at the bottom of every member-facing email (Kevin,
 * 2026-09-16), shaped for seasonal coupon specials later.
 */

const THANKSGIVING: EmailPromo = {
    headline: 'Save 20% — Thanksgiving Special',
    body: 'Limited time on every pool upgrade.',
    ctaText: 'Claim the deal',
    ctaUrl: 'https://www.marchmeleepools.com/pricing',
    couponCode: 'TURKEY20',
    startsAt: Date.UTC(2026, 10, 20, 5),   // Nov 20 00:00 ET
    endsAt: Date.UTC(2026, 11, 1, 5),      // Dec 1 00:00 ET — last day Nov 30
};

describe('activeEmailPromo', () => {
    it('is the default with no specials', () => {
        expect(activeEmailPromo(Date.now())).toBe(DEFAULT_EMAIL_PROMO);
    });

    it('picks a special only inside its half-open window', () => {
        expect(activeEmailPromo(THANKSGIVING.startsAt! - 1, [THANKSGIVING])).toBe(DEFAULT_EMAIL_PROMO);
        expect(activeEmailPromo(THANKSGIVING.startsAt!, [THANKSGIVING])).toBe(THANKSGIVING);
        expect(activeEmailPromo(THANKSGIVING.endsAt! - 1, [THANKSGIVING])).toBe(THANKSGIVING);
        expect(activeEmailPromo(THANKSGIVING.endsAt!, [THANKSGIVING])).toBe(DEFAULT_EMAIL_PROMO);
    });
});

describe('renderEmailPromoHtml', () => {
    it('renders the default blurb with a link to the site', () => {
        const html = renderEmailPromoHtml();
        expect(html).toContain('Run your own pool today');
        expect(html).toContain('href="https://www.marchmeleepools.com"');
        expect(html).toContain('Start a pool at MarchMeleePools.com');
        expect(html).not.toContain('Use code');
        expect(html).not.toContain('Ends ');
        expect(html).not.toMatch(/<table/);
    });

    it('shows a coupon code and the LAST day of a special (window is half-open)', () => {
        const html = renderEmailPromoHtml(THANKSGIVING);
        expect(html).toContain('TURKEY20');
        expect(html).toContain('Ends Nov 30');
        expect(renderEmailPromoText(THANKSGIVING)).toBe(
            'Save 20% — Thanksgiving Special\nLimited time on every pool upgrade.\nUse code TURKEY20\nClaim the deal: https://www.marchmeleepools.com/pricing\nEnds Nov 30',
        );
    });

    it('escapes promo text and refuses a non-http link', () => {
        const html = renderEmailPromoHtml({ ...DEFAULT_EMAIL_PROMO, headline: '<script>x</script>', couponCode: '"><b>', ctaUrl: 'javascript:alert(1)' });
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('"><b>');
        expect(html).not.toContain('javascript:');
        expect(html).toContain('href="https://www.marchmeleepools.com"');
    });

    it('uses an override link (referral) when given', () => {
        expect(renderEmailPromoHtml(DEFAULT_EMAIL_PROMO, { ctaUrl: 'https://www.marchmeleepools.com?ref=ABC' }))
            .toContain('href="https://www.marchmeleepools.com?ref=ABC"');
    });
});

describe('every email template ends with the blurb', () => {
    it('renderEmailHtml (all server emails) carries the promo, the logo at the top, and unsubscribe last', () => {
        const html = renderEmailHtml('Title', '<p>Body</p>', 'https://x', 'Go');
        const logo = html.indexOf('/email-logo.png');
        const body = html.indexOf('<p>Body</p>');
        const promo = html.indexOf('Run your own pool today');
        const unsub = html.indexOf('{{UNSUB_URL}}');
        expect(logo).toBeGreaterThan(-1);
        expect(logo).toBeLessThan(body);
        expect(body).toBeLessThan(promo);
        expect(promo).toBeLessThan(unsub);
        expect(html).not.toContain('Want to create and host your own pool?');
    });

    it('the browser sender uses the same shared blurb, not its own copy', () => {
        const src = readFileSync(join(__dirname, '..', 'src', 'services', 'emailService.ts'), 'utf8');
        expect(src).toContain("from '@shared/emailPromo'");
        expect(src).toContain('renderEmailPromoHtml(promo, { ctaUrl })');
        expect(src).not.toContain('Want to create and host your own pool?');
    });
});
