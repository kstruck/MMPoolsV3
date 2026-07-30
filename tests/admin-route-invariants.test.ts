import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_TYPES } from '../shared/poolTypes';

/**
 * `/admin/:id` must have a destination for every pool type.
 *
 * `AdminRoute` branched on PROPS, NFL_PLAYOFFS, BRACKET and SQUARES — four of the
 * seven members of POOL_TYPES. The three NFL season types fell through to a
 * branch whose own comment reads "Fallback for unknown types", so a commissioner
 * clicking the cog on any NFL pool — every pool in the 2026 preseason pilot — got
 * "Admin panel is only available for SQUARES pools". Found by Kevin on the live
 * site, 2026-07-29.
 *
 * The count is what makes this a guard rather than a snapshot: adding an eighth
 * pool type without giving it an admin destination fails here instead of
 * shipping another dead end.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const ADMIN_ROUTE = read('src/components/routes/AdminRoute.tsx');

describe('AdminRoute — every pool type has a destination', () => {
  // Types AdminRoute renders a dashboard for, by explicit `type === '...'` check.
  const EXPLICIT = ['PROPS', 'NFL_PLAYOFFS', 'BRACKET', 'SQUARES'];
  // Types it redirects to their manager tab, via the shared NFL predicate.
  const REDIRECTED = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];

  it('accounts for all seven POOL_TYPES with no leftovers', () => {
    expect([...EXPLICIT, ...REDIRECTED].sort()).toEqual([...POOL_TYPES].sort());
  });

  // Asserting the COMPARISON, not just the string. 'SQUARES' also appears inside
  // the fallback's error message, so a bare toContain would pass even if its
  // branch were deleted.
  it.each(['PROPS', 'NFL_PLAYOFFS', 'BRACKET'])('compares type === %s', type => {
    expect(ADMIN_ROUTE).toContain(`currentPool.type === '${type}'`);
  });

  it('reaches SQUARES by falling through the guard clause', () => {
    expect(ADMIN_ROUTE).toContain("currentPool.type !== 'SQUARES'");
  });

  it('routes NFL season pools through the shared predicate, not a local list', () => {
    // A local ['NFL_PICKEM', ...] copy here would drift from shared/poolTypes.ts
    // the next time a type is added — the defect #319 spent a PR removing.
    expect(ADMIN_ROUTE).toContain('isNflSeasonType');
    expect(ADMIN_ROUTE).toContain("from '@shared/poolTypes'");
    for (const type of REDIRECTED) {
      expect(ADMIN_ROUTE).not.toContain(`'${type}'`);
    }
  });

  it('sends them to the manager TAB, replacing history', () => {
    expect(ADMIN_ROUTE).toMatch(/Navigate\s+to=\{`\/pool\/\$\{currentPool\.id\}\?tab=manager`\}\s+replace/);
  });

  it('keeps the ownership guard ABOVE every type branch', () => {
    // The redirect must not become a way around the permission check. If a branch
    // ever moves above it, this fails.
    const guard = ADMIN_ROUTE.indexOf('You do not have permission to manage this pool');
    expect(guard).toBeGreaterThan(-1);
    expect(ADMIN_ROUTE.indexOf('isNflSeasonType(')).toBeGreaterThan(guard);
    for (const type of ['PROPS', 'NFL_PLAYOFFS', 'BRACKET']) {
      expect(ADMIN_ROUTE.indexOf(`currentPool.type === '${type}'`)).toBeGreaterThan(guard);
    }
  });
});

describe('URL literals are well-formed', () => {
  // AdminRoute's share URL shipped as `${window.location.origin} /pool/${id} ` —
  // a space on each side of the path, so every Bracket share link carried
  // "https://host /pool/abc ". Stray whitespace inside a template literal does
  // not fail typecheck, lint, or any existing test.
  //
  // NOTE: a second reported instance of this class — backslashes in
  // ManagerDashboard's View button — was NOT real. `git log -S` showed the line
  // never contained them; it was a misread of grep output, and the false entry it
  // produced in HANDOFF is removed by this PR. The check below is written against
  // the one defect that was verified at the byte level.
  const FILES = [
    'src/components/routes/AdminRoute.tsx',
    'src/components/ManagerDashboard.tsx',
    'src/components/Dashboards/GlobalCommissionerDashboard.tsx',
  ];

  it.each(FILES)('%s builds no URL with stray whitespace or backslashes', file => {
    const src = read(file);
    // A path segment in a template literal, immediately preceded or followed by a
    // space, or written with backslashes.
    const malformed = src.match(/`[^`\n]*(?:\}\s+\/(?:pool|join|admin)|\/(?:pool|join|admin)\/[^`\n]*\s+`|\\(?:pool|join|admin))[^`\n]*`/g) ?? [];
    expect(malformed).toEqual([]);
  });

  it('the malformed-URL check is reachable', () => {
    // Both shapes, so a regex that stops matching cannot masquerade as a pass.
    const spaced = 'const url = `${window.location.origin} /pool/${identifier} `;';
    const slashed = 'window.location.href = `\\pool\\${pool.id}`;';
    const re = /`[^`\n]*(?:\}\s+\/(?:pool|join|admin)|\/(?:pool|join|admin)\/[^`\n]*\s+`|\\(?:pool|join|admin))[^`\n]*`/g;
    expect(spaced.match(re)).toHaveLength(1);
    expect(slashed.match(re)).toHaveLength(1);
  });
});
