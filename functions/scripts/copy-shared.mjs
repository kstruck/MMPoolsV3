// Copies the repo-root shared/ contract source into functions/src/shared/ so
// tsc (rootDir=src) can compile it and `firebase deploy` bundles it. Runs as the
// first step of `npm run build` (firebase.json predeploy calls that). The copy
// target is generated — gitignored, never edited by hand. Skips tests, dist,
// tsconfig/package (the standalone-package scaffolding shared/ uses for its own
// self-checks, irrelevant inside functions).
import { cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', '..', 'shared');
const destRoot = path.resolve(here, '..', 'src', 'shared');

const SKIP = new Set(['__tests__', 'dist', 'node_modules', 'tsconfig.json', 'package.json', '.gitignore']);

await rm(destRoot, { recursive: true, force: true });
await mkdir(destRoot, { recursive: true });
await cp(srcRoot, destRoot, {
  recursive: true,
  filter: (source) => {
    const rel = path.relative(srcRoot, source);
    if (!rel) return true;
    const top = rel.split(path.sep)[0];
    return !SKIP.has(top);
  },
});

console.log(`[copy-shared] ${srcRoot} -> ${destRoot}`);
