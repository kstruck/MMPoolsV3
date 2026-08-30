import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SQUARES_CREATION_OPEN, POOLS_OPEN } from '../src/config/season';
import { canAccessSquaresCreation, canAccessPoolCreation } from '../src/utils/auth';
import type { User } from '../src/types';

/**
 * SQUARES CREATION IS CLOSED (Kevin, 2026-08-28).
 *
 * *"Do not allow any Squares pools from being purchased or setup for now. Add a
 * COMING SOON to those."*
 *
 * The reason: `CreateSquaresPool.tsx` defaults `maxSquaresPerPlayer` to `0`
 * while `functions/src/squares.ts:93` refuses a claim whenever
 * `mySquares >= pool.maxSquaresPerPlayer`, so a pool left on its default is
 * unplayable by anyone except its commissioner. `SQUARES-BACKLOG.md` carries
 * the fix list; this suite pins the closure until that lands.
 *
 * These assert BEHAVIOUR — who the gate admits — plus a source check on each
 * entry point, because an entry point that forgets to consult the gate is the
 * failure mode a behaviour test on the gate alone cannot see.
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const member = { id: 'u1', role: 'MEMBER' } as unknown as User;
const superAdmin = { id: 'u2', role: 'SUPER_ADMIN' } as unknown as User;

describe('the squares creation gate', () => {
  it('is closed, and closed for EVERYONE — including super admins', () => {
    // The super-admin exemption is the one difference from the master switch,
    // and it is deliberately absent: "do not allow any" is unconditional, and
    // the owner is the only player the callable's `!== userId` clause lets
    // through, so a super admin creating one would never see the failure.
    expect(SQUARES_CREATION_OPEN).toBe(false);
    expect(canAccessSquaresCreation(member)).toBe(false);
    expect(canAccessSquaresCreation(superAdmin)).toBe(false);
    expect(canAccessSquaresCreation(null)).toBe(false);
  });

  it('closes SQUARES ONLY — every other pool type still opens', () => {
    // The planted counter-example: if this switch had been wired to the master
    // gate, Pick'em/Survivor/Margin creation would have gone down with it on
    // the day Kevin was onboarding customers.
    expect(POOLS_OPEN).toBe(true);
    expect(canAccessPoolCreation(member)).toBe(true);
    expect(canAccessPoolCreation(superAdmin)).toBe(true);
  });

  it('is a build-time constant, so reopening is a commit plus a rebuild', () => {
    expect(read('src/config/season.ts')).toContain('export const SQUARES_CREATION_OPEN = false;');
  });
});

describe('every squares creation entry point consults that gate', () => {
  it('the /create/squares route bounces instead of mounting the wizard', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('user && canAccessSquaresCreation(user) ? (');
    // The squares route specifically — not merely that the helper is imported.
    const from = app.indexOf('<Route path="/create/squares"');
    expect(from).toBeGreaterThan(-1);
    const route = app.slice(from, from + 400);
    expect(route).toContain('canAccessSquaresCreation(user)');
    expect(route).not.toContain('canAccessPoolCreation(user)');
  });

  it('the pool-type picker disables the squares card and says Coming Soon', () => {
    const sel = read('src/components/CreatePoolSelection.tsx');
    expect(sel).toContain('const canCreateSquares = canAccessSquaresCreation(user);');
    expect(sel).toContain('disabled={!canCreateSquares}');
    expect(sel).toContain("{canCreateSquares ? <>Setup Squares <ArrowRight size={14} /></> : 'Coming Soon'}");
  });

  it('the squares landing page has no live create button left on it', () => {
    const landing = read('src/components/GamedaySquaresLanding.tsx');
    // Every CTA on a squares-only page must follow the squares switch. The
    // master gate must not appear at all, or one button stays live.
    expect(landing).not.toContain('canAccessPoolCreation');
    const gated = landing.match(/canAccessSquaresCreation\(user\)/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(9);   // 3 CTAs × onClick/disabled/title
    expect(landing).toContain("'Squares — Coming Soon'");
  });

  it('the wizard component is still present, so reopening is a flag flip', () => {
    // Deleting the wizard would make this a migration rather than a switch.
    expect(read('src/components/wizard/create/CreateSquaresPool.tsx')).toContain('export function CreateSquaresPool');
  });
});

/**
 * THE DEFECT THE CLOSURE EXISTS FOR, PINNED.
 *
 * If somebody fixes the callable, this goes red — which is the signal to reopen
 * creation rather than leave a "Coming Soon" on a product that works again.
 */
describe('the claim-limit defect is still there, which is why creation is closed', () => {
  it('the callable still refuses a first claim on a pool stored at 0', () => {
    const fn = read('functions/src/squares.ts');
    expect(fn).toContain('mySquares >= pool.maxSquaresPerPlayer');
    expect(fn).not.toMatch(/pool\.maxSquaresPerPlayer\s*>\s*0/);
    // The server's own comparison, applied to a non-owner's first square.
    expect(0 >= 0).toBe(true);
  });

  it('and the wizard still defaults to the value that triggers it', () => {
    expect(read('src/components/wizard/create/CreateSquaresPool.tsx'))
      .toMatch(/maxSquaresPerPlayer:\s*0/);
  });
});
