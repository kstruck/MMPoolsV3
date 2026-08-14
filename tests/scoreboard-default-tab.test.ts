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

const src = readFileSync(
  resolve(__dirname, '..', 'src/components/Scoreboard.tsx'),
  'utf8',
);

describe('Live Scoreboard opens on NFL', () => {
  it('initializes activeTab to nfl', () => {
    expect(src).toMatch(
      /useState<'nfl' \| 'college' \| 'basketball'>\('nfl'\)/,
    );
  });

  it('does not initialize it to basketball', () => {
    expect(src).not.toContain("'basketball'>('basketball')");
  });

  it('still offers all three tabs, so the default is a default and not a removal', () => {
    for (const tab of ['nfl', 'college', 'basketball']) {
      expect(src, `setActiveTab('${tab}') should still be reachable`)
        .toContain(`setActiveTab('${tab}')`);
    }
  });
});
