/**
 * Text on the fixed cream surface (`bg-[#FBF3E0]`) must not follow the theme.
 *
 * Kevin, 2026-11-19: on the squares pool page the "In The Money:" banner was
 * unreadable in dark mode. The pill's background is a hard-coded light cream,
 * but the winner's name used `text-[color:var(--text)]`, which turns near-white
 * (#EDF1F8) in the dark theme: white text on cream.
 *
 * The cream does not change with the theme, so neither may its text. This
 * scans every element whose class list paints that cream and fails if the
 * same element, or a direct child span of the banner, uses a theme-following
 * text color (`var(--text)`) or a `dark:text-*` override.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const root = resolve(__dirname, '..');
const src = resolve(root, 'src');

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
    });
}

const CREAM = 'bg-[#FBF3E0]';
const THEMED = /var\(--text\)|dark:text-/;

describe('cream surface keeps fixed, dark text', () => {
    const files = walk(src);

    it('finds the cream surfaces it is meant to guard', () => {
        const hits = files.filter((f) => readFileSync(f, 'utf8').includes(CREAM));
        expect(hits.length).toBeGreaterThan(0);
    });

    it('no cream-surface element uses a theme-following text color', () => {
        const bad: string[] = [];
        for (const f of files) {
            const text = readFileSync(f, 'utf8');
            for (const m of text.matchAll(/className="([^"]*)"/g)) {
                const cls = m[1];
                if (cls.includes(CREAM) && THEMED.test(cls)) {
                    bad.push(`${relative(root, f)}: ${cls}`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it('the In The Money winner name uses fixed ink, not var(--text)', () => {
        const route = readFileSync(resolve(src, 'components/routes/PoolRoute.tsx'), 'utf8');
        const banner = route.match(/In The Money: <span className="([^"]*)">\{latestWinner\}/);
        expect(banner, 'In The Money banner span not found').not.toBeNull();
        expect(banner![1]).toContain('text-ink');
        expect(banner![1]).not.toMatch(THEMED);
    });
});
