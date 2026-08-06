import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURRENT_SEASON } from '../src/components/wizard/create/currentSeason';

/**
 * Create-pool wizard invariants.
 *
 * Two defects, both reported by Kevin from the live wizard on 2026-08-05:
 *
 *  1. **Step 2 asked for a free-typed season and defaulted to '2025'** — a
 *     season that is over — on four wizards. `nfl_games` documents are keyed on
 *     `season` as a string, so a pool stamped with a season the schedule was
 *     never imported for renders NO GAMES AT ALL. Same blast radius as the
 *     `seasonType` NaN bug (#319), except reachable by typing.
 *  2. **The "I agree to the Terms of Service" checkbox had no link**, so the
 *     terms being agreed to were unreachable from the point of agreement.
 *
 * There is no DOM test environment in this repo (no jsdom / happy-dom /
 * testing-library — checked), so these are deliberately coarse source greps,
 * the same convention as `tests/admin-surface-invariants.test.ts`. They assert
 * the WIRING, not the rendering.
 */

const root = resolve(__dirname, '..');
const CREATE_DIR = 'src/components/wizard/create';

// Enumerated from disk rather than hardcoded: a NEW wizard added later must be
// covered too, and a hardcoded list is exactly how a rule ends up applying to
// six of seven pool types. That is the shape of the #319 and #315 defects.
const WIZARDS = readdirSync(resolve(root, CREATE_DIR))
  .filter(f => /^Create.*Pool\.tsx$/.test(f))
  .map(f => `${CREATE_DIR}/${f}`);

describe('the create-pool wizards enumerate correctly', () => {
  it('finds every Create*Pool wizard on disk', () => {
    // Guard the guard: if the glob breaks, every it.each below silently passes
    // on an empty list. Seven pool types today (POOL_TYPES in shared/).
    expect(WIZARDS.length).toBeGreaterThanOrEqual(7);
  });
});

describe('season is stamped, never typed', () => {
  it.each(WIZARDS)('%s exposes no editable season input', file => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // The removed shape, plus any other way of registering the field for edit.
    expect(src).not.toMatch(/<TextField\s+name="season"/);
    expect(src).not.toMatch(/<NumberField\s+name="season"/);
    expect(src).not.toMatch(/register\(\s*['"]season['"]/);
  });

  it('that grep matches the string it was written to catch', () => {
    const removed = '      <TextField name="season" label="Season" placeholder="2025" />';
    expect(removed).toMatch(/<TextField\s+name="season"/);
  });

  it('no wizard defaults a season to a hardcoded year literal', () => {
    for (const file of WIZARDS) {
      const src = readFileSync(resolve(root, file), 'utf8');
      // `season: '2025'` was the defect. Any quoted 4-digit default is banned;
      // the constant is the only permitted source.
      expect(src, `${file} hardcodes a season literal`).not.toMatch(/\bseason:\s*['"]\d{4}['"]/);
    }
  });

  it('every wizard that carries a season reads it from CURRENT_SEASON', () => {
    const withSeason = WIZARDS.filter(f =>
      /\bseason:\s/.test(readFileSync(resolve(root, f), 'utf8')),
    );
    // Pick'em, Survivor, Margin and Playoff. Squares/Props/Bracket have no
    // `season` field (Bracket uses `seasonYear`, a distinct tournament year).
    expect(withSeason.length).toBe(4);
    for (const file of withSeason) {
      const src = readFileSync(resolve(root, file), 'utf8');
      expect(src, `${file} should import CURRENT_SEASON`).toMatch(/from '\.\/currentSeason'/);
      expect(src, `${file} should stamp CURRENT_SEASON`).toMatch(/season:\s*CURRENT_SEASON/);
    }
  });
});

describe('CURRENT_SEASON is usable as a Firestore key', () => {
  it('is a four-digit STRING', () => {
    // `nfl_games.season` is queried as a string; a number would match nothing.
    expect(typeof CURRENT_SEASON).toBe('string');
    expect(CURRENT_SEASON).toMatch(/^\d{4}$/);
  });

  it('is not a season that has already finished', () => {
    // The whole defect was a default left behind at a past year. 2026 is the
    // first live season; this floor rises when the constant does.
    expect(Number(CURRENT_SEASON)).toBeGreaterThanOrEqual(2026);
  });

  it('satisfies the create schema, which REQUIRES a non-empty season', () => {
    // shared/schemas/nfl.ts: z.union([z.string().trim().min(1), z.number()]).
    // Removing the input must not turn into sending nothing.
    expect(CURRENT_SEASON.trim().length).toBeGreaterThan(0);
  });
});

describe('the Terms of Service gate links to the terms', () => {
  const launch = readFileSync(resolve(root, `${CREATE_DIR}/LaunchStep.tsx`), 'utf8');

  it('renders an anchor to the /terms route', () => {
    // The route exists at App.tsx's `<Route path="/terms" …>`.
    expect(launch).toMatch(/href="\/terms"/);
  });

  it('opens in a new tab without leaking window.opener', () => {
    // A same-tab navigation would destroy six steps of unsaved wizard state.
    expect(launch).toMatch(/target="_blank"/);
    expect(launch).toMatch(/rel="noopener/);
  });

  it('does not let reading the terms tick the box', () => {
    // The anchor is INSIDE the <label>, so a click activates the label's
    // control unless propagation stops. Without this the checkbox silently
    // becomes checked the moment someone clicks through to read.
    expect(launch).toMatch(/stopPropagation\(\)/);
  });

  it('still gates on _tosAccepted — the link did not replace the consent', () => {
    expect(launch).toMatch(/name="_tosAccepted"/);
    expect(launch).toMatch(/Please accept the Terms of Service to launch\./);
  });
});
