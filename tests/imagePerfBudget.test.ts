import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 2026-08-23 perf audit: the header crest was a 935KB PNG on every page and
 * 6.7MB of PNG shipped in dist. These pins keep the fixed surfaces fixed.
 */
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

// Legacy heavyweights that must never be referenced from src again — each has
// a .webp replacement. (The PNGs themselves stay in public/ so nothing
// external 404s; the delete decision is Kevin's.)
const LEGACY = [
    'mmp-crest.png', 'nfl-pools-hero.png', 'hero-ui.png', 'feature-live-grid.png',
    'feature-scoreboard.png', 'feature-scenarios.png', 'feature-setup-wizard.png',
    'squares-digit-frequency.png',
];

/** Intrinsic pixel size of a PNG (IHDR) or a VP8X-container WebP, header-only
 *  so no image dependency is needed. Both of the logo assets below are written
 *  by scripts/generate-logo-assets.py, which emits exactly these two forms. */
function imageSize(file: string): { w: number; h: number } {
    const b = fs.readFileSync(file);
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        if (b.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error(`${file}: PNG without leading IHDR`);
        return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') {
        if (b.subarray(12, 16).toString('ascii') !== 'VP8X') throw new Error(`${file}: WebP is not a VP8X container`);
        // VP8X canvas size is stored as (dimension - 1), 24-bit little-endian.
        return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
    }
    throw new Error(`${file}: not a PNG or WebP`);
}

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : /\.(tsx?|html)$/.test(e.name) ? [p] : [];
    });
}

describe('image perf budget', () => {
    it('no source file references the legacy heavyweight PNGs', () => {
        const offenders: string[] = [];
        for (const f of [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.html')]) {
            const text = fs.readFileSync(f, 'utf8');
            for (const img of LEGACY) if (text.includes(img)) offenders.push(`${f} -> ${img}`);
        }
        expect(offenders).toEqual([]);
    });

    it('the webp replacements exist and stay small', () => {
        const caps: Array<[string, number]> = [
            ['mmp-logo-mark.webp', 20_000],         // header logo, loads on every page
            ['nfl-pools-hero.webp', 150_000],
            ['hero-ui.webp', 100_000],
            ['placeholder-team.png', 50_000],       // scoreboard fallback, shrunk in place
            ['email-logo.png', 40_000],             // fetched by every email client that opens a template
        ];
        for (const [f, cap] of caps) {
            expect(fs.statSync(path.join(PUB, f)).size, `${f} exceeds its ${cap}B budget`).toBeLessThan(cap);
        }
    });

    /* 2026-08-24 Kevin ruling D3: public/mmp-logo-full.png is the master brand
       artwork, and both shipped logo assets are cut from it by
       scripts/generate-logo-assets.py. These pin the two things a regeneration
       could silently break: the intrinsic sizes Logo.tsx declares (a mismatch
       is a layout shift on every page) and the email URL contract. */
    it('nothing serves the 1.3MB master artwork to a browser', () => {
        // Naming it in a comment is fine and useful; loading it is not. Only
        // quoted URL-shaped references count.
        const offenders: string[] = [];
        for (const f of [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.html')]) {
            if (/["'`]\/?mmp-logo-full\.png["'`]/.test(fs.readFileSync(f, 'utf8'))) offenders.push(f);
        }
        expect(offenders).toEqual([]);
    });

    it('the site logo mark is the full-artwork crop at the size Logo.tsx declares', () => {
        expect(imageSize(path.join(PUB, 'mmp-logo-mark.webp'))).toEqual({ w: 161, h: 128 });

        const logo = fs.readFileSync(path.join(ROOT, 'src/components/Logo.tsx'), 'utf8');
        expect(logo).toContain('src="/mmp-logo-mark.webp"');
        expect(logo).toContain('width={161}');
        expect(logo).toContain('height={128}');
        // The live-text wordmark is load-bearing: the artwork's own wordmark is
        // dark navy on permanently navy chrome. Do not let it be deleted.
        // Match the RENDERED spans, not the prop name or the alt text — both of
        // those survive deleting the wordmark, which would make this pass on a
        // component that no longer has one.
        expect(logo).toMatch(/\{withWordmark\s*&&\s*\(/);
        expect(logo).toMatch(/>March Melee<\/span>/);
        expect(logo).toMatch(/>Pools<\/span>/);
    });

    it('the email logo keeps its path and 589x150 size class', () => {
        expect(imageSize(path.join(PUB, 'email-logo.png'))).toEqual({ w: 589, h: 150 });
        // functions/src/emailStyles.ts LOGO_URL and every already-delivered
        // email point at this exact path — the file may be regenerated, never
        // renamed or moved.
        const styles = fs.readFileSync(path.join(ROOT, 'functions/src/emailStyles.ts'), 'utf8');
        expect(styles).toContain('/email-logo.png');
        expect(fs.existsSync(path.join(PUB, 'email-logo.png'))).toBe(true);
    });

    it('the generator that produced both logo assets is committed', () => {
        const gen = fs.readFileSync(path.join(ROOT, 'scripts/generate-logo-assets.py'), 'utf8');
        expect(gen).toContain('mmp-logo-full.png');
        expect(gen).toContain('mmp-logo-mark.webp');
        expect(gen).toContain('email-logo.png');
    });

    it('vendor-charts stays out of manualChunks (recharts must not preload on landing)', () => {
        const text = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
        expect(text).not.toMatch(/'vendor-charts':/);
    });
});
