import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SQUARES_CREATION_OPEN, POOLS_OPEN } from '../src/config/season';
import { canAccessSquaresCreation, canAccessPoolCreation } from '../src/utils/auth';
import * as clientFlags from '../src/utils/featureFlags';
import * as serverFlags from '../functions/src/lib/featureFlags';
import type { User } from '../src/types';
import { planClaim } from '../shared/squaresClaim';

/**
 * SQUARES CREATION IS OPEN AGAIN (PLAN-SQUARES-REOPEN PR-D).
 *
 * It was closed on 2026-08-28 because a pool left on the wizard's default
 * refused every non-owner's first square. Until PR-D this file held the
 * closure shut (`squares-creation-closed.test.ts`). It now holds three things:
 *
 *   1. the gate is open, and it is open in BOTH places that have to agree —
 *      the client switch and the server's hard-closed list;
 *   2. squares still has its own switch, and the runtime flag still closes it
 *      without a deploy — that is the rollback, so it is pinned here;
 *   3. the defect that closed creation stays fixed.
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
  it('is open: whoever can create a pool can create a squares pool', () => {
    expect(SQUARES_CREATION_OPEN).toBe(true);
    for (const user of [member, superAdmin, null]) {
      expect(canAccessSquaresCreation(user)).toBe(canAccessPoolCreation(user));
    }
    expect(POOLS_OPEN).toBe(true);
    expect(canAccessSquaresCreation(member)).toBe(true);
  });

  it('is open on the SERVER too — no pool type is closed in code, in either copy', () => {
    // The client switch only hides entry points. The callable is the boundary
    // that holds, and it reads this list. One flipped without the other is a
    // wizard that walks a commissioner to a refusal, or a closed door with an
    // open window.
    expect([...clientFlags.HARD_CLOSED_POOL_TYPES]).toEqual([]);
    expect([...serverFlags.HARD_CLOSED_POOL_TYPES]).toEqual([]);
    expect(clientFlags.isPoolTypeEnabled(null, 'SQUARES')).toBe(true);
    expect(serverFlags.isPoolTypeEnabled(undefined, 'SQUARES')).toBe(true);
  });

  it('still has its OWN switch — closing squares again does not close anything else', () => {
    // The planted counter-example from the closure: had this been wired to the
    // master gate, closing squares would have taken Pick'em, Survivor and
    // Margin creation down with it.
    expect(read('src/utils/auth.ts')).toContain('return SQUARES_CREATION_OPEN && canAccessPoolCreation(user);');
    expect(read('src/config/season.ts')).toContain('export const SQUARES_CREATION_OPEN = true;');
  });
});

/**
 * THE ROLLBACK THAT NEEDS NO DEPLOY. `system/config.poolTypeFlags.SQUARES =
 * false` (Super-Admin → Pool Type Availability). The plan's rollback section
 * promises this closes squares creation at once; these hold it to that.
 */
describe('the runtime flag still closes squares, and only squares', () => {
  const off = { poolTypeFlags: { SQUARES: false } };

  it('client and server both read SQUARES as closed', () => {
    expect(clientFlags.isPoolTypeEnabled(off, 'SQUARES')).toBe(false);
    expect(serverFlags.isPoolTypeEnabled(off, 'SQUARES')).toBe(false);
  });

  it('every other type stays open under that same config', () => {
    for (const t of clientFlags.POOL_TYPES) {
      if (t === 'SQUARES') continue;
      expect(clientFlags.isPoolTypeEnabled(off, t), t).toBe(true);
      expect(serverFlags.isPoolTypeEnabled(off, t), t).toBe(true);
    }
  });

  it('only an explicit false closes it — a missing or malformed flag fails open', () => {
    for (const cfg of [null, {}, { poolTypeFlags: {} }, { poolTypeFlags: { SQUARES: 'false' } }, { poolTypeFlags: { SQUARES: 0 } }]) {
      expect(clientFlags.isPoolTypeEnabled(cfg as never, 'SQUARES')).toBe(true);
      expect(serverFlags.isPoolTypeEnabled(cfg as never, 'SQUARES')).toBe(true);
    }
  });

  it('the wizard is mounted inside the runtime gate, so a closed type is refused on arrival, not on step six', () => {
    const wizard = read('src/components/wizard/create/CreateSquaresPool.tsx');
    expect(wizard).toContain('<PoolTypeGate type="SQUARES">');
    expect(wizard).toContain('</PoolTypeGate>');
    // The gate renders its children unless the flag is exactly false.
    expect(read('src/components/PoolTypeGate.tsx')).toContain('poolTypeFlags[resolved] !== false');
  });
});

describe('every squares creation entry point consults the squares gate', () => {
  it('the /create/squares route asks the squares gate, not the master one', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('user && canAccessSquaresCreation(user) ? (');
    // The squares route specifically — not merely that the helper is imported.
    const from = app.indexOf('<Route path="/create/squares"');
    expect(from).toBeGreaterThan(-1);
    const route = app.slice(from, from + 400);
    expect(route).toContain('canAccessSquaresCreation(user)');
    expect(route).not.toContain('canAccessPoolCreation(user)');
  });

  it('the pool-type picker enables the squares card from the squares gate', () => {
    const sel = read('src/components/CreatePoolSelection.tsx');
    expect(sel).toContain('const canCreateSquares = canAccessSquaresCreation(user);');
    expect(sel).toContain('disabled={!canCreateSquares}');
    expect(sel).toContain("{canCreateSquares ? <>Setup Squares <ArrowRight size={14} /></> : 'Coming Soon'}");
  });

  it('every button on the squares landing page follows the squares gate', () => {
    const landing = read('src/components/GamedaySquaresLanding.tsx');
    // The master gate must not appear at all: with it, a button would stay
    // live the day squares is closed again.
    expect(landing).not.toContain('canAccessPoolCreation');
    const gated = landing.match(/canAccessSquaresCreation\(user\)/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(9);   // 3 CTAs × onClick/disabled/title
  });
});

/**
 * THE DEFECT THAT CLOSED CREATION STAYS FIXED (PLAN-SQUARES-REOPEN A1).
 *
 * With the gate open, a regression of the zero-guard is the unplayable pool
 * again — on a product people can now buy.
 */
describe('the claim-limit defect stays fixed now that creation is open', () => {
  it('a non-owner can take their first square on a pool stored at 0', () => {
    const grid = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null as string | null }));
    const plan = planClaim({
      squares: grid,
      squareIds: [0],
      identity: { uid: null, guestKeyHash: null },
      displayName: 'First Player',
      maxSquaresPerPlayer: 0,
      exemptFromCap: false,
      now: 1,
    });
    expect(plan.ok).toBe(true);
  });

  it('the callable routes through that planner', () => {
    const fn = read('functions/src/squares.ts');
    expect(fn).toContain('planClaim(');
    expect(fn).not.toContain('mySquares >= pool.maxSquaresPerPlayer');
  });

  it('and the wizard still defaults to 0, which is a playable default', () => {
    expect(read('src/components/wizard/create/CreateSquaresPool.tsx'))
      .toMatch(/maxSquaresPerPlayer:\s*0/);
  });
});
