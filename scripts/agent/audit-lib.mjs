// PURE helpers for running loop 1, the audit sweep, through the loop runner
// (`.claude/skills/mmp-loop-audit-sweep/SKILL.md`). No SDK, no zod, no
// firebase-admin: `tests/agent-audit-sweep.test.ts` loads this file from the
// ROOT suite, which installs none of them. The production reader is injected.
//
// 🛑 WHAT LEAVES THIS MACHINE, AND WHAT DOES NOT (Kevin's ruling, 2026-11-25).
//
// `admin_audit` rows hold personal data: an actor's e-mail and uid, target ids
// that are user ids, and a `metadata` map of free text. Everything a model is
// shown goes to the Anthropic API. So the model is shown NONE of it. The checks
// run here, in code, on this machine, and the tools return only:
//
//   - counts;
//   - the names of audit actions, and ONLY names in this file's own catalogue
//     (`KNOWN_ACTIONS`). An action name is stored text: `logAdminAction` records
//     whatever name the admin client reports, so a name outside the catalogue
//     is counted and never shown, however name-shaped it is (qodo on #809);
//   - the Firestore document ids of `admin_audit` rows (random auto-ids);
//   - the names of FIELDS that are wrong in a row, never their values;
//   - for a failed read, a fixed sentence and Google's error CODE, never the
//     error's message. A Firestore message can quote a document path, and a
//     path can hold a target id (qodo on #809). The full message goes to the
//     operator's own stderr and nowhere else.
//
// No e-mail, no uid, no target id and no metadata value is ever in a tool
// result, a log row or stdout. The test suite feeds the session rows full of
// poison and checks that none of it comes out of any tool or of the row.
//
// 🛑 WHAT THIS SWEEP CAN AND CANNOT CONCLUDE (the skill says the same).
//
// It CANNOT conclude that every admin action left an audit row: no independent
// record of completed admin actions exists. That half is INCONCLUSIVE on every
// run, by construction, and every row this file builds says so.
//
// It CAN check that the trail is self-consistent, and that is the only thing
// the row's verdict is about.

import { formatLoopRow } from './loop-lib.mjs';

export const AUDIT = Object.freeze({
  LOOP: 'audit-sweep',
  SKILL: '.claude/skills/mmp-loop-audit-sweep/SKILL.md',
  COLLECTION: 'admin_audit',
  /** How far back the sweep reads. */
  WINDOW_DAYS: 30,
  /**
   * More rows than this in the window and the sweep stops before reading them.
   * A partial read would be reported as a whole one; a refused read is
   * INCONCLUSIVE and says why.
   */
  MAX_ROWS: 20_000,
  /** Distinct pool targets whose existence is checked. The rest are counted as not checked. */
  MAX_TARGET_LOOKUPS: 500,
  /** Document ids listed per finding. The count is always exact; the list is a sample. */
  SAMPLE: 10,
  TOOL_SERVER: 'audit',
});

/** A well-formed action name: what `writeAdminAudit` call sites use. */
const ACTION_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Every action name a `writeAdminAudit` / `adminAuditDoc` call site in
 * `functions/src` passes as a string literal. `tests/agent-audit-sweep.test.ts`
 * re-derives this list from the source and fails when a name is missing, so a
 * new audited action cannot be added without this file hearing about it.
 *
 * It is NOT the list of every action that can appear. `logAdminAction`
 * (functions/src/adminOps.ts) records a name the SUPER_ADMIN client reports,
 * and some call sites pass a variable. A name outside this list is therefore a
 * NOTE in the row, never a finding.
 */
export const KNOWN_ACTIONS = Object.freeze([
  'AUTH_BACKUP',
  'AUTO_CLOSE_SWEEP',
  'BACKFILL_CONFIDENCE_LOCK_MODE',
  'BACKFILL_FROZEN_SPREADS',
  'BACKFILL_PUBLISHED_WEEKS',
  'BACKFILL_RUN',
  'BILLING_CONFIG_SAVED',
  'CLEAR_LEGACY_CO_MANAGERS',
  'COUPON_MINT_FROM_TEMPLATE',
  'COUPON_TEMPLATE_CREATE',
  'COUPON_TEMPLATE_DELETE',
  'COUPON_TEMPLATE_UPDATE',
  'EMAIL_SENT',
  'ENTITLEMENT_GRANTED',
  'ENTITLEMENT_REVOKED',
  'FROZEN_SPREAD_SLATE_KEY_MISSING',
  'MIGRATE_POOL_PASSWORDS',
  'MONETIZATION_ALERTS_SWEEP',
  'MONETIZATION_ALERT_ACK',
  'NFL_FEED_REPLAY',
  'NFL_FINALIZE_SWEEP',
  'NFL_LOCK_WATCH',
  'NFL_STAT_CORRECTION',
  'OVERRIDE_LOCKED_SPREAD',
  'PASSWORD_RESET_SENT',
  'POOL_CLOSED',
  'POOL_SETTLED',
  'PROFILE_DATA_BACKFILL',
  'RECALC',
  'ROLE_BACKFILL',
  'ROLE_CHANGED',
  'RUN_NFL_SPREAD_FREEZE',
  'SQUARES_UNLOCK',
  'SYSTEM_CONFIG_CHANGED',
  'UNAPPROVED_FROZEN_SPREAD_CHANGE',
  'USER_CREDITS_ADJUSTED',
  'USER_DELETED',
  'WEBHOOK_DURABILITY_SWEEP',
]);

/**
 * Actions a TIMED job writes on every run it is enabled for, at least once in
 * any 30-day window. Each was read in the source on 2026-11-25:
 *
 *   AUTO_CLOSE_SWEEP          autoClosePools.ts          daily
 *   NFL_FINALIZE_SWEEP        nflFinalize.ts             daily
 *   MONETIZATION_ALERTS_SWEEP monetizationAlerts.ts      every 6 hours
 *   AUTH_BACKUP               authBackup.ts              weekly
 *
 * NOT here, on purpose: `NFL_LOCK_WATCH` runs hourly but returns before its
 * audit write when there is no slate to watch, so it is silent all offseason.
 *
 * 🛑 EVERY ONE OF THESE SKIPS ITS AUDIT ROW WHILE ITS KILL SWITCH IS OFF. So
 * "no rows in the window" has two readings: the logging broke, or the job was
 * switched off on purpose. This file cannot tell them apart, and it does not
 * pretend to. The finding is worded as "went silent — check the kill switch
 * first", and it is raised only for a job that HAS written rows before: a job
 * that never ran is a note, not a finding. A monitor that reports a config
 * choice as a fault, on every run, is one people stop reading.
 */
export const RECURRING_ACTIONS = Object.freeze(['AUTH_BACKUP', 'AUTO_CLOSE_SWEEP', 'MONETIZATION_ALERTS_SWEEP', 'NFL_FINALIZE_SWEEP']);

const ROW_FIELDS = Object.freeze(['actorUid', 'actorEmail', 'action', 'targetType', 'targetId', 'metadata', 'status', 'error', 'at']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const stringOrNull = (v) => v === null || typeof v === 'string';

/**
 * The NAMES of the fields that are wrong in one row; an empty list when the
 * row matches what `adminAuditDoc` (functions/src/lib/adminAudit.ts) writes.
 *
 * `row` is the STORED FIELDS of one document (the reader's `fields`), with
 * `at` as the reader produced it for the Firestore Timestamp: an ISO string,
 * or null when the stored value was not a Timestamp. The document id is not
 * part of it, so a stored field named `id` is an unexpected field like any other.
 *
 * Names only. A value never leaves this function.
 */
export function auditRowErrors(row) {
  if (!isPlainObject(row)) return ['(row is not an object)'];
  const bad = [];
  if (typeof row.actorUid !== 'string' || row.actorUid.trim() === '') bad.push('actorUid');
  if (!stringOrNull(row.actorEmail)) bad.push('actorEmail');
  if (typeof row.action !== 'string' || !ACTION_NAME.test(row.action)) bad.push('action');
  if (!stringOrNull(row.targetType)) bad.push('targetType');
  if (!stringOrNull(row.targetId)) bad.push('targetId');
  if (!isPlainObject(row.metadata)) bad.push('metadata');
  if (row.status !== 'success' && row.status !== 'error') bad.push('status');
  if (!stringOrNull(row.error)) bad.push('error');
  if (typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) bad.push('at');
  const extra = Object.keys(row).filter((k) => !ROW_FIELDS.includes(k));
  if (extra.length) bad.push('(unexpected field)');
  return bad;
}

/** A pool id that can be turned into a document reference without Firestore throwing, and holds no path. */
const POOL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * What a failed read may say outside this machine: which step, and Google's
 * error code when there is one. Never `error.message`.
 */
export function safeReadError(step, error) {
  const code = error?.code;
  const shown = typeof code === 'number' || (typeof code === 'string' && /^[A-Za-z0-9_./-]{1,40}$/.test(code)) ? ` (code ${code})` : '';
  return `${step} failed${shown}; the full error is on the operator's stderr`;
}

/** A Firestore auto-id or other id-shaped string, else a placeholder. Ids are shown; anything else is not. */
export function safeDocId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '(unprintable id)';
}

const sample = (ids) => ids.slice(0, AUDIT.SAMPLE).map(safeDocId);

/**
 * One audit-sweep run: the four tool handlers and the ledger they write.
 *
 * `reader` is the production reader (audit-reader.mjs), or a fake:
 *   countWindow(sinceIso)                 -> number of rows at or after `sinceIso`
 *   readWindow(sinceIso, limit)           -> [{ id, fields: { ...stored, at: iso|null } }]
 *   actionEverWritten(action)             -> boolean (any row, any date)
 *   existingPoolIds(ids)                  -> the subset of `ids` that exist under /pools
 * Every method may be async and may throw.
 *
 * The checks hold their rows in this closure. Nothing here returns a row.
 */
export function createAuditSession({ reader, now = new Date(), log = () => {} }) {
  /** Record a failure: the detail stays local (`log`), the safe sentence is what callers may show. */
  const failed = (step, error) => {
    log(`${step} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return safeReadError(step, error);
  };
  const sinceIso = new Date(now.getTime() - AUDIT.WINDOW_DAYS * 86_400_000).toISOString();
  const ledger = {
    /** null until the window is read; then { ok, rows, total, error, overCap }. */
    window: null,
    shape: null,
    coverage: null,
    targets: null,
  };
  let rows = null;

  const needWindow = () => (rows ? null : { ok: false, error: 'call read_audit_window first, and only continue when it answers ok: true' });

  async function readAuditWindow() {
    rows = null;
    try {
      const total = await reader.countWindow(sinceIso);
      if (!Number.isInteger(total) || total < 0) return shortRead('the row count is not a number');
      if (total > AUDIT.MAX_ROWS) {
        ledger.window = { ok: false, total, overCap: true, error: `the window holds ${total} rows, over the ${AUDIT.MAX_ROWS} limit; none were read` };
        return { ok: false, total, error: ledger.window.error };
      }
      const read = await reader.readWindow(sinceIso, AUDIT.MAX_ROWS + 1);
      if (!Array.isArray(read)) return shortRead('the reader did not return a list');
      // More rows than were counted a moment ago is normal (the trail grows).
      // FEWER means the read was cut short, and a short read is not a sweep.
      if (read.length < total) return shortRead(`counted ${total} rows but read ${read.length}`);
      if (read.length > AUDIT.MAX_ROWS) return shortRead(`read more than the ${AUDIT.MAX_ROWS} limit`);
      if (!read.every((r) => isPlainObject(r) && isPlainObject(r.fields))) return shortRead('the reader returned a row with no fields');
      rows = read;
      ledger.window = { ok: true, total: read.length };
      ledger.shape = ledger.coverage = ledger.targets = null;
      return { ok: true, collection: AUDIT.COLLECTION, windowDays: AUDIT.WINDOW_DAYS, since: sinceIso, rows: read.length };
    } catch (error) {
      ledger.window = { ok: false, error: failed('reading the audit window', error) };
      return { ok: false, error: ledger.window.error };
    }
  }

  /** A read that came back wrong. The text is this file's own, so it is safe to show. */
  function shortRead(what) {
    ledger.window = { ok: false, error: what };
    return { ok: false, error: what };
  }

  function checkRowShape() {
    const blocked = needWindow();
    if (blocked) return blocked;
    const byField = new Map();
    const malformedIds = [];
    for (const row of rows) {
      const bad = auditRowErrors(row.fields);
      if (!bad.length) continue;
      malformedIds.push(row.id);
      for (const field of bad) byField.set(field, (byField.get(field) ?? 0) + 1);
    }
    const fields = Object.fromEntries([...byField.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    ledger.shape = { malformed: malformedIds.length, fields, sampleIds: sample(malformedIds) };
    return { ok: true, rowsChecked: rows.length, ...ledger.shape };
  }

  async function checkActionCoverage() {
    const blocked = needWindow();
    if (blocked) return blocked;
    try {
      const counts = new Map();
      let malformedNames = 0;
      for (const row of rows) {
        const action = row.fields.action;
        if (typeof action !== 'string' || !ACTION_NAME.test(action)) {
          malformedNames++;
          continue;
        }
        counts.set(action, (counts.get(action) ?? 0) + 1);
      }
      const seen = [...counts.keys()].sort();
      // Names outside the catalogue are COUNTED, never listed: the name is stored text.
      const unknown = seen.filter((a) => !KNOWN_ACTIONS.includes(a));
      const unknownRows = unknown.reduce((n, a) => n + counts.get(a), 0);
      const shownNames = seen.filter((a) => KNOWN_ACTIONS.includes(a));
      const silent = [];
      const neverRan = [];
      for (const action of RECURRING_ACTIONS) {
        if (counts.has(action)) continue;
        // Asked of the whole collection, not the window: has this job EVER logged?
        (await reader.actionEverWritten(action)) ? silent.push(action) : neverRan.push(action);
      }
      ledger.coverage = { seen: seen.length, known: KNOWN_ACTIONS.length, silent, neverRan, unknownNames: unknown.length, unknownRows, malformedNames };
      return {
        ok: true,
        actionTypesSeen: seen.length,
        knownActionTypes: KNOWN_ACTIONS.length,
        counts: Object.fromEntries(shownNames.map((a) => [a, counts.get(a)])),
        recurringThatWentSilent: silent,
        recurringThatNeverRan: neverRan,
        actionNamesNotInTheCatalogue: unknown.length,
        rowsUnderThoseNames: unknownRows,
        rowsWithAMalformedActionName: malformedNames,
        note: 'A recurring job skips its audit row while its kill switch is off. "Went silent" means: it has logged before and has not in this window. Check the kill switch before treating it as broken logging.',
      };
    } catch (error) {
      ledger.coverage = { error: failed('the action coverage check', error) };
      return { ok: false, error: ledger.coverage.error };
    }
  }

  async function checkTargets() {
    const blocked = needWindow();
    if (blocked) return blocked;
    try {
      // Pools only. A user target that no longer exists is the EXPECTED result
      // of USER_DELETED, so checking users would report the audit trail of
      // every deleted account as a problem.
      const rowsByPool = new Map();
      let unusableTargets = 0;
      for (const row of rows) {
        const { targetType, targetId } = row.fields;
        if (targetType !== 'pool' || typeof targetId !== 'string' || targetId === '') continue;
        // A target id is stored text too. One with a slash, or any character a
        // document id cannot hold, would make Firestore throw an error that
        // QUOTES it. It is counted here and never handed to the reader.
        if (!POOL_ID.test(targetId)) {
          unusableTargets++;
          continue;
        }
        if (!rowsByPool.has(targetId)) rowsByPool.set(targetId, []);
        rowsByPool.get(targetId).push(row.id);
      }
      const all = [...rowsByPool.keys()];
      const checked = all.slice(0, AUDIT.MAX_TARGET_LOOKUPS);
      const existing = new Set(await reader.existingPoolIds(checked));
      const orphanRowIds = checked.filter((id) => !existing.has(id)).flatMap((id) => rowsByPool.get(id));
      ledger.targets = {
        poolsNamed: all.length,
        poolsChecked: checked.length,
        notChecked: all.length - checked.length,
        missingPools: checked.filter((id) => !existing.has(id)).length,
        orphanRows: orphanRowIds.length,
        sampleIds: sample(orphanRowIds),
        unusableTargets,
      };
      return { ok: true, ...ledger.targets, note: 'A row that names a pool which no longer exists is worth a look, and is not by itself an error: test pools are deleted.' };
    } catch (error) {
      ledger.targets = { error: failed('the targets check', error) };
      return { ok: false, error: ledger.targets.error };
    }
  }

  return {
    ledger,
    handlers: {
      read_audit_window: () => readAuditWindow(),
      check_row_shape: () => checkRowShape(),
      check_action_coverage: () => checkActionCoverage(),
      check_targets: () => checkTargets(),
    },
  };
}

/**
 * Run every check in code, with no model. Used by `--mode offline`, and by the
 * tests that compare a model-driven run with a code-only one.
 */
export async function runAuditChecks(session) {
  const read = await session.handlers.read_audit_window();
  if (!read.ok) return;
  session.handlers.check_row_shape();
  await session.handlers.check_action_coverage();
  await session.handlers.check_targets();
}

/** The project a real sweep reads. Anything else is labelled in the row and never posted. */
export const PRODUCTION_PROJECT = 'gridiron-gamble-uzuqo';

/** The label a row carries for its mode, or null for a live run. One spelling, used by every row writer. */
export function modeLabel(mode) {
  return mode === 'dry-run' ? 'DRY RUN' : mode === 'offline' ? 'OFFLINE (no model)' : null;
}

/** True only for a credentialed read of the production project. */
export function isProductionSource(source) {
  return source?.kind === 'production' && source.projectId === PRODUCTION_PROJECT;
}

/** A source in words this file controls: the kind, and a project id only when it is id-shaped. */
export function describeSource(source) {
  const project = typeof source?.projectId === 'string' && /^[a-z0-9-]{1,40}$/.test(source.projectId) ? source.projectId : '(unnamed)';
  return source?.kind === 'emulator' ? `the EMULATOR (project ${project})` : `project ${project}`;
}

export const AUDIT_TOOL_NAMES = Object.freeze(['read_audit_window', 'check_row_shape', 'check_action_coverage', 'check_targets']);
export const AUDIT_ALLOWED_TOOLS = Object.freeze(AUDIT_TOOL_NAMES.map((n) => `mcp__${AUDIT.TOOL_SERVER}__${n}`));

/**
 * The loop-log row for an audit sweep, decided from the ledger.
 *
 * THE VERDICT IS ABOUT SELF-CONSISTENCY ONLY. The integrity question (did every
 * admin action leave a row?) is INCONCLUSIVE on every run and the `idea` field
 * says so every time, so a CLEAN here can never be read as "the audit trail is
 * complete".
 *
 *   BLOCKED       no API key, or no production credential.
 *   ERROR         the SDK run did not complete, or the window could not be read.
 *   FINDING       a malformed row, or a recurring job that has logged before
 *                 and has not in this window.
 *   INCONCLUSIVE  the window was over the row limit, a check failed, a check
 *                 was never run, or some pool targets were left unchecked.
 *   CLEAN         every check ran, and found none of the above.
 *
 * Notes (a pool that no longer exists, an action name outside the catalogue, a
 * recurring job that has never run) go in the row and do not change the verdict.
 */
export function summarizeAuditRun({ ledger, failure = null, blocked = null, mode = 'live', now = new Date(), model = null, costUsd = null, turns = null, commit = '-', source = null }) {
  const lessons = [];
  const notes = [];
  let verdict = 'CLEAN';
  const rank = ['CLEAN', 'INCONCLUSIVE', 'FINDING', 'ERROR', 'BLOCKED'];
  const worsen = (next, lesson) => {
    if (rank.indexOf(next) > rank.indexOf(verdict)) verdict = next;
    lessons.push(lesson);
  };

  const { window, shape, coverage, targets } = ledger;
  const read = Boolean(window?.ok);

  if (read) {
    for (const [name, check] of [['row shape', shape], ['action coverage', coverage], ['targets', targets]]) {
      if (!check) worsen('INCONCLUSIVE', `the ${name} check was never run`);
      else if (check.error) worsen('INCONCLUSIVE', check.error);
    }
    if (targets?.notChecked) worsen('INCONCLUSIVE', `${targets.notChecked} pool target(s) were over the ${AUDIT.MAX_TARGET_LOOKUPS} lookup limit and were not checked`);
    if (coverage?.silent?.length) worsen('FINDING', `went silent (logged before, nothing in ${AUDIT.WINDOW_DAYS} days; check the kill switch first): ${coverage.silent.join(', ')}`);
    if (shape?.malformed) {
      const fields = Object.entries(shape.fields).map(([f, n]) => `${f} x${n}`).join(', ');
      worsen('FINDING', `${shape.malformed} malformed row(s) [${fields}]; ids: ${shape.sampleIds.join(', ')}${shape.malformed > shape.sampleIds.length ? ', ...' : ''}`);
    }
    if (targets?.orphanRows) notes.push(`${targets.orphanRows} row(s) name ${targets.missingPools} pool(s) that no longer exist`);
    if (coverage?.unknownNames) notes.push(`${coverage.unknownNames} action name(s) outside the catalogue, on ${coverage.unknownRows} row(s) (names not shown)`);
    if (targets?.unusableTargets) notes.push(`${targets.unusableTargets} row(s) carry a pool target id that is not id-shaped; not looked up`);
    if (coverage?.neverRan?.length) notes.push(`recurring job(s) with no row ever: ${coverage.neverRan.join(', ')}`);
  } else if (!blocked) {
    if (window?.overCap) worsen('INCONCLUSIVE', window.error);
    else worsen('ERROR', window?.error ? `the window could not be read: ${window.error}` : 'the agent never read the audit window');
  }
  if (failure) worsen('ERROR', failure);
  if (blocked) worsen('BLOCKED', blocked);

  const metric = read ? `${window.total} rows: ${shape?.malformed ?? '?'} malformed, ${coverage?.silent?.length ?? '?'} silent` : window?.overCap ? `${window.total} rows, not read` : '-';
  const spend = [model, Number.isFinite(costUsd) && `$${costUsd.toFixed(4)}`, Number.isFinite(turns) && `${turns} turns`].filter(Boolean).join(' ');
  const idea = [
    modeLabel(mode),
    // WHERE the rows came from, in the row itself. A sweep of the emulator, or
    // of another project, must never read as a sweep of production (qodo on #809).
    source && !isProductionSource(source) ? `NOT PRODUCTION: ${describeSource(source)}` : null,
    `self-consistency of ${AUDIT.COLLECTION} over ${AUDIT.WINDOW_DAYS} days; integrity is INCONCLUSIVE (no independent record of admin actions exists)`,
    read && coverage && !coverage.error ? `${coverage.seen} action types seen` : null,
    ...notes,
    spend || null,
  ]
    .filter(Boolean)
    .join('; ');

  return {
    verdict,
    row: formatLoopRow({ date: now.toISOString().slice(0, 10), loop: AUDIT.LOOP, commit, verdict, metric, idea, lesson: lessons.join(' | ') }),
  };
}

export const AUDIT_SYSTEM_PROMPT = [
  'You run one maintenance loop for the March Melee Pools repository: the audit-trail sweep. Nobody reads your messages while you work.',
  'The user message holds the loop\'s written procedure. Follow it with the four tools you are given; you have no other tools.',
  '',
  'How this run differs from the written procedure:',
  '- You cannot load other skills, read function logs or query Firestore yourself. The tools do the reading and the checking, on the operator\'s machine.',
  `- Call mcp__${AUDIT.TOOL_SERVER}__read_audit_window first. If it does not answer ok: true, stop and say what it answered.`,
  '- Then call check_row_shape, check_action_coverage and check_targets, once each. Those three are the self-consistency checks of step 4.',
  '- The tools show you counts, action names and document ids only. You will not see an e-mail, a user id or a metadata value, and you must not ask for one.',
  '- Do NOT write the LOOP-LOG row (the last step). The runner writes it from what the tools recorded.',
  '- The integrity verdict is INCONCLUSIVE on every run, as the procedure says. Do not report it as checked.',
  '',
  'When all four tools have answered, reply with two or three plain sentences: what the checks found, and what a person should look at first.',
].join('\n');

export function buildAuditPrompt({ skillText, mode }) {
  return [
    'Run the audit-trail sweep now.',
    mode === 'dry-run' ? 'THIS IS A DRY RUN: the checks run for real (they only read), and the runner does not post the row.' : 'This is a LIVE run: the runner posts the row when you are done.',
    '',
    '--- the written procedure (.claude/skills/mmp-loop-audit-sweep/SKILL.md) ---',
    skillText.trim(),
  ].join('\n');
}
