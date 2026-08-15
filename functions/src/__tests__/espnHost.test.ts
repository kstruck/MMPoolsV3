import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESPN_SITE_API } from '../lib/espnHost';

/**
 * Guard for the 2026-08-15 ESPN 403 incident (PR #443): every server-side ESPN
 * URL must be built from `ESPN_SITE_API`, and the blocked host must never come
 * back as a literal under functions/src. The first fix pasted the new host into
 * six files and missed a seventh call site (codex r1) — this is the check that
 * makes that class of miss fail loudly.
 */
const SRC = join(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });

describe('ESPN host (PR #443)', () => {
  it('the constant points at the host that answers server-side fetches', () => {
    expect(ESPN_SITE_API).toBe('https://site.web.api.espn.com/apis/site/v2/sports');
  });

  it('no non-test source under functions/src carries a site(.web).api.espn.com literal outside lib/espnHost.ts', () => {
    const offenders = walk(SRC)
      .filter((p) => !p.split('\\').join('/').endsWith('/lib/espnHost.ts'))
      .filter((p) => /site(\.web)?\.api\.espn\.com/i.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
