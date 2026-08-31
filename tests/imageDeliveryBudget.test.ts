import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 2026-08-23 perf audit, item 22 (Lighthouse mobile 46, LCP 11.2s, CLS 0.238;
 * TBT already 0 — so this is network weight and layout shift, not JS).
 *
 * Separate file from tests/imagePerfBudget.test.ts on purpose: that one pins
 * the #551 header/hero diet, this one pins the item-22 round (article webp
 * twins, `loading="lazy"` on below-the-fold imagery, and the intrinsic
 * width/height that stops the hero/feature images reserving zero space).
 */
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const bytes = (f: string) => fs.statSync(path.join(PUB, f)).size;

/** Pull the attribute soup of the <img> whose `src` is `src`. */
function imgTag(fileText: string, src: string): string {
    const idx = fileText.indexOf(`src="${src}"`);
    expect(idx, `no <img src="${src}"> found`).toBeGreaterThan(-1);
    const open = fileText.lastIndexOf('<img', idx);
    const close = fileText.indexOf('/>', idx);
    expect(open, `malformed <img> around ${src}`).toBeGreaterThan(-1);
    expect(close, `malformed <img> around ${src}`).toBeGreaterThan(idx);
    return fileText.slice(open, close);
}

describe('image delivery budget (audit item 22)', () => {
    it('the bracket infographic has a webp twin and it is the one referenced', () => {
        // 691KB original (a JPEG carrying a .png name) -> 100KB webp.
        expect(bytes('images/bracket-pool-features.webp')).toBeLessThan(150_000);
        const article = read('src/components/articles/BracketPoolGuideArticle.tsx');
        expect(article).toContain('/images/bracket-pool-features.webp');
        expect(article, 'the heavyweight original must not be referenced')
            .not.toContain('/images/bracket-pool-features.png');
    });

    it('og-image.png keeps its name, path and declared aspect ratio', () => {
        // Item 22d was REJECTED — see the PR body. The filename is load-bearing
        // (index.html, seoConfig.ts, functions/joinPreview.helpers.ts), PNG
        // cannot reach the ~100KB target for this full-bleed diagonal gradient
        // with the tooling in this repo, and shrinking it further widens an
        // EXISTING mismatch: index.html and SEO.tsx both declare
        // og:image:width=1200 / height=630 while the file is 1024x1024.
        //
        // This pin is the guard on that: whoever regenerates the artwork must
        // make the file agree with the meta rather than drift further from it.
        expect(fs.existsSync(path.join(PUB, 'og-image.png'))).toBe(true);
        expect(read('index.html')).toContain('/og-image.png');
        const declared = read('index.html').match(/og:image:width" content="(\d+)"/);
        expect(declared, 'index.html declares og:image:width').not.toBeNull();
        const [w, h] = pngSize(path.join(PUB, 'og-image.png'));
        // Not yet equal to the declared 1200x630 — that needs a re-layout, and
        // is Kevin's call. Pinned at today's value so the drift is visible.
        expect([w, h]).toEqual([1024, 1024]);
        expect(bytes('og-image.png')).toBeLessThanOrEqual(382_385);
    });

    it('both article images are lazy and reserve their space', () => {
        const cases: Array<[string, string]> = [
            ['src/components/articles/BracketPoolGuideArticle.tsx', '/images/bracket-pool-features.webp'],
            ['src/components/articles/SuperBowlOddsArticle.tsx', '/images/squares-heatmap.jpg'],
            ['src/components/articles/SuperBowlOddsArticle.tsx', '/images/squares-digit-frequency.webp'],
        ];
        for (const [file, src] of cases) {
            const tag = imgTag(read(file), src);
            expect(tag, `${src} must be lazy`).toContain('loading="lazy"');
            expect(tag, `${src} must declare width`).toMatch(/width=\{\d+\}/);
            expect(tag, `${src} must declare height`).toMatch(/height=\{\d+\}/);
        }
    });

    it('hero and feature imagery declares intrinsic dimensions (CLS)', () => {
        const cases: Array<[string, string[]]> = [
            ['src/components/LandingPage.tsx', ['/nfl-pools-hero.webp']],
            ['src/components/FeaturesPage.tsx', [
                '/feature-live-grid.webp', '/feature-scoreboard.webp',
                '/feature-scenarios.webp', '/feature-setup-wizard.webp',
            ]],
            ['src/components/GamedaySquaresLanding.tsx', [
                '/hero-ui.webp', '/feature-live-grid.webp', '/feature-scoreboard.webp',
                '/feature-scenarios.webp', '/feature-setup-wizard.webp',
            ]],
        ];
        for (const [file, srcs] of cases) {
            const text = read(file);
            for (const src of srcs) {
                const tag = imgTag(text, src);
                expect(tag, `${file} ${src} must declare width`).toMatch(/width=\{\d+\}/);
                expect(tag, `${file} ${src} must declare height`).toMatch(/height=\{\d+\}/);
            }
        }
    });

    it('the declared dimensions match the files on disk', () => {
        // A wrong aspect ratio is worse than none — it reserves the wrong box
        // and the shift comes back. WebP: dimensions live in the VP8X/VP8L/VP8
        // chunk; this reads the simple-lossy and lossless forms both landing
        // pages actually use.
        const expected: Record<string, [number, number]> = {
            'nfl-pools-hero.webp': [1024, 1024],
            'hero-ui.webp': [1024, 591],
            'feature-live-grid.webp': [1024, 591],
            'feature-scoreboard.webp': [1024, 517],
            'feature-scenarios.webp': [1024, 541],
            'feature-setup-wizard.webp': [996, 986],
        };
        const files = [
            'src/components/LandingPage.tsx',
            'src/components/FeaturesPage.tsx',
            'src/components/GamedaySquaresLanding.tsx',
        ].map(read);
        for (const [name, [w, h]] of Object.entries(expected)) {
            expect(webpSize(path.join(PUB, name)), `${name} on disk`).toEqual([w, h]);
            for (const text of files) {
                if (!text.includes(`src="/${name}"`)) continue;
                const tag = imgTag(text, `/${name}`);
                expect(tag, `${name} width`).toContain(`width={${w}}`);
                expect(tag, `${name} height`).toContain(`height={${h}}`);
            }
        }
    });

    it('team-logo <img>s in list views are lazy', () => {
        const cases: Array<[string, number]> = [
            ['src/components/Scoreboard.tsx', 4],
            ['src/components/BrowsePools.tsx', 2],
            ['src/components/BracketPoolDashboard/LiveScoreTicker.tsx', 2],
        ];
        for (const [file, count] of cases) {
            const text = read(file);
            const imgs = text.match(/<img[\s\S]*?\/>/g) ?? [];
            const logos = imgs.filter((t) => /logo|placeholder-team/i.test(t));
            expect(logos.length, `${file}: expected ${count} team-logo <img>s`).toBe(count);
            for (const tag of logos) {
                expect(tag, `${file}: every team logo must be lazy`).toContain('loading="lazy"');
            }
        }
    });
});

/** PNG IHDR reader — returns [width, height]. */
function pngSize(file: string): [number, number] {
    const b = fs.readFileSync(file);
    expect(b.subarray(1, 4).toString('ascii'), `${file} is not a PNG`).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Minimal WebP header reader — returns [width, height]. */
function webpSize(file: string): [number, number] {
    const b = fs.readFileSync(file);
    expect(b.subarray(0, 4).toString('ascii'), `${file} is not RIFF`).toBe('RIFF');
    expect(b.subarray(8, 12).toString('ascii'), `${file} is not WEBP`).toBe('WEBP');
    const fourcc = b.subarray(12, 16).toString('ascii');
    if (fourcc === 'VP8X') return [(b.readUIntLE(24, 3) & 0xffffff) + 1, (b.readUIntLE(27, 3) & 0xffffff) + 1];
    if (fourcc === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    if (fourcc === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    throw new Error(`${file}: unknown WebP fourcc ${fourcc}`);
}
