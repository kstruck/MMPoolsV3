/**
 * `settings.gridSize` is gone (SQUARES-BACKLOG S2, the 2026-08-28 list).
 *
 * The field was declared on both the client and the functions settings type
 * and seeded as '10x10' in `src/constants.ts`, but nothing ever read it: a
 * squares grid is 10x10 by construction. The wizard stopped sending it earlier
 * (`buildSquaresPayload.test.ts`). The backlog's warning was that the next
 * person to add a "grid size" control would assume the field worked.
 *
 * This pins that the field does not come back as a declaration, a default, or
 * a reader in app code. Old pool documents in Firestore may still carry the
 * key; nothing reads it, so it is left there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const root = resolve(__dirname, '..');

const isTestFile = (p: string) =>
    /(^|[\\/])__tests__[\\/]/.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'lib' || name === 'dist') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
        else if (/\.[cm]?[jt]sx?$/.test(name) && !isTestFile(p)) out.push(p);
    }
    return out;
}

describe('settings.gridSize is removed (SQUARES-BACKLOG S2)', () => {
    it('the walk finds the app source it is meant to scan', () => {
        const files = sourceFiles(resolve(root, 'src')).map(f => relative(root, f).replace(/\\/g, '/'));
        // Guards against a walk that silently scans nothing.
        expect(files).toContain('src/constants.ts');
        expect(files).toContain('src/types/index.ts');
        const fnFiles = sourceFiles(resolve(root, 'functions/src')).map(f => relative(root, f).replace(/\\/g, '/'));
        expect(fnFiles).toContain('functions/src/types.ts');
    });

    it('no app or functions source declares, seeds or reads gridSize', () => {
        const dirs = ['src', 'functions/src', 'shared'].map(d => resolve(root, d));
        const hits = dirs
            .flatMap(sourceFiles)
            .filter(f => /\bgridSize\b/.test(readFileSync(f, 'utf8')))
            .map(f => relative(root, f).replace(/\\/g, '/'));
        expect(hits).toEqual([]);
    });
});
