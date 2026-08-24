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
            ['mmp-crest-small.webp', 20_000],       // header logo, loads on every page
            ['nfl-pools-hero.webp', 150_000],
            ['hero-ui.webp', 100_000],
            ['placeholder-team.png', 50_000],       // scoreboard fallback, shrunk in place
        ];
        for (const [f, cap] of caps) {
            expect(fs.statSync(path.join(PUB, f)).size, `${f} exceeds its ${cap}B budget`).toBeLessThan(cap);
        }
    });

    it('vendor-charts stays out of manualChunks (recharts must not preload on landing)', () => {
        const text = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
        expect(text).not.toMatch(/'vendor-charts':/);
    });
});
