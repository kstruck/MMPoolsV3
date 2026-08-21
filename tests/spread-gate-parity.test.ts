import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { poolUsesSpreads as client } from '../src/utils/poolUsesSpreads';
import { poolUsesSpreads as server } from '../functions/src/nflScoringEngine';

/**
 * Spread-gate parity — the client mirror and the functions source of truth.
 *
 * `submitNFLPicks` throws SPREADS_NOT_LOCKED only for pools whose scoring reads
 * `game.spread`, scoped that way in #214. The three member pick sheets had a
 * SEPARATE, UNCONDITIONAL copy of that gate that refused to render for every
 * pool type and mode — so straight-up pick'em, Survivor and Margin were locked
 * out of any week without betting lines even though the server would have
 * accepted their picks. That is the whole 2026 preseason: the feed carries a
 * line on 1 of 49 games.
 *
 * The two predicates live in module-incompatible TS roots and cannot import one
 * another, and moving the rule to `shared/` would drag a functions deploy along
 * with every frontend change. So it is duplicated on purpose and pinned here,
 * the same arrangement as `tests/feature-flags-parity.test.ts`.
 *
 * This compares BEHAVIOUR over a matrix, not source text: a grep would pass on
 * two copies that had drifted in meaning.
 */

const POOL_TYPES = [
  'NFL_PICKEM',
  'NFL_SURVIVOR',
  'NFL_MARGIN',
  'NFL_PLAYOFFS',
  'SQUARES',
  'BRACKET',
  'PROPS',
] as const;

// `undefined` is the important one: pickMode is OPTIONAL and omitting it means
// STRAIGHT (shared/schemas/nfl.ts). A copy that treated it as "unknown, so
// block" would fail here rather than in production on a wizard-created pool.
const PICK_MODES = [undefined, 'STRAIGHT', 'ATS', '', 'ats', 'FOO'] as const;

describe('poolUsesSpreads parity (client mirror vs functions source of truth)', () => {
  it('agrees on every (poolType × pickMode) combination', () => {
    for (const type of POOL_TYPES) {
      for (const pickMode of PICK_MODES) {
        const pool = { type, settings: { pickMode } };
        expect(
          client(pool),
          `disagreement on type=${type} pickMode=${String(pickMode)}`,
        ).toBe(server(pool));
      }
    }
  });

  it('agrees on the degenerate inputs a real caller can hand it', () => {
    for (const pool of [null, undefined, {}, { type: 'NFL_PICKEM' }, { settings: {} }]) {
      expect(client(pool as never)).toBe(server(pool as never));
    }
  });
});

describe('poolUsesSpreads semantics — what the gate is allowed to block', () => {
  it('blocks ONLY an ATS pick\'em pool', () => {
    expect(client({ type: 'NFL_PICKEM', settings: { pickMode: 'ATS' } })).toBe(true);
  });

  it('does not block straight-up pick\'em, Survivor or Margin', () => {
    // These three are the regression. If any flips to true, the sheets go back
    // to refusing to render on a spread-less week.
    expect(client({ type: 'NFL_PICKEM', settings: { pickMode: 'STRAIGHT' } })).toBe(false);
    expect(client({ type: 'NFL_SURVIVOR', settings: { pickMode: 'ATS' } })).toBe(false);
    expect(client({ type: 'NFL_MARGIN', settings: { pickMode: 'ATS' } })).toBe(false);
  });

  it('treats an ABSENT pickMode as STRAIGHT, not as unknown-so-block', () => {
    // The wizard omits nothing today, but legacy pools predate the field and
    // #319's NaN bug came from defaulting the other way.
    expect(client({ type: 'NFL_PICKEM' })).toBe(false);
    expect(client({ type: 'NFL_PICKEM', settings: {} })).toBe(false);
  });
});

describe('the member pick sheets no longer carry an unconditional spread gate', () => {
  const root = resolve(__dirname, '..');

  // A behavioural test on the predicate cannot prove the SHEETS consult it —
  // the original defect was a second, unconditional copy of the rule sitting
  // beside a correct server one. These greps pin that the copy is gone.
  it.each([
    'src/components/NFLPoolDashboard/SurvivorPickEntry.tsx',
    'src/components/NFLPoolDashboard/MarginPickEntry.tsx',
  ])('%s has no spread gate at all (its scoring never reads a spread)', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    expect(src).not.toMatch(/every\(g => g\.spread\?\.locked\)/);
  });

  it("PickemPickEntry gates on poolUsesSpreads, not on the slate alone", () => {
    const src = readFileSync(
      resolve(root, 'src/components/NFLPoolDashboard/PickemPickEntry.tsx'),
      'utf8',
    );
    expect(src).toMatch(/utils\/poolUsesSpreads/);
    // The gate now lives in that module as `spreadsBlockWeek`, because the
    // dashboard's Lock Status card asks the same question and the two must not
    // drift. What matters here is unchanged: the sheet consults the shared rule.
    expect(src).toMatch(/spreadsBlockWeek\(castPool, games\)/);
    // The pre-change shape: a bare `!allSpreadsLocked` early return.
    expect(src).not.toMatch(/if \(!allSpreadsLocked\)/);
    // …and the pool-type guard the sheet used to carry is still in front of it.
    const gate = readFileSync(resolve(root, 'src/utils/poolUsesSpreads.ts'), 'utf8');
    expect(gate).toMatch(/if \(!poolUsesSpreads\(pool\)\) return false;/);
  });

  it('that grep matches the string it was written to catch', () => {
    // Guard the guard — the literal source that was removed must still trip it.
    const removed = 'return games.filter(g => g.status !== \'CANCELLED\').every(g => g.spread?.locked);';
    expect(removed).toMatch(/every\(g => g\.spread\?\.locked\)/);
  });
});
