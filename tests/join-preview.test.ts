import { describe, it, expect } from 'vitest';
import { isSocialCrawler, extractPoolId, buildJoinPreviewHtml } from '../functions/src/joinPreview.helpers';

describe('join preview helpers', () => {
    it('detects social crawlers but not search engines or humans', () => {
        expect(isSocialCrawler('facebookexternalhit/1.1')).toBe(true);
        expect(isSocialCrawler('Twitterbot/1.0')).toBe(true);
        expect(isSocialCrawler('Slackbot-LinkExpanding 1.0')).toBe(true);
        expect(isSocialCrawler('WhatsApp/2.23')).toBe(true);
        // Search engines render the SPA (noindex), so they are NOT treated as social crawlers.
        expect(isSocialCrawler('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(false);
        expect(isSocialCrawler('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
        expect(isSocialCrawler(undefined)).toBe(false);
    });

    it('extracts poolId from the join path', () => {
        expect(extractPoolId('/join/abc123')).toBe('abc123');
        expect(extractPoolId('/join/abc123?ref=x')).toBe('abc123');
        expect(extractPoolId('/join/')).toBe('');
        expect(extractPoolId('/pool/abc123')).toBe('');
    });

    it('builds per-pool OG tags and escapes user content', () => {
        const html = buildJoinPreviewHtml({ poolId: 'p1', name: 'Kevin\'s "Big" Pool & Co', type: 'SQUARES' });
        expect(html).toContain('<meta property="og:title" content="Join Kevin\'s &quot;Big&quot; Pool &amp; Co — March Melee Pools"');
        expect(html).toContain('Super Bowl squares pool');
        expect(html).toContain('<link rel="canonical" href="https://www.marchmeleepools.com/join/p1"');
        expect(html).toContain('name="robots" content="noindex, follow"');
        // No raw unescaped angle brackets injected from names.
        expect(html).not.toContain('<script>');
    });

    it('falls back gracefully when name/type are missing', () => {
        const html = buildJoinPreviewHtml({ poolId: 'p2' });
        expect(html).toContain('Join a sports pool — March Melee Pools');
        expect(html).toContain('a sports pool, a sports pool');
    });
});
