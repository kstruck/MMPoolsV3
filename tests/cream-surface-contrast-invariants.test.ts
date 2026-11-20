/**
 * Text on the fixed cream surface (`bg-[#FBF3E0]`) must not follow the theme.
 *
 * Kevin, 2026-11-19: on the squares pool page the "In The Money:" banner was
 * unreadable in dark mode. The pill's background is a hard-coded light cream,
 * but the winner's name used `text-[color:var(--text)]`, which turns near-white
 * (#EDF1F8) in the dark theme: white text on cream.
 *
 * The cream does not change with the theme, so neither may its text. This
 * scans every string literal in `src/**\/*.tsx` — double-quoted, single-quoted
 * or backticked, on one line or several (qodo on #797: `className={...}` and
 * wrapped template literals) — and fails if one string paints that cream AND
 * uses a theme-following text color (`var(--text)`) or a `dark:text-*`
 * override.
 *
 * A child element styled in its own string is not seen by that scan; the
 * In The Money winner name, which was such a child, is pinned by name in the
 * third test.
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
/** Every "…", '…' or `…` literal, multi-line included. */
const STRING = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Strings in `text` that paint the cream with a theme-following text color. */
export function themedCreamStrings(text: string): string[] {
    const bad: string[] = [];
    for (const m of text.matchAll(STRING)) {
        const s = m[2];
        if (s.includes(CREAM) && THEMED.test(s)) bad.push(s.replace(/\s+/g, ' ').trim());
    }
    return bad;
}

describe('cream surface keeps fixed, dark text', () => {
    const files = walk(src);

    it('finds the cream surfaces it is meant to guard', () => {
        const hits = files.filter((f) => readFileSync(f, 'utf8').includes(CREAM));
        expect(hits.length).toBeGreaterThan(0);
    });

    it('the scan sees every class-string form (qodo on #797)', () => {
        expect(themedCreamStrings('<b className="bg-[#FBF3E0] text-[color:var(--text)]" />')).toHaveLength(1);
        expect(themedCreamStrings("<b className={'bg-[#FBF3E0] dark:text-gold-400'} />")).toHaveLength(1);
        expect(themedCreamStrings('<b className={`px-2\n  bg-[#FBF3E0]\n  ${x} dark:text-white`} />')).toHaveLength(1);
        expect(themedCreamStrings('<b className={cn("bg-[#FBF3E0]", "text-gold-700")} />')).toHaveLength(0);
        expect(themedCreamStrings('<b className="bg-[#FBF3E0] text-ink" />')).toHaveLength(0);
    });

    it('no cream-surface string uses a theme-following text color', () => {
        const bad = files.flatMap((f) =>
            themedCreamStrings(readFileSync(f, 'utf8')).map((s) => `${relative(root, f)}: ${s}`),
        );
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
