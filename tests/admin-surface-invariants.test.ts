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

/**
 * T3 extended to the COMMISSIONER bento (2026-07-29).
 *
 * The T3 guard only ever covered the super-admin bento, which is why the same
 * defect class survived untouched on the pool-manager one: a mock player name
 * from DevDashboardPreview was the top-player fallback and seeded the banter
 * feed with "<name> is currently leading, but historically has collapsed in
 * Week 13" — on pools where no week had ever been played. Alongside it were an
 * invented operations log with hardcoded relative timestamps, an unconditional
 * "deadline in 16 hours", and two commissioner buttons that fired a toast
 * claiming work had started and called nothing at all.
 *
 * These are string checks against the SOURCE on purpose: every one of these
 * strings was a literal in the file, so a literal is what fails if one returns.
 */
describe('T3 — no fabricated data on the commissioner bento', () => {
  const bento = read('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');

  // Guard the guard: a renamed/moved file would make every not.toContain below
  // vacuously pass on an empty-ish string.
  it('read the commissioner bento source', () => {
    expect(bento).toContain('NFLManagerBentoDashboard');
    expect(bento.length).toBeGreaterThan(5000);
  });

  it.each([
    // Mock roster name leaked from DevDashboardPreview.tsx.
    'Sarah K.',
    // Invented commissioner analysis about a season that has not happened.
    'historically has collapsed in Week 13',
    // A countdown that was true of no pool.
    'Deadline approaches in 16 hours',
    // Buttons that reported starting work they never started.
    'Initiating ESPN Sync score recalculation',
    'Toggling locks status',
    // Fabricated audit-trail entries with hardcoded relative times.
    'Commissioner finalized standings for Week',
    'automated schedule synchronization with ESPN APIs',
    '10 mins ago',
    '1 hour ago',
    '2 hours ago',
    // Claimed a moderation capability that does not exist.
    'AI Moderation ACTIVE',
    // A fabricated CONTACT DETAIL, which is the worst of the set: it was
    // rendered as the member's address on the very list a commissioner uses to
    // chase people for picks, so the card invited you to act on it.
    'user@example.com',
  ])('fabricated string %j is gone', (s) => {
    expect(bento).not.toContain(s);
  });

  /**
   * EVERY derivation on this card is roster-derived. Twice now the same defect
   * has shipped here from the same cause: a `useMemo` reading the `entries`
   * prop, which cannot see a member who joined and never submitted. #322 fixed
   * the money figures that way; the Submission Health card was still doing it
   * and reported "1 of 1 — 100%" on a pool where three members had not picked.
   *
   * `entries` is still a PROP and is still handed to `buildPoolRoster` /
   * `rosterPotStats` — that is the one legitimate use. What must not come back
   * is a reader that walks the array itself, which is what `entries.` catches
   * (`entries.length`, `entries.filter(...)`, `entries.map(...)`).
   */
  it('derives nothing from the raw entries array — every reader goes through the roster', () => {
    // Guard the guard: the legitimate uses must actually be present, or this
    // would pass on a card that no longer receives entries at all.
    expect(bento).toContain('buildPoolRoster({ pool, members, entries })');
    expect(bento).not.toContain('entries.');
  });

  // The mock name must also stay out of the shared roster helper the card now
  // reads, and out of the manager view that renders it.
  it.each([
    'src/utils/poolRoster.ts',
    'src/components/NFLPoolDashboard/NFLManagerView.tsx',
  ])('%s carries no mock roster name', (p) => {
    expect(read(p)).not.toContain('Sarah K.');
  });
});

/**
 * The commissioner money card reads ROSTER truth, not entry documents.
 *
 * HANDOFF items 1 and 7: every figure on the Buy-In Ledger and in the Advanced
 * Payment Ledger modal was `entries`-derived, so a pool whose members held
 * Member Records but no entry documents showed $0 / 0% / "no members" beside a
 * Member Roster panel on the SAME page that listed them correctly. Root cause is
 * the half of D13 that P1 could not reach: setPaidStatus mirrors display fields
 * onto the entry only when the entry exists.
 *
 * Behaviour lives in src/utils/poolRoster.test.ts; this pins the WIRING, which
 * is the part a future edit can quietly undo.
 */
describe('commissioner Buy-In Ledger is roster-backed, not entry-backed', () => {
  const bento = read('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');

  it('takes Member Records as a prop and feeds them to the shared helpers', () => {
    expect(bento).toMatch(/members:\s*any\[\]/);
    expect(bento).toContain("from '../../utils/poolRoster'");
    expect(bento).toContain('rosterPotStats({ pool, members, entries })');
    expect(bento).toContain('buildPoolRoster({ pool, members, entries })');
  });

  it('the manager view actually passes Member Records down', () => {
    expect(read('src/components/NFLPoolDashboard/NFLManagerView.tsx')).toMatch(
      /<NFLManagerBentoDashboard[\s\S]{0,400}?members=\{members\}/,
    );
  });

  it('no entry-derived money figure survives on the card', () => {
    // The specific expressions that produced the $0 report. Matching the
    // expressions rather than the words keeps this from tripping on prose.
    expect(bento).not.toMatch(/entries\.filter\([^)]*paidStatus/);
    expect(bento).not.toMatch(/entryFee\s*\|\|\s*20/);
    expect(bento).not.toContain('ledgerStats');
  });

  // codex r1 on this PR. Three findings, three wirings that a later edit could
  // undo without any behaviour test noticing, because each is about which
  // FUNCTION the card calls.
  it('shows the deadline the SERVER enforces, not the first kickoff', () => {
    // Picks close lockBufferMinutes before kickoff (default 5; Survivor/Margin
    // allow 5/30/60) and a hard-lock pool's deadline is frozen per week. A
    // kickoff-based label is a fabricated deadline wearing a real timestamp.
    expect(bento).toContain('effectiveBufferMinutesForWeek');
    expect(bento).toContain('weekDeadline(weeklyGames, buffer)');
    // The same pair WeekChecklist uses, which is what members read — the two
    // surfaces must not state different deadlines.
    const checklist = read('src/components/NFLPoolDashboard/WeekChecklist.tsx');
    expect(checklist).toContain('effectiveBufferMinutesForWeek');
    expect(checklist).toContain('weekDeadline(');
    // And no hand-rolled min-of-kickoffs, which is what the first fix did.
    expect(bento).not.toMatch(/Math\.min\(\.\.\.[\w.]*times/);
  });

  it('claims ONE week deadline only for pools that actually have one', () => {
    // codex r2: default NFL_PICKEM is PER_GAME — submitNFLPicksInternal checks
    // each picked game's own lock, so later games stay editable after the first
    // closes, and weekLockOverrides can push a week's lock later still. That
    // model lives in functions/src/lib/effectiveLock.ts and is not shared with
    // the client, so no honest single line can be rendered for those pools.
    // usesWeeklyHardLock is the same predicate the server uses.
    expect(bento).toContain('usesWeeklyHardLock(castPool.type)');
    // The gate must come BEFORE the deadline is computed, or it gates nothing.
    const gate = bento.indexOf('usesWeeklyHardLock(castPool.type)');
    const compute = bento.indexOf('weekDeadline(weeklyGames, buffer)');
    expect(gate).toBeGreaterThan(-1);
    expect(compute).toBeGreaterThan(gate);
  });

  it('the roster’s money totals and its rendered rows read the same field', () => {
    // codex r2: a person evidenced only by an entry renders PAID off the entry
    // (buildPoolRoster), so the totals must read the entry too. Charging them in
    // `expected` while ignoring their payment showed a PAID row beside an
    // understated Collected — and the old entries-backed ledger DID count it.
    const util = read('src/utils/poolRoster.ts');
    const loop = util.slice(util.indexOf('for (const uid of uids)'));
    expect(loop).toContain("e?.paidStatus === 'PAID'");
    expect(loop).toContain('collected += entryFee');
    expect(loop).toContain('paid++');
  });

  it('never claims the ledger is clear while dues are outstanding', () => {
    // codex r1 found the green all-clear could sit above a positive Outstanding
    // Due: base and rebuy dues settle independently (P3), so every member can be
    // PAID while rebuy dollars are owed, and a paid-STATUS list is empty in
    // exactly that case. codex r5 then found the same list wrongly contained
    // zero-debt members (a seeded owner's feeOwed is 0; a free pool's is 0 for
    // everyone). Filtering the list by DEBT fixes both at once — and makes r1's
    // separate empty state UNREACHABLE, so it is gone rather than left as a
    // branch that looks like a safeguard and can never run.
    expect(bento).toContain('memberOutstanding(r, rates) > 0');
    // The all-clear is reached only when that debt-filtered list is empty.
    const allClear = bento.indexOf('All buy-ins cleared!');
    const listGate = bento.indexOf('dashboardUnpaidPlayers.length > 0');
    expect(allClear).toBeGreaterThan(-1);
    expect(listGate).toBeGreaterThan(-1);
    expect(listGate).toBeLessThan(allClear);
    // The dead branch must NOT come back; behaviour is covered by
    // src/utils/poolRoster.test.ts's cleared/outstanding cases.
    expect(bento).not.toContain('outstandingDue(pot) > 0');
  });

  it('never offers "Mark Paid" to someone whose base dues are already paid', () => {
    // codex r5 follow-on, found by self-review: once the list is debt-filtered it
    // contains rebuy-only debtors, who ARE PaidStatus PAID. togglePayment would
    // flip them to UNPAID — the exact opposite of what clicking "Mark Paid"
    // means. Rebuy settlement is a different callable mode (settleRebuys) and
    // lives on the member roster below.
    expect(bento).toContain('const baseDuesPaid = ');
    expect(bento).toMatch(/baseDuesPaid\s*\?/);
    // The toggle is now unconditionally a mark-PAID (never a flip), so a PAID row
    // reaching it could not un-pay anyone even if the branch were removed.
    expect(bento).toContain('togglePayment(player.uid, false, player.hasMember)');
    expect(bento).not.toMatch(/togglePayment\(player\.uid,\s*player\.paidStatus/);
  });

  it('the head count comes from the roster UID union, not a max of sizes', () => {
    const util = read('src/utils/poolRoster.ts');
    expect(util).toContain('rosterUids(');
    expect(util).toContain('const memberCount = uids.size');
    // The undercounting expression must be gone — with it, a person evidenced
    // only by an entry was listed on the card but charged nothing.
    expect(util).not.toMatch(/Math\.max\(\s*memberList\.length/);
    expect(util).not.toMatch(/memberCount\s*-\s*memberList\.length/);
  });

  it('explains a missing Member Record instead of reporting a missing pool', () => {
    // codex r4. setPaidStatus uses `not-found` for BOTH "Pool not found" and
    // "Member is not on this pool's roster", and getUserMessage resolves the
    // transport CODE before the message — so the roster case rendered as "that
    // pool or entry couldn't be found", about a pool plainly on screen. The
    // roster deliberately falls back to participantIds/entries, so this row is
    // reachable. Disambiguated by the client's own `hasMember`, NOT by matching
    // the server's prose, which would break the day it is reworded.
    expect(bento).toContain('const paymentError =');
    expect(bento).toMatch(/paymentError\([^)]*hasMember/);
    // The one remaining write path here (the "Advanced Payment Ledger" modal
    // and its saveDetailedPayment went with the ledger unification, 2026-08-16
    // — fee writes now live in PaymentLedgerNFL via NFLManagerView) must use it.
    expect(bento.match(/paymentError\(err, hasMember/g) ?? []).toHaveLength(1);
    expect(bento).not.toContain('saveDetailedPayment');
    // ...and the call site must actually pass the row's flag through.
    expect(bento).toContain('togglePayment(player.uid, false, player.hasMember)');

    // And the decision must not be made by reading the server's sentence. Scoped
    // to the FUNCTION BODY, not the file: the comment above it necessarily quotes
    // that sentence to explain the bug, and a file-wide check fails on the
    // explanation of its own defect — the same trap the fabricated-string guard
    // above already sprang once.
    const body = bento.slice(
      bento.indexOf('const paymentError ='),
      bento.indexOf('const togglePayment ='),
    );
    expect(body.length).toBeGreaterThan(50);
    expect(body).not.toContain('.message');
    expect(body).not.toMatch(/\.test\(|\.includes\(|\.match\(/);

    // The assertions above pin the PLUMBING, and plumbing alone is not the fix:
    // reverting the body to a bare `getUserMessage(err, fallback)` left every one
    // of them true, because the parameter, both call sites and the arity all
    // survive. Caught by mutation, not by reading. So pin the BRANCH — hasMember
    // must actually select between getUserMessage and a distinct message that
    // names the missing roster record.
    expect(body).toMatch(/hasMember\s*\n?\s*\?/);
    expect(body).toMatch(/\?\s*getUserMessage\(/);
    expect(body).toMatch(/:\s*'[^']{40,}'/);
    expect(body.toLowerCase()).toContain('roster record');
  });

  it('the member-facing pot and the commissioner ledger share ONE definition', () => {
    // Two readers of the same money must not drift; that drift is what let the
    // roster panel and the ledger card disagree on the same page.
    expect(read('src/components/PaymentsPanel.tsx')).toContain('rosterPotStats({ pool, members, entries })');
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
  // The Members tab's MARKUP moved to admin/MembersTab.tsx (SuperAdmin.tsx split,
  // phase 1) while its state and handlers stayed behind. So the role SELECTOR is
  // now asserted against the panel and the CALLABLE against SuperAdmin.tsx —
  // deliberately split rather than relaxed to a single "somewhere in src" search,
  // because a search that broad would pass on a file nothing renders.
  const members = read('src/components/admin/MembersTab.tsx');
  it('imports the canonical role model', () => {
    expect(admin).toMatch(/from\s*'\.\.\/utils\/roles'/);
    expect(members).toMatch(/from\s*'\.\.\/\.\.\/utils\/roles'/);
  });
  it('renders a role selector backed by setUserRole', () => {
    expect(members).toContain('CANONICAL_ROLES.map');
    expect(admin).toContain('dbService.setUserRole');
  });
  it('keeps the selector MOUNTED — the panel is rendered, not merely present', () => {
    expect(admin).toContain('<MembersUsersPanel');
    expect(admin).toMatch(/import\s*\{[^}]*MembersUsersPanel[^}]*\}\s*from\s*'\.\/admin\/MembersTab'/);
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
    // C1 (2026-08-23): the NARROW per-pool feature toggle. `adminUpdatePoolBilling`
    // could already do this via `override`, but its audit row cannot say which
    // feature moved or which way.
    'adminSetPoolFeature',
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
    expect(ops).toContain('backfillResume.set(resumeKey, { cursor: at,');
    expect(ops).toContain('backfillResume.get(resumeKey)');
    // Both stop paths park — the thrown-error one and the page-cap one.
    expect(ops.match(/\bpark\(cursor\)/g) ?? []).toHaveLength(2);
    // The checkpoint carries the WORK, not just the position (codex r5): a resumed
    // run that reported only its own pages would undercount the migration evidence.
    // The fold/snapshot themselves are behaviour-tested in
    // src/utils/resumableReport.test.ts; this only pins that the panel uses them.
    expect(ops).toContain('partial: snapshotReport(agg)');
    expect(ops).toContain('foldParkedReport(agg, parked.partial)');
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

/**
 * Production Watchdog — the card must never hand the operator an all-clear it
 * cannot support.
 *
 * Three separate review rounds landed on the same defect class here: a signal
 * whose read FAILED rendered as 0, a capped money total rendered as a lower
 * bound it is not, and an empty event list rendered as "nothing happened" while
 * a tile above it said "unavailable". They are string checks against the source
 * for the same reason the T3 guards above are: each of these was a literal in
 * the file, so a literal is what fails if one comes back.
 */
describe('Production Watchdog — no unsupported all-clear', () => {
  const card = read('src/components/admin/ProductionWatchdogCard.tsx');

  it('the card is still wired into the Overview bento', () => {
    // Guard the guard: a renamed or unmounted card would make every check below
    // pass against a file nobody renders.
    expect(read('src/components/SuperAdminBentoDashboard.tsx')).toContain('<ProductionWatchdogCard />');
    expect(card).toContain('getProdWatchdog');
  });

  it('a failed read renders as unavailable, never as a count', () => {
    expect(card).toContain('unavailable');
    expect(card).toMatch(/signal\.count === undefined/);
  });

  it('"nothing happened" is gated on every signal being readable AND uncapped', () => {
    // The claim may only appear in the branch guarded by emptyStateReason.
    expect(card).toMatch(/emptyStateReason === ''\s*\n?\s*\?\s*`Nothing happened/);
    expect(card).toMatch(/sig\.count === undefined/);
    expect(card).toMatch(/sig\.truncated/);
  });

  it('a capped money total is never labelled as a lower bound', () => {
    // billingCharges rows can be negative (refunds), so "≥$X" asserts the
    // opposite of what a partial sum supports.
    expect(card).toContain("kind === 'amount'");
    expect(card).toContain('partial');
  });
});
