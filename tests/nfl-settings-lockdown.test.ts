import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Source-level invariants for the NFL settings lockdown (PLAN-REALTIME-SCORING
 * §3a, PR-B′).
 *
 * These are source assertions rather than behavioural tests because this repo has
 * NO firestore.rules test harness — the emulator suites run through the Admin
 * SDK, which bypasses rules entirely. So nothing else in CI can notice if the
 * rules half or the client half of this change is reverted, and the two only work
 * as a pair: the rules DENY a client-direct `settings` write on NFL pools, and
 * the manager UI must therefore go through the `updatePoolSettings` callable. Undo
 * either one and the failure is silent — a permission-denied on save, or a
 * reopened deadline.
 *
 * Same shape as tests/admin-surface-invariants.test.ts, and for the same reason:
 * an invariant nobody can test behaviourally is still worth pinning.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('firestore.rules — scorer-owned pool fields are server-only', () => {
  const rules = read('firestore.rules');

  it.each([
    // Clearing it reopens a week whose result members have already seen.
    'publishedWeeks',
    // Holds the fenced scoring lease; clearing it breaks the mutex between scorers.
    'autoScore',
    // Finalization completeness markers.
    'scoredWeeks',
    'scoredThroughWeek',
    // Frozen Survivor/Margin weekly deadlines (PR-0).
    'hardLockByWeek',
    // The stats discriminator (PLAN-STATS-INTEGRITY §8.1 arm 3). Writable by a
    // manager, it hides their own pool's volume; clearable, it pushes a test
    // pool's fake pot into the world-readable stats/global document.
    'isTestPool',
    // Arm 1 of the same discriminator, and the sim-harness trust anchor. Already
    // stripped from client CREATE payloads; unprotected on UPDATE it reopened the
    // same hole one step later (codex r1 on PR A).
    'simRunId',
    // A manager who could change `type` could flip an NFL pool to a non-NFL type,
    // write settings.weekLockOverrides while the NFL settings block no longer
    // applies, and flip it back — reopening a published week (codex r1).
    'type',
  ])('protectedFieldsUnchanged() lists %s', (field) => {
    // Sliced to the END of protectedFieldsUnchanged (i.e. the next function), not
    // to poolIsEditable — otherwise a field merely quoted in one of the helpers in
    // between would satisfy this assertion while being unprotected.
    const block = rules.slice(
      rules.indexOf('function protectedFieldsUnchanged()'),
      rules.indexOf('function nflSettingsWriteBlocked()'),
    );
    expect(block).toContain(`'${field}'`);
  });

  it('blocks a client seasonType write on NFL pools — arm 2 of the discriminator', () => {
    // Deliberately NOT in protectedFieldsUnchanged(), which is unscoped: the
    // SQUARES setup wizard rewrites seasonType on an existing pool when the
    // commissioner re-picks the game (AdminPanel.tsx selectGame -> updateConfig ->
    // dbService.updatePool), so an unscoped freeze would break that save. The
    // predicate only reads seasonType on NFL season pools.
    const block = rules.slice(
      rules.indexOf('function nflSeasonTypeWriteBlocked()'),
      rules.indexOf('function seasonNotForgedSim()'),
    );
    expect(block).toContain("'seasonType'");
    for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']) {
      expect(block).toContain(`'${type}'`);
    }
  });

  it('denies a client transition INTO a sim- season — arm 1 of the discriminator', () => {
    // Not a freeze on `season`: it rides along in the Props wizard's full-object
    // update. Only the transition into a sim- value is denied, because that value
    // is what isSimPool reads (and what the sim-aware scoring paths skip on).
    const block = rules.slice(
      rules.indexOf('function seasonNotForgedSim()'),
      rules.indexOf('function poolIsEditable()'),
    );
    expect(block).toContain("'season'");
    // The (?s) flag is the finding, not a style choice (codex r3): matches() is a
    // RE2 FULL-string match and RE2's `.` skips newlines, so a bare 'sim-.*' is
    // false for "sim-\nanything" — which the rule would then allow, while
    // isSimPool's String(season).startsWith('sim-') still calls it a test pool.
    expect(block).toContain("matches('(?s)sim-.*')");
    // A changed season must be a string or a number. List/map values are denied,
    // because String(['sim-x']) === 'sim-x' forged a sim season past a string-only
    // check (codex r4). Numbers stay allowed — no number stringifies to 'sim-'.
    expect(block).toContain('s is int');
    expect(block).toContain('s is float');
  });

  it('denies a client-direct settings write on NFL pools', () => {
    expect(rules).toContain('function nflSettingsWriteBlocked()');
    for (const type of ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']) {
      expect(rules).toContain(`'${type}'`);
    }
  });

  it('wires that check into the pool update rule, not just declares it', () => {
    // A helper that is defined and never called is the exact failure mode this
    // whole file exists to catch.
    const allowUpdate = rules.slice(rules.indexOf('// Update: Owner/Manager (filtered) OR SuperAdmin'));
    const stmt = allowUpdate.slice(0, allowUpdate.indexOf(';'));
    expect(stmt).toContain('isPoolManager()');
    expect(stmt).toContain('protectedFieldsUnchanged()');
    expect(stmt).toContain('nflSettingsWriteBlocked()');
    expect(stmt).toContain('nflSeasonTypeWriteBlocked()');
    expect(stmt).toContain('seasonNotForgedSim()');
  });
});

describe('NFLManagerView — settings saves route through the server callable', () => {
  const view = read('src/components/NFLPoolDashboard/NFLManagerView.tsx');

  it('calls dbService.updatePoolSettings, not dbService.updatePool', () => {
    expect(view).toContain('dbService.updatePoolSettings(pool.id');
    // The direct write the rules now reject. Reverting to it makes every
    // commissioner "Save Settings" click fail with permission-denied.
    expect(view).not.toContain('dbService.updatePool(pool.id');
  });

  it('dbService exposes the callable it depends on', () => {
    expect(read('src/services/dbService.ts')).toContain("httpsCallable<{ poolId: string; updates: Record<string, unknown> }");
  });
});
