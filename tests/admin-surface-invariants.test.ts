import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Admin-surface invariants (clobber guard).
 *
 * The T3/T6/T7 super-admin overhaul was silently reverted twice by merges from
 * branches cut before it landed (#116 ui-revamp, #117 wizard) — invisible to CI
 * because nothing asserted the admin surface's shape. These string/structure
 * checks fail loudly if any restored capability disappears again. They are
 * deliberately coarse: they verify wiring exists, not behavior (behavior is
 * covered by roles-parity, adminAudit, and the callable tests).
 */

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('T3 — no fake dashboard cards', () => {
  const bento = read('src/components/SuperAdminBentoDashboard.tsx');
  it.each([
    'Security Audit',
    'Database Migration Tools',
    'Automation Test Suite',
    'A+ (CLEAN)',
    '42 passed',
  ])('placeholder string %j is gone', (s) => {
    expect(bento).not.toContain(s);
  });
});

describe('T7 — Operations tab is wired', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  it('imports OperationsPanel', () => {
    expect(admin).toMatch(/import\s*\{\s*OperationsPanel\s*\}\s*from\s*'\.\/admin\/OperationsPanel'/);
  });
  it('renders the Operations tab', () => {
    expect(admin).toContain("activeTab === 'operations'");
    expect(admin).toContain('<OperationsPanel />');
  });
  it('registers an Operations nav item', () => {
    expect(admin).toMatch(/id:\s*'operations'/);
  });
});

describe('T6 — role-management UI is present', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  it('imports the canonical role model', () => {
    expect(admin).toMatch(/from\s*'\.\.\/utils\/roles'/);
  });
  it('renders a role selector backed by setUserRole', () => {
    expect(admin).toContain('CANONICAL_ROLES.map');
    expect(admin).toContain('dbService.setUserRole');
  });
});

describe('functions export surface', () => {
  const index = read('functions/src/index.ts');
  it.each([
    'setUserRole',
    'logAdminAction',
    'getAdminHealthSnapshot',
    'adminSaveBillingConfig',
    'adminManageCoupon',
    'adminUpdatePoolBilling',
    'adminAdjustUserCredits',
    'searchUsersByEmail',
    'closePool',
    'autoClosePools',
    'sendUserEmail',
    'backfillUserRoles',
  ])('exports %s', (name) => {
    expect(index).toContain(name);
  });
});

describe('T6 write-path sweep — global-role writers are canonical', () => {
  it('userSync + authService default to MEMBER, not PARTICIPANT', () => {
    expect(read('functions/src/userSync.ts')).toContain("role: 'MEMBER'");
    expect(read('src/services/authService.ts')).not.toMatch(/role:\s*'PARTICIPANT'/);
  });
  it('pool-creation upgrade + stripe write COMMISSIONER', () => {
    expect(read('functions/src/lib/poolCreation.ts')).toContain("CREATOR_ROLE = 'COMMISSIONER'");
    expect(read('functions/src/stripe.ts')).not.toMatch(/role:\s*"POOL_MANAGER"/);
  });
});

describe('step 6c — one-off email + live ban guard', () => {
  it('sendUserEmail dual-writes activity + audit', () => {
    const um = read('functions/src/userManagement.ts');
    expect(um).toContain('EMAIL_SENT');
    expect(um).toContain('writeAdminAudit');
  });
  it('assertNotBannedLive guards the submit/reserve paths', () => {
    expect(read('functions/src/lib/systemGuards.ts')).toContain('assertNotBannedLive');
    expect(read('functions/src/bracketEntries.ts')).toContain('assertNotBannedLive');
    expect(read('functions/src/nflPools.ts')).toContain('assertNotBannedLive');
    expect(read('functions/src/squares.ts')).toContain('assertNotBannedLive');
  });
});

describe('autoClosePools — safe by default', () => {
  const sweep = read('functions/src/autoClosePools.ts');
  it('is a scheduled job', () => {
    expect(sweep).toContain('onSchedule');
  });
  it('has a kill-switch and dry-run default', () => {
    expect(sweep).toContain('enabled');
    expect(sweep).toContain('dryRun');
    // Disabled unless config explicitly sets enabled === true.
    expect(sweep).toContain('cfg?.enabled === true');
  });
});

describe('T2 — closePool trigger guards are wired', () => {
  it('onPoolLocked skips the admin-close transition', () => {
    expect(read('functions/src/statsTrigger.ts')).toContain('isAdminCloseTransition');
  });
  it('onGameComplete skips the admin-close transition', () => {
    expect(read('functions/src/postGameEmail.ts')).toContain('isAdminCloseTransition');
  });
  it('recalculateGlobalStats excludes admin-closed pools', () => {
    expect(read('functions/src/statsTrigger.ts')).toContain('ADMIN_CLOSE');
  });
  it('closePool dual-writes closedVia + legacy terminal fields', () => {
    const pe = read('functions/src/poolExceptions.ts');
    expect(pe).toContain('closedVia');
    expect(pe).toContain('isFinal');
    expect(pe).toContain('scores.gameStatus');
  });
});

describe('step 5 — destructive admin actions write an audit trail', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  // RESET_TOURNAMENT left this list when the legacy Simulation Tools block was
  // deliberately removed from the Settings tab (2e61a9f, owner-confirmed) —
  // tournament re-init lives in the Operations tab now, covered by the OP_
  // audit invariant below.
  it.each(['DELETE_POOL', 'DELETE_USER_ACCOUNT', 'DELETE_THEME'])(
    'logs %s via logAdminAction',
    (action) => {
      expect(admin).toContain(action);
    }
  );
  it('uses the audited logAdminAction path', () => {
    expect(admin).toContain('dbService.logAdminAction');
  });

  // Tournament re-init (incl. Big 12 / Big East) moved to the Operations tab,
  // which audits EVERY op via an OP_<id> action on both success and error.
  const ops = read('src/components/admin/OperationsPanel.tsx');
  it('OperationsPanel audits every op via logAdminAction (success + error)', () => {
    expect(ops).toContain('dbService.logAdminAction');
    expect(ops).toContain('OP_');
    // The resolved path no longer hardcodes 'success': an op that RETURNS
    // `ok: false` (a partial migration reporting its resume cursor rather than
    // throwing) must be audited as an ERROR, so the status is selected. Asserting
    // the whole ternary is stricter than the old literal — it pins that BOTH
    // outcomes come off one decision instead of always writing 'success'.
    expect(ops).toMatch(/status:\s*ok\s*\?\s*'success'\s*:\s*'error'/);
    // ...and the thrown-exception path still audits its own error.
    expect(ops).toContain("status: 'error'");
  });
  it('conference tournament re-inits live in Operations', () => {
    expect(ops).toContain('initializeBig12TournamentHttp');
    expect(ops).toContain('initializeBigEastTournamentHttp');
  });
});

/**
 * PLAN-PAYMENT-TRUTH P4 — a migration's dry run IS its evidence, so the Run Log
 * must actually be able to DISPLAY the counters its own card tells the operator
 * to read.
 *
 * This is a regression guard for a defect in P4 itself, found by codex r1: the
 * two new skip counters were appended to the end of the aggregate, and the Run
 * Log renders a truncated `JSON.stringify`. `finishedPoolsSkipped` began at
 * index 188 of a 226-character report with every count at zero, past the
 * 160-char limit then in force — so the "run the dry run first and read the
 * count" instruction pointed at a number that never appeared on screen.
 *
 * Deliberately reconstructs the rendered string from the SOURCE rather than
 * asserting a key order literally: it fails if the keys are reordered, if a new
 * counter is inserted ahead of them, or if the truncation limit is lowered.
 */
describe('P4 — the roster backfill dry run can be read in the Run Log', () => {
  const ops = read('src/components/admin/OperationsPanel.tsx');

  const sliceLimit = Number(ops.match(/JSON\.stringify\(result\)\.slice\(0,\s*(\d+)\)/)![1]);
  const aggBody = ops.match(/const agg = \{([\s\S]*?)\};/)![1];
  const keys = aggBody
    .split(',')
    .map((s) => s.trim().split(':')[0].trim())
    .filter((k) => /^\w+$/.test(k));

  // Guard the parse itself — a silent mis-parse would make every assertion below
  // vacuously pass.
  it('parsed the aggregate shape out of the source', () => {
    expect(sliceLimit).toBeGreaterThan(0);
    expect(keys).toContain('poolsScanned');
    expect(keys).toContain('finishedPoolsSkipped');
    expect(keys).toContain('testPoolsSkipped');
    expect(keys).toContain('failures');
  });

  // Zeros are the WORST case for position and the BEST case for length: every
  // count renders as one character, so a counter that is out of range here is out
  // of range for every real run too.
  const rendered = JSON.stringify(
    Object.fromEntries(keys.map((k) => [k, k === 'failures' ? [] : 0])),
  );

  it.each(['poolsScanned', 'finishedPoolsSkipped', 'testPoolsSkipped'])(
    'counter %s survives Run Log truncation',
    (key) => {
      const at = rendered.indexOf(`"${key}"`);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(sliceLimit);
    },
  );

  it('the whole zero-valued report fits, so nothing is silently dropped', () => {
    expect(rendered.length).toBeLessThanOrEqual(sliceLimit);
  });

  it('failures stays last — it is the only unbounded field', () => {
    expect(keys[keys.length - 1]).toBe('failures');
  });

  it('both incl.-finished cards exist and the dry run is not destructive', () => {
    expect(ops).toContain("id: 'backfillMemberRecordsFinished:dry'");
    expect(ops).toContain("id: 'backfillMemberRecordsFinished'");
    expect(ops).toContain('runBackfill(true, true)');
    expect(ops).toContain('runBackfill(false, true)');
  });

  it('a partial run is reported, not swallowed, and carries a resume cursor', () => {
    // codex r3: the paging cursor lives in runBackfill's closure, so an unhandled
    // throw loses it and the migration can only restart from pool #1.
    expect(keys).toContain('ok');
    expect(keys).toContain('resumeFrom');
    expect(ops).toContain('agg.resumeFrom = cursor');
    // ...and `ok: false` must actually reach the operator rather than being
    // rendered as a green success line.
    expect(ops).toMatch(/\?\.ok\s*!==\s*false/);
    expect(ops).toContain("status: ok ? 'success' : 'error'");
  });

  it('the client callable deadline is raised past the SDK default', () => {
    // codex r4: the Firebase JS SDK enforces its own 70s callable deadline, so a
    // 300s server budget alone just moves the abort into the browser — the client
    // reports failure for work the server went on to finish.
    expect(ops).toMatch(/httpsCallable\(functions,\s*name,\s*timeoutMs\s*\?\s*\{\s*timeout:\s*timeoutMs\s*\}/);
    expect(ops).toContain('BACKFILL_TIMEOUT_MS');
    const clientMs = Number(ops.match(/BACKFILL_TIMEOUT_MS = ([\d_]+)/)![1].replace(/_/g, ''));
    const serverS = Number(
      read('functions/src/migrations/backfillMemberRecords.ts').match(/timeoutSeconds:\s*(\d+)/)![1],
    );
    // Strictly greater, so the SERVER's deadline is always what fails a page —
    // never a race between two equal timers.
    expect(clientMs).toBeGreaterThan(serverS * 1000);
  });

  it('the reported resume cursor is actually usable', () => {
    // Reporting resumeFrom while offering no way to submit it would leave a wedged
    // migration restarting at pool #1 forever (codex r4).
    expect(ops).toContain('backfillResume.set(resumeKey, cursor)');
    expect(ops).toContain('backfillResume.get(resumeKey)');
    // Keyed by the run's flags — resuming a wide sweep from a narrow sweep's
    // cursor would silently skip pools.
    expect(ops).toContain('const resumeKey = `${dryRun}:${includeFinished}`');
    // ...and a clean finish must clear it, or the next run silently starts partway.
    expect(ops).toContain('backfillResume.delete(resumeKey)');
  });

  it('the incl.-finished sweep uses the smaller page size', () => {
    // A finished pool used to cost one `continue`; it now costs the full
    // per-member walk, so 100/page is a different amount of work entirely.
    expect(ops).toContain('const limit = includeFinished ? 25 : 100;');
  });

  it('the panel never SENDS the retired includeAll flag', () => {
    // Matches a payload key, not the word: the docblock explains what includeAll
    // was and why it was split, and that prose is worth keeping. A bare
    // `not.toContain('includeAll')` failed on exactly that comment.
    expect(ops).not.toMatch(/includeAll\s*:/);
  });
});

describe('step 6b — server-side user email search', () => {
  it('userSync writes the lowercased searchEmail field', () => {
    expect(read('functions/src/userSync.ts')).toContain('searchEmail');
  });
  it('admin Users tab uses the indexed search callable', () => {
    expect(read('src/components/SuperAdmin.tsx')).toContain('dbService.searchUsersByEmail');
  });
});

describe('step 2 — money-adjacent admin writes go through audited callables', () => {
  const panel = read('src/components/admin/SuperAdminBillingPanel.tsx');
  it('no direct client coupon writes', () => {
    expect(panel).not.toMatch(/addDoc\(\s*collection\(db,\s*'coupons'/);
    expect(panel).not.toMatch(/deleteDoc\(\s*doc\(db,\s*'coupons'/);
  });
  it('no direct client billing/referral config writes', () => {
    expect(panel).not.toMatch(/setDoc\([^)]*'billing_config'/);
    expect(panel).not.toMatch(/setDoc\([^)]*'referral_config'/);
  });
  it('uses the audited billing callables', () => {
    expect(panel).toContain('dbService.adminSaveBillingConfig');
    expect(panel).toContain('dbService.adminManageCoupon');
    expect(panel).toContain('dbService.adminUpdatePoolBilling');
    expect(panel).toContain('dbService.adminAdjustUserCredits');
  });
});

describe('8-tab consolidation — the canonical Super-Admin Dashboard tabs', () => {
  const admin = read('src/components/SuperAdmin.tsx');
  // The NavGroup type union is the single source of the top-level tab set.
  const m = admin.match(/type NavGroup =\s*([^;]+);/);
  const tops = (m?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];

  it('has exactly the eight CONTEXT.md tabs, no more, no fewer', () => {
    expect([...tops].sort()).toEqual(
      ['Members', 'Monetization', 'Operations', 'Overview', 'Pools', 'System', 'Test Suite', 'Themes'].sort()
    );
  });

  it('routes every legacy render block under a tab (no orphaned activeTab section)', () => {
    // Every render block id must appear in navStructure so it stays reachable.
    const renderIds = new Set(
      [...admin.matchAll(/activeTab === '(\w+)'/g)].map((x) => x[1])
    );
    const navIds = new Set(
      [...admin.matchAll(/\{\s*id:\s*'(\w+)',\s*label:/g)].map((x) => x[1])
    );
    const orphans = [...renderIds].filter((id) => !navIds.has(id));
    expect(orphans).toEqual([]);
  });
});
