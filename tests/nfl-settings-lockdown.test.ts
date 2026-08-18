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
    // Frozen weekly tiebreak target game ids (PLAN-WEEKLY-PRIZES §2b): rewriting
    // the map would re-point predictions members already made.
    'frozenTiebreakTargets',
    // The frozen weeks divisor of the weekly prize pot (PLAN-WEEKLY-PRIZES D5).
    'weeksInSeason',
    // The published Season Places + frozen season prize (PLAN-WEEKLY-PRIZES step 3):
    // recordPoolPayouts binds season PLACE awards to this list.
    'seasonPlaces', 'seasonPrize', 'seasonPlacesError',
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

describe('NFLManagerBentoDashboard — payment writes route through setPaidStatus (PLAN-PAYMENT-TRUTH P1)', () => {
  const bento = read('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');

  it('BOTH panel paths call dbService.setPaidStatus and neither calls updateBracketEntryPayment', () => {
    // The miswired control (D13): this panel used to call updateEntryPayment,
    // which writes ONLY the display-legacy entry doc — so a commissioner
    // "marking paid" left the Member Record UNPAID, appended nothing to the
    // payments ledger, and kept the member's dues out of the pot. There were
    // TWO such paths (togglePayment AND saveDetailedPayment); reverting either
    // one reintroduces the split-brain, so this pins the absence of the old
    // callable from the whole file, not just one handler.
    expect(bento).toContain('dbService.setPaidStatus(');
    expect(bento).not.toContain('updateBracketEntryPayment');
  });
});

describe('NFLManagerView — the roster toggle has no legacy payment fallback', () => {
  const view = read('src/components/NFLPoolDashboard/NFLManagerView.tsx');

  it('calls dbService.setPaidStatus and never updateBracketEntryPayment', () => {
    // The roster toggle kept a pre-deploy fallback: when setPaidStatus threw it
    // wrote `pools/{id}/entries/{entryId}` directly via updateBracketEntryPayment.
    // That fallback was correct only while pools had no Member Records — the D25
    // backfill closed that on 2026-07-27. Left in place it is a live split-brain
    // hazard: any error on the authoritative path (a transient permission or
    // network failure, a future server-side rejection) would quietly mark the
    // member paid on the display-legacy entry doc while the Member Record, the
    // payments ledger, the roster summary and the pot all still said UNPAID —
    // exactly the D13 defect PLAN-PAYMENT-TRUTH P1 existed to close, reachable
    // again through the error path. This pins its absence from the whole file.
    expect(view).toContain('dbService.setPaidStatus(pool.id, uid, nextPaid)');
    expect(view).not.toContain('updateBracketEntryPayment');
  });

  it('surfaces the real failure instead of the stale pre-deploy advice', () => {
    // Both handlers used to tell the commissioner to "deploy functions" — advice
    // that has been wrong since setPaidStatus/settleRebuys went live, and that
    // hides the actual server message (e.g. a genuine authorization refusal).
    expect(view).not.toContain('Deploy functions to enable');
    expect(view).not.toContain('is the payments update deployed?');
  });
});

/**
 * The callable-only settings guard, and WHERE it sits in the expression
 * (PLAN-WEEKLY-TIEBREAKERS §5; PLAN-SURVIVOR-PARITY-SCORING decision 4).
 *
 * ⚠️ POSITION IS THE GUARD. `allow update` is
 *
 *     request.auth != null && callableOnlySettingsUnchanged() && (
 *       (isPoolManager() && ... && nflSettingsWriteBlocked() && ...)
 *       || isSuperAdmin()
 *     )
 *
 * Every settings protection except this one lives INSIDE the manager branch and
 * is short-circuited by `isSuperAdmin()`. Hoisting a check outside the
 * disjunction is the only way to bind a super-admin client.
 *
 * This block exists because a plan with ten review rounds behind it asserted
 * that `nflSettingsWriteBlocked()` denied NFL settings to every client
 * principal. It denies them to MANAGERS. The claim survived because grepping
 * the function name finds the right code and answers the wrong question — and
 * because this repo has no rules test harness, so nothing in CI could fail on
 * it. (codex, on the weekly-tiebreaker PR.)
 */
describe('firestore.rules — callable-only settings bind SUPER_ADMIN too', () => {
  const rules = read('firestore.rules');

  it.each([
    // Regrade past weeks on the next rescore (#399).
    'tieCountsAs',
    'maxTeamUses',
    // Changes what a number members ALREADY TYPED means — and under NONE they
    // were never asked, so the scorer would read them all as having predicted 0.
    'weeklyTiebreaker',
    // The money split: an SA direct write could store an invalid split, or move
    // entryFee/payoutMode around a valid one, making "site-verified" decorative
    // for exactly the principal most likely to hand-fix money fields.
    'hybridSplit',
    // PLAN-PAYMENT-LEDGER T1: the HYBRID weekly place list — validated in the callable only.
    'weeklyPayouts',
  ])('callableOnlySettingsUnchanged() lists %s', (field) => {
    const fn = rules.slice(rules.indexOf('function callableOnlySettingsUnchanged()'));
    const body = fn.slice(0, fn.indexOf('\n      }'));
    expect(body).toContain(`'${field}'`);
  });

  it('lists maxEntriesPerUser in the NFL-ONLY clause — Bracket/Playoff carry the same key and save it by direct updateDoc (PLAN-MULTI-ENTRY D8; qodo on #449)', () => {
    const fn = rules.slice(rules.indexOf('function callableOnlySettingsUnchanged()'));
    const body = fn.slice(0, fn.indexOf('\n      }'));
    const nflClause = body.slice(body.indexOf('!isNfl ||'));
    expect(nflClause).toContain("'maxEntriesPerUser'");
    // and NOT in the unscoped list
    const unscoped = body.slice(body.indexOf('!changed.hasAny(['), body.indexOf('!isNfl ||'));
    expect(unscoped).not.toContain('maxEntriesPerUser');
  });
  it("lists payouts in the NFL-ONLY clause — validated in updatePoolSettings (unique ranks, ≤100 %); Bracket/Playoff still edit it directly (PLAN-PAYMENT-LEDGER T1; codex r2 on #470)", () => {
    const fn = rules.slice(rules.indexOf('function callableOnlySettingsUnchanged()'));
    const body = fn.slice(0, fn.indexOf('\n      }'));
    const nflClause = body.slice(body.indexOf('!isNfl ||'));
    expect(nflClause).toContain("'payouts'");
    const unscoped = body.slice(body.indexOf('!changed.hasAny(['), body.indexOf('!isNfl ||'));
    expect(unscoped).not.toMatch(/'payouts'/);
  });

  it('diffs the settings MAP, not the root — a root diff would guard nothing', () => {
    // Root `affectedKeys()` reports only the top-level `settings` key, so a
    // per-field check against it never fires.
    const fn = rules.slice(rules.indexOf('function callableOnlySettingsUnchanged()'));
    const body = fn.slice(0, fn.indexOf('\n      }'));
    expect(body).toContain("request.resource.data.get('settings', {})");
    expect(body).toContain(".diff(resource.data.get('settings', {}))");
  });

  it('is applied OUTSIDE the super-admin disjunction', () => {
    // The assertion that actually matters. If this call ever moves inside the
    // `isPoolManager()` branch, every guard above becomes decorative for a
    // super-admin client and no other test in this repo would notice.
    const allow = rules.slice(rules.indexOf('allow update: if request.auth != null'));
    const header = allow.slice(0, allow.indexOf('||'));
    expect(header).toContain('callableOnlySettingsUnchanged() && (');
    expect(header.indexOf('callableOnlySettingsUnchanged()')).toBeLessThan(header.indexOf('isPoolManager()'));
  });
});
