import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Live Scoreboard's default tab.
 *
 * It opened on NCAA Basketball, so through the whole football season the first
 * thing a visitor saw was an empty college-hoops slate. The fix is one
 * `useState` initial value, which is exactly the kind of change that gets
 * reverted by accident and noticed by nobody until August.
 *
 * A source grep rather than a render: `Scoreboard.tsx` fetches ESPN at mount and
 * pulls `src/firebase.ts` into the import graph, which throws under vitest's
 * node environment (see `src/utils/nflPending.test.ts` for the same problem and
 * its stub). Mounting the component to assert a constant would cost a jsdom
 * environment, a fetch mock and a Firebase stub to prove one literal. Coarse by
 * design, same as `admin-surface-invariants` and `nfl-surface-invariants`.
 *
 * ⚠️ If the default becomes SEASON-AWARE — the better shape, noted in the
 * component and in the PR — this test SHOULD fail. That is a deliberate
 * behaviour change and it should cost a deliberate test edit, not slide through
 * on a guard written loosely enough to accept both.
 *
 * (qodo on PR #426: "This PR changes user-facing behavior (default tab
 * selection) without adding or updating any tests to cover the new default.")
 */

const raw = readFileSync(
  resolve(__dirname, '..', 'src/components/Scoreboard.tsx'),
  'utf8',
);

/**
 * ⚠️ COMMENTS ARE BLANKED BEFORE SCANNING, and that is load-bearing.
 *
 * Scanning raw source means a comment can satisfy an assertion while the
 * executable code regresses — this file's own header comment names the tabs, so
 * the "all three tabs still reachable" check below would pass on a component
 * that had deleted one. This repo has already had a guard fooled by a name that
 * appeared only in a comment, and both sibling suites
 * (`admin-surface-invariants`, `nfl-surface-invariants`) strip comments for
 * exactly this reason. (qodo on PR #426.)
 */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('Live Scoreboard opens on NFL', () => {
  it('initializes activeTab to nfl', () => {
    // Tolerant of formatting, exact about the VALUE. Pinning the literal
    // one-line spelling meant a prettier reflow or a reordered union broke CI
    // while the default was still correct — friction with no safety in it.
    // The union members are asserted separately below, so nothing is lost.
    // (qodo on PR #426.)
    expect(src).toMatch(/useState<[^>]*>\(\s*'nfl'\s*\)/);
  });

  it('does not initialize it to basketball', () => {
    expect(src).not.toMatch(/useState<[^>]*>\(\s*'basketball'\s*\)/);
  });

  it('still offers all three tabs, so the default is a default and not a removal', () => {
    for (const tab of ['nfl', 'college', 'basketball']) {
      expect(src, `setActiveTab('${tab}') should still be reachable`)
        .toContain(`setActiveTab('${tab}')`);
    }
  });
});
