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
    // A manager who could change `type` could flip an NFL pool to a non-NFL type,
    // write settings.weekLockOverrides while the NFL settings block no longer
    // applies, and flip it back — reopening a published week (codex r1).
    'type',
  ])('protectedFieldsUnchanged() lists %s', (field) => {
    const block = rules.slice(
      rules.indexOf('function protectedFieldsUnchanged()'),
      rules.indexOf('function poolIsEditable()'),
    );
    expect(block).toContain(`'${field}'`);
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
