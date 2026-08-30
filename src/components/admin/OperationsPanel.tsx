import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { dbService } from '../../services/dbService';
import { ConfirmActionModal } from './ConfirmActionModal';
import { useToast } from '../ui/Toast';
import { getUserMessage } from '../../utils/errorMessages';
import { Wrench, RefreshCw, Database, Trophy, Users, CheckCircle2, XCircle, KeyRound, ShieldAlert, ArrowRight } from 'lucide-react';
import type { MigratePoolPasswordsReport } from '../../services/dbService';
import { addReportPage, foldParkedReport, snapshotReport, type ResumableReport } from '../../utils/resumableReport';

/**
 * Consolidated global operations (T7). Every GLOBAL batch/maintenance action
 * lives here behind one explain-then-confirm guardrail and writes an
 * admin_audit entry. GLOBAL fixes (fixPoolScores/scoreBracketEntries with no
 * id) live here; the PER-POOL variants stay as row actions in the Pools tab.
 *
 * The legacy System-tab duplicates (Fix Scoring / Fix Participants / Init Big
 * East) were removed in favour of these cards. Still open (needs a product
 * decision): whether the conference re-inits belong here or on the Tournament
 * tab, plus a March Madness re-init and relocating Export Emails to Members.
 */

interface OpAction {
  id: string;
  label: string;
  description: string;
  blastRadius: string;
  destructive: boolean;
  icon: React.ComponentType<{ size?: number }>;
  run: () => Promise<unknown>;
}

/**
 * `timeoutMs` exists because the Firebase JS SDK applies its OWN callable deadline —
 * 70 seconds by default — independently of whatever the function is provisioned for.
 * Raising a server budget without raising this one just moves the abort to the
 * browser: the request rejects at 70s while the function keeps running to completion
 * server-side, so the client reports a failure for work that actually succeeded, and
 * its resume cursor points at a page already done (codex r4).
 */
const call = (name: string, data: Record<string, unknown> = {}, timeoutMs?: number) =>
  httpsCallable(functions, name, timeoutMs ? { timeout: timeoutMs } : undefined)(data).then((r) => r.data);

/** Server budget for backfillMemberRecords is 300s; the client waits slightly longer
 *  so the SERVER's own deadline is what fails a page, never a race between the two. */
const BACKFILL_TIMEOUT_MS = 310_000;

/**
 * Where a backfill run stopped, so clicking Run again continues instead of restarting
 * at pool #1 (codex r4). Module-scoped rather than component state because ACTIONS is
 * a module-level const whose closures cannot see a hook.
 *
 * Holds the counters as well as the cursor (codex r5): parking the cursor alone let a
 * resumed run finish `ok: true` while reporting only the pages IT did, and for a money
 * migration the dry run's numbers are the evidence.
 *
 * Keyed by the run's flags: resuming a wide sweep from a narrow sweep's cursor would
 * silently skip pools. Cleared on a clean finish, so a completed migration always
 * starts over from the beginning next time.
 */
const backfillResume = new Map<string, { cursor: string; partial: ResumableReport }>();

/**
 * Member Record roster backfill (ADR 0003). The callable pages ~100 pools per call and
 * returns a nextCursor; this loops all pages and accumulates the invariant report so one
 * click covers every pool. Dry run writes nothing.
 *
 * `includeFinished` widens the sweep over COMPLETED / CANCELED / archived / final pools
 * (PLAN-PAYMENT-TRUTH P4). It replaces the old `includeAll`, which this panel never sent
 * — which is exactly the D25 defect: the button could not reach the historical pools the
 * all-time total is missing. Sim-harness pools and pools carrying the hand-applied
 * `isTestPool` marker are skipped by the callable unconditionally and no flag here can
 * change that. NFL preseason pools ARE processed: they are excluded from published
 * stats but they are the 2026-08-06 pilot, and their payment controls need the records.
 *
 * `finishedPoolsSkipped` is accumulated because it is the number to read off the narrow
 * dry run: it is how many pools the includeFinished variant would additionally touch.
 *
 * KEY ORDER IS LOAD-BEARING. The Run Log renders a TRUNCATED `JSON.stringify` of this
 * object, so a counter's position decides whether an operator can see it at all. The
 * two skip counters sit directly after poolsScanned because they are what the dry run
 * exists to report; `failures` stays last because it is the only unbounded field.
 * Measured, not assumed: with the counters appended at the end instead, the key
 * `finishedPoolsSkipped` began at index 188 of a 226-char report and was cut off by the
 * 160-char limit even with every count at zero — the dry-run card instructed the
 * operator to read a number the UI could not display (codex r1).
 */
const runBackfill = async (dryRun: boolean, includeFinished = false) => {
  const resumeKey = `${dryRun}:${includeFinished}`;
  const parked = backfillResume.get(resumeKey);
  let cursor: string | undefined = parked?.cursor;
  let pages = 0;
  // 25 on the incl.-finished path, 100 otherwise. A finished pool used to cost one
  // `continue`; now it costs the full per-member walk, so the same page size is a
  // very different amount of work. 25 is the handler's own default page size and
  // matches backfillProfileData, the other migration that does per-member work.
  const limit = includeFinished ? 25 : 100;
  const agg = { ok: true, dryRun, includeFinished, poolsScanned: 0, poolsSkipped: 0, finishedPoolsSkipped: 0, testPoolsSkipped: 0, membersCreated: 0, membersAlreadyPresent: 0, guestSkipped: 0, squaresSkipped: 0, participantIdsWithoutMember: 0, poolsFlipped: 0, resumedFrom: parked?.cursor ?? null, resumeFrom: null as string | null, error: null as string | null, failures: [] as any[] };

  // Carry the earlier pages' counters into this run (codex r5). Parking only the
  // cursor meant a resumed run started from zero and could finish ok:true while
  // reporting a fraction of the work — and for a money migration the dry run's
  // numbers ARE the evidence, so an undercount is the failure, not a cosmetic gap.
  if (parked) foldParkedReport(agg, parked.partial);

  /** Park the cursor WITH the work so far. */
  const park = (at: string) => backfillResume.set(resumeKey, { cursor: at, partial: snapshotReport(agg) });
  do {
    let r: any;
    try {
      // Conditional spread, not `startAfter: cursor` — the Firebase JS SDK
      // serializes an explicit-undefined property as NULL on the wire, which
      // failed the first page of the prod dry run 2026-07-27. The schema now
      // also accepts null (belt), this is the suspenders.
      r = await call('backfillMemberRecords', { dryRun, includeFinished, limit, ...(cursor ? { startAfter: cursor } : {}) }, BACKFILL_TIMEOUT_MS);
    } catch (e) {
      // The paging cursor lives in this closure, so an unhandled throw loses it and
      // the run can only restart from pool #1 — into the same wall. Report it AND
      // park it: `resumeFrom` is the last cursor that WAS accepted, the callable is
      // idempotent, and clicking Run again picks up from there.
      agg.ok = false;
      agg.resumeFrom = cursor ?? null;
      agg.error = e instanceof Error ? e.message : String(e);
      if (cursor) park(cursor);
      return agg;
    }
    // EVERY numeric counter. This used to be a hand-kept list, and the
    // `squaresSkipped` line carried a comment about how a counter that never
    // reaches the Run Log makes a narrowing "invisible to the operator" — which
    // was true of `poolsSkipped` the whole time it was written. Summing the shape
    // instead of a list is the fix for the class (see `addReportPage`).
    addReportPage(agg, r);
    if (Array.isArray(r.failures)) agg.failures.push(...r.failures);
    cursor = r.nextCursor || undefined;
    pages++;
  } while (cursor && pages < 100);
  // A run that stopped on the page cap rather than on an exhausted cursor has NOT
  // finished, and saying otherwise is the same lie as swallowing the throw.
  if (cursor) {
    agg.ok = false;
    agg.resumeFrom = cursor;
    agg.error = `Stopped at the ${pages}-page cap with pools remaining. Run again to continue from resumeFrom.`;
    park(cursor);
  } else {
    // Finished cleanly — drop the checkpoint so the next click is a full sweep and
    // never silently starts partway through.
    backfillResume.delete(resumeKey);
  }
  return agg;
};

/**
 * publishedWeeks cold-start backfill (PLAN-REALTIME-SCORING §4). Same paging shape
 * as the roster backfill above: one click covers every NFL pool, and the dry run
 * accumulates `plannedWrites` so the report is reviewable evidence rather than a
 * count. Idempotent — a second live run reports poolsChanged: 0.
 */
const runPublishedWeeksBackfill = async (dryRun: boolean) => {
  let cursor: string | undefined;
  let pages = 0;
  const agg = { dryRun, poolsScanned: 0, poolsChanged: 0, weeksMarked: 0, plannedWrites: [] as any[], failures: [] as any[] };
  do {
    // Same undefined→null wire trap as runBackfill above.
    const r: any = await call('backfillPublishedWeeks', { dryRun, limit: 200, ...(cursor ? { startAfter: cursor } : {}) });
    // EVERY numeric counter — the third loop that hand-listed them.
    addReportPage(agg, r);
    if (Array.isArray(r.plannedWrites)) agg.plannedWrites.push(...r.plannedWrites);
    if (Array.isArray(r.failures)) agg.failures.push(...r.failures);
    cursor = r.nextCursor || undefined;
    pages++;
  } while (cursor && pages < 100);
  return agg;
};

/**
 * Payment-truth reconciliation (PLAN-PAYMENT-TRUTH P2). Same paging shape as
 * the publishedWeeks backfill: counters aggregate across pages; the capped
 * plannedFixes list makes the dry run reviewable evidence, and per Q5 the dry
 * run IS the divergence count. Idempotent, so an aborted run is simply re-run
 * from the start — everything already fixed reads back as consistent.
 */
/** Page-cap park for the reconciliation, keyed by dryRun: cursor + the partial
 *  report so a resumed click reports the WHOLE run, not just its own pages
 *  (codex r2/r3 — same lesson as backfillResume: counters are the evidence on
 *  a money migration). Cleared on a clean finish. */
const reconcileResume = new Map<boolean, { cursor: string; partial: ResumableReport; plannedFixes: any[] }>();

const runReconcilePaymentTruth = async (dryRun: boolean) => {
  const parked = reconcileResume.get(dryRun);
  let cursor: string | undefined = parked?.cursor;
  let pages = 0;
  const agg = {
    ok: true, dryRun,
    // Declared so an EMPTY run still renders every counter as 0 rather than
    // omitting it — an absent key reads as "not applicable", a 0 reads as
    // "checked, none". `addReportPage` sums whatever the server sends either way.
    poolsScanned: 0, membersPromoted: 0, staleSummariesRepaired: 0, countsStamped: 0,
    entriesMirrored: 0, alreadyConsistent: 0, entriesPaidNoMember: 0,
    ambiguousSkipped: 0, entriesPaidNotLiable: 0, testPoolsSkipped: 0, otherTypeSkipped: 0,
    failures: [] as any[], plannedFixes: [] as any[], plannedFixesTruncated: false,
    resumedFrom: parked?.cursor ?? null,
  };
  if (parked) {
    foldParkedReport(agg, parked.partial);
    agg.plannedFixes.push(...parked.plannedFixes);
  }
  do {
    // Cursor sent only when present — the JS SDK encodes explicit-undefined as
    // null on the wire (the schema also takes null, belt + suspenders, #296).
    const r: any = await call('reconcilePaymentTruth', { dryRun, limit: 25, ...(cursor ? { startAfter: cursor } : {}) }, BACKFILL_TIMEOUT_MS);
    agg.ok = agg.ok && r.ok !== false;
    // EVERY numeric counter, not a list maintained by hand. The list dropped
    // three of them in production — see `addReportPage`.
    addReportPage(agg, r);
    if (Array.isArray(r.failures)) agg.failures.push(...r.failures);
    // Enforce the documented 50-item cap GLOBALLY, not per page (codex r5):
    // each page can return up to 25 fixes with its own flag false, so an
    // unbounded aggregate would bury the counters the Run Log exists to show.
    if (Array.isArray(r.plannedFixes)) {
      const room = 50 - agg.plannedFixes.length;
      agg.plannedFixes.push(...r.plannedFixes.slice(0, Math.max(0, room)));
      if (r.plannedFixes.length > room) agg.plannedFixesTruncated = true;
    }
    agg.plannedFixesTruncated = agg.plannedFixesTruncated || r.plannedFixesTruncated === true;
    cursor = r.nextCursor || undefined;
    pages++;
  } while (cursor && pages < 100);
  if (cursor) {
    // Page-cap exit with pools left (codex r1): report it as incomplete, park
    // the cursor AND the partial counters so the NEXT click continues from
    // here and its final report covers the whole run (codex r2/r3).
    reconcileResume.set(dryRun, { cursor, partial: snapshotReport(agg), plannedFixes: [...agg.plannedFixes] });
    agg.ok = false;
    agg.failures.push({ poolId: '(page cap)', error: `stopped after 100 pages with pools remaining; click Run again to resume from ${cursor}` });
  } else {
    reconcileResume.delete(dryRun);
  }
  return agg;
};

const ACTIONS: OpAction[] = [
  {
    id: 'recalculateGlobalStats',
    label: 'Recalculate Global Stats',
    description: 'Recompute all-time prize volume and charity totals from every locked pool and overwrite stats/global.',
    blastRadius: 'Overwrites the public stats/global document.',
    destructive: true,
    icon: RefreshCw,
    run: () => call('recalculateGlobalStats'),
  },
  {
    id: 'syncAllUsers',
    label: 'Sync All Users',
    description: 'Reconcile Firebase Auth accounts into the users collection.',
    blastRadius: 'Writes to the users collection.',
    destructive: false,
    icon: Users,
    run: () => call('syncAllUsers'),
  },
  {
    id: 'backfillPools:dry',
    label: 'Backfill Pools (dry run)',
    description: 'Report how many writes the pool backfill would perform (base fields, managed-pool indexes, historical stats). Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports plannedWrites.',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('backfillPools', { dryRun: true }),
  },
  {
    id: 'backfillPools',
    label: 'Backfill Pools',
    description: 'Backfill missing base fields + managed-pool indexes across all pools. NOT idempotent — the historical-stats leg increments user totals, so a second run double-counts. Dry-run first.',
    blastRadius: 'Batched writes across every pool + user (thousands of docs). Increments users/{uid}.historicalStats — re-running double-counts.',
    destructive: true,
    icon: Database,
    run: () => call('backfillPools', { dryRun: false }),
  },
  {
    id: 'syncPlayoffPools',
    label: 'Sync Playoff Pools',
    description: 'Re-sync playoff pool results/standings from current global results.',
    blastRadius: 'Recomputes every playoff pool.',
    destructive: true,
    icon: Trophy,
    run: () => call('syncPlayoffPools'),
  },
  {
    id: 'backfillMemberRecords:dry',
    label: 'Backfill Member Roster — active only (dry run)',
    description: 'Report how many members (incl. commissioners / no-entry members) would be added to each pool roster, across ACTIVE pools only. Read finishedPoolsSkipped in the result — that is how many more pools the "incl. finished" variant below would reach. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports invariant counts.',
    destructive: false,
    icon: CheckCircle2,
    run: () => runBackfill(true),
  },
  {
    id: 'backfillMemberRecords',
    label: 'Backfill Member Roster — active only',
    description: 'Create Member Records for every existing member (incl. commissioners and members with no entry) across ACTIVE pools. Skips finished/canceled/archived pools. Idempotent — skips members already present.',
    blastRadius: 'Creates pools/{id}/members docs across active pools; sets rosterSchemaVersion per pool.',
    destructive: true,
    icon: Users,
    run: () => runBackfill(false),
  },
  {
    id: 'backfillMemberRecordsFinished:dry',
    label: 'Backfill Member Roster incl. finished (dry run)',
    description: 'Same as above but ALSO covers COMPLETED / CANCELED / archived / final pools — the historical pools whose dues the all-time total is currently missing (D25). Sim-harness pools and any pool you have marked isTestPool are still skipped, and no option here can include them. NFL preseason pools ARE included: they count toward no published stat, but they are the pilot and their payment controls need Member Records. Writes nothing. Run this before the live version.',
    blastRadius: 'Read-only — no writes. Reports invariant counts incl. testPoolsSkipped.',
    destructive: false,
    icon: CheckCircle2,
    run: () => runBackfill(true, true),
  },
  {
    id: 'backfillMemberRecordsFinished',
    label: 'Backfill Member Roster incl. finished',
    description: 'Create Member Records across ALL non-sim pools including finished ones. This is the D25 repair, and it must run BEFORE Recalculate Global Stats — backfilling afterwards means the recalculate published an under-count and nobody re-ran it. Idempotent.',
    blastRadius: 'Creates pools/{id}/members docs across every non-sim pool, finished ones included; sets rosterSchemaVersion per pool.',
    destructive: true,
    icon: Users,
    run: () => runBackfill(false, true),
  },
  {
    id: 'reconcilePaymentTruth:dry',
    label: 'Reconcile Payment Truth (dry run)',
    description: 'THE DIVERGENCE COUNT (PLAN-PAYMENT-TRUTH P2). Reports every NFL season pool member whose two payment stores disagree: entry says PAID while the Member Record says UNPAID (the pre-P1 Bento write — their dues are missing from the pot), or Member Record PAID while the entry display says UNPAID. Members with payments-ledger history are never auto-promoted — they show as AMBIGUOUS_SKIPPED for you to resolve by hand, because their UNPAID record may be a deliberate later un-mark. Lists the planned fixes (capped at 50). If entriesPaidNoMember is NONZERO, re-run the incl.-finished roster backfill first. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports divergence counts + planned fixes.',
    destructive: false,
    icon: CheckCircle2,
    run: () => runReconcilePaymentTruth(true),
  },
  {
    id: 'reconcilePaymentTruth',
    label: 'Reconcile Payment Truth',
    description: 'Applies the fixes the dry run counted: promotes Member Records where the entry recorded a pre-P1 payment (and appends the missing payments-ledger row), and mirrors entry displays where the Member Record is already PAID. NFL season pools only; sim and isTestPool pools are never touched. Run AFTER the roster backfill and BEFORE Recalculate Global Stats. Idempotent.',
    blastRadius: 'Writes members.paidStatus + payments ledger rows + entry display fields on diverged NFL pools; recomputes roster summaries and commissioner aggregates.',
    destructive: true,
    icon: Users,
    run: () => runReconcilePaymentTruth(false),
  },
  {
    id: 'backfillProfileData:dry',
    label: 'Backfill Profile Data (dry run)',
    description: 'Report how many scored weeks, fee stamps, and finalizations the Player Profile backfill would perform across non-sim NFL pools. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports per-pool counts.',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('backfillProfileData', { dryRun: true }),
  },
  {
    id: 'backfillProfileData',
    label: 'Backfill Profile Data',
    description: 'Re-grade scored weeks of non-sim NFL pools into per-pick weeklyResults, stamp estimated feeOwed on Member Records, write standings projections, finalize season-complete pools, and recompute affected profiles. Never fabricates payouts. Batched (25 pools/run, resume cursor in the result).',
    blastRadius: 'Writes weeklyResults/resultsVersion on NFL entries, feeOwed on Member Records, standings docs, seasonHistory + finalize markers, publicProfiles.',
    destructive: true,
    icon: Wrench,
    run: () => call('backfillProfileData', { dryRun: false }),
  },
  {
    id: 'backfillPublishedWeeks:dry',
    label: 'Backfill Published Weeks (dry run)',
    description: 'Report which already-scored NFL weeks would be stamped as published, per pool. Read the plannedWrites list and confirm those weeks really were scored before running it live. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports plannedWrites per pool.',
    destructive: false,
    icon: CheckCircle2,
    run: () => runPublishedWeeksBackfill(true),
  },
  {
    id: 'backfillPublishedWeeks',
    label: 'Backfill Published Weeks',
    description: 'Stamp pool.publishedWeeks for weeks scored BEFORE the auto-scorer started writing that marker. The extendWeekDeadline guard reads it to refuse reopening a week whose results members have already seen — without this, legacy weeks are still extendable. Marker-only and idempotent: a second run reports zero.',
    blastRadius: 'Writes publishedWeeks.{week} on NFL pools. Nothing else on the doc is touched. Conservative by design: a week may be marked published that could technically still have been extended.',
    destructive: true,
    icon: Wrench,
    run: () => runPublishedWeeksBackfill(false),
  },
  {
    id: 'runNFLSpreadFreeze:dry',
    label: 'Freeze Next Week (dry run)',
    description: 'Fetch the slate that is due for the next freeze and report the exact line it would write for every game, and whether each came from the ESPN feed or from the working line in the Spread Manager. Writes nothing. This is the rehearsal — a Tuesday-only schedule cannot rehearse itself, so run it on the days before.',
    blastRadius: 'Read-only — no writes. Reports the slate, every planned value, and any game with no line at all.',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('runNFLSpreadFreeze', { dryRun: true }),
  },
  {
    id: 'runNFLSpreadFreeze',
    label: 'Freeze Next Week (LIVE)',
    description: 'Freeze the due slate for real: every game of the week gets its line written to nfl_frozen_spreads, all at once or not at all. A slate can be frozen ONLY ONCE — after this, changing a line takes the audited override. Refused before the stated cutoff for that slate (Tuesday 09:00 ET), so this is the RETRY for a Tuesday pass that refused, not a way to freeze early.',
    blastRadius: 'Creates nfl_frozen_spreads records for one slate. Irreversible through the app: no client can write or delete that collection. Does NOT touch nfl_games.',
    destructive: true,
    icon: Wrench,
    run: () => call('runNFLSpreadFreeze', { dryRun: false }),
  },
  {
    id: 'backfillFrozenSpreads:dry',
    label: 'Migrate Legacy Locks (dry run)',
    description: 'Report which already-locked nfl_games spreads would get an nfl_frozen_spreads record at cutover. Read plannedWrites and confirm the values are the ones those weeks were actually played on. Writes nothing. Needs system/config.nflFrozenSpreadBackfill.enabled = true first.',
    blastRadius: 'Read-only — no writes. Reports plannedWrites, plus any locked game skipped for having no usable value or a malformed slate.',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('backfillFrozenSpreads', { dryRun: true, limit: 500 }),
  },
  {
    id: 'backfillFrozenSpreads',
    label: 'Migrate Legacy Locks',
    description: 'Write an nfl_frozen_spreads record for every game already locked the old way, so a slate locked before the freeze shipped is covered by the same write-once store as one the job froze. A PRECONDITION of the freeze pass, not a tidy-up. Idempotent: a second run reports zero written. If the result carries a nextCursor, run it again.',
    blastRadius: 'Creates nfl_frozen_spreads records (source: backfill, legacy: true) for currently-locked games. Never overwrites an existing record. Does NOT touch nfl_games.',
    destructive: true,
    icon: Wrench,
    run: () => call('backfillFrozenSpreads', { dryRun: false, limit: 500 }),
  },
  {
    id: 'fixParticipantIds:dry',
    label: 'Audit Participant IDs (dry run)',
    description: 'Report participant-index drift without writing anything.',
    blastRadius: 'Read-only — no writes.',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('fixParticipantIds', { dryRun: true }),
  },
  {
    id: 'fixParticipantIds',
    label: 'Fix Participant IDs',
    description: 'Repair participant-index drift across pools.',
    blastRadius: 'Writes corrected participant indexes.',
    destructive: true,
    icon: Wrench,
    run: () => call('fixParticipantIds', { dryRun: false }),
  },
  {
    id: 'clearLegacyCoManagers:dry',
    label: 'Audit legacy coManagers (dry run)',
    description: 'PLAN-CO-COMMISSIONERS D2 step 2. Count pools still carrying a coManagers array (invariant: nonEmpty 0, malformed 0, withRevision 0; an empty array grants nothing). The field was client-writable until the rules lock; nothing may read it again until this reports zero. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports scanned / withField / nonEmpty / malformed + samples, plus the D3 ownerId≠createdByUid census (ownerMismatch, expected 0).',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('clearLegacyCoManagers', { dryRun: true }),
  },
  {
    id: 'clearLegacyCoManagers',
    label: 'Clear legacy coManagers',
    description: 'Delete the coManagers AND coManagersRevision fields from every pool that carries either (both were client-writable; absent revision = 0). Idempotent — a second run reports nonEmpty 0. Run once after the rules lock deploys, before T2b/T3.',
    blastRadius: 'Deletes pool.coManagers + pool.coManagersRevision on affected pools. Nothing else on the doc. Writes one admin_audit row (CLEAR_LEGACY_CO_MANAGERS).',
    destructive: true,
    icon: Wrench,
    run: () => call('clearLegacyCoManagers', { dryRun: false }),
  },
  {
    id: 'sweepSimRuns:dry',
    label: 'Sweep Stranded Sim Runs (dry run)',
    description: 'List Sim Runs whose manifest is not CLEANED/SWEPT (a run that died mid-scenario), plus any pre-manifest pools still carrying a simRunId. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports stranded run ids + their pools.',
    destructive: false,
    icon: CheckCircle2,
    run: () => call('sweepSimRuns', { dryRun: true }),
  },
  {
    id: 'sweepSimRuns',
    label: 'Sweep Stranded Sim Runs',
    description: 'Clean every stranded Sim Run from its manifest: surviving Test Pool trees, sim-subject users/publicProfiles, synthetic games, and sim consensus docs. Marks each manifest SWEPT. Touches ONLY simRunId-verified data (max 10 runs per sweep).',
    blastRadius: 'Deletes sim-namespaced pools/users/profiles/games/consensus for stranded runs. Never touches real data — every target is simRunId-verified.',
    destructive: true,
    icon: Wrench,
    run: () => call('sweepSimRuns', { dryRun: false }),
  },
  {
    id: 'fixPoolScores',
    label: 'Fix Pool Scores (global)',
    description: 'Re-run scoring across every in-progress/final pool (no poolId = global). Repairs missed score/winner updates.',
    blastRadius: 'Re-scores and may rewrite winners on all live/final pools.',
    destructive: true,
    icon: Wrench,
    run: () => call('fixPoolScores'),
  },
  {
    id: 'scoreBracketEntries',
    label: 'Score Bracket Entries (global)',
    description: 'Re-score every tournament that has at least one linked BRACKET pool (no tournamentId = all active).',
    blastRadius: 'Recomputes entry scores across all active bracket tournaments.',
    destructive: true,
    icon: Trophy,
    run: () => call('scoreBracketEntries'),
  },
  {
    id: 'initializeBig12TournamentHttp',
    label: 'Re-init Big 12 Tournament',
    description: 'Reset the Big 12 conference tournament skeleton.',
    blastRadius: 'Overwrites the Big 12 tournament document.',
    destructive: true,
    icon: Trophy,
    run: () => call('initializeBig12TournamentHttp'),
  },
  {
    id: 'initializeBigEastTournamentHttp',
    label: 'Re-init Big East Tournament',
    description: 'Reset the Big East conference tournament skeleton.',
    blastRadius: 'Overwrites the Big East tournament document.',
    destructive: true,
    icon: Trophy,
    run: () => call('initializeBigEastTournamentHttp'),
  },
];

/**
 * Pool Password Migration (PLAN-AUDIT-AUTH-HARDENING-SWEEPS.md S1).
 *
 * A SEPARATE card rather than another `ACTIONS` entry, for three reasons that
 * the generic card cannot meet:
 *
 *  1. It takes PARAMETERS (`dryRun`, `limit`, `startAfter`). `OpAction.run` is
 *     a nullary closure.
 *  2. The Run Log truncates every result at 400 characters. `plannedWrites` is
 *     the whole point of the dry run — the sweep doc's instruction is "read
 *     plannedWrites in full … if a pool you did not expect appears, stop" — and
 *     a truncated blob cannot be read in full. This card renders the raw JSON.
 *  3. The kill-switch refusal is the EXPECTED outcome of the doc's step 1, not
 *     an error. It gets its own plainly-worded panel instead of being buried in
 *     a truncated one-line log entry.
 *
 * It is a CALLER and nothing else. Both server gates are unreachable from here:
 * the callable refuses outright unless `system/config.poolPasswordMigration
 * .enabled === true`, and it forces `dryRun` whenever EITHER that config says
 * dry OR this checkbox is ticked. Unticking the box cannot make a run live on
 * its own — the copy below says so, because an operator who believes otherwise
 * would read "dryRun: true" in the report as a bug rather than as the config
 * still doing its job.
 *
 * SUPER_ADMIN gating is inherited, not re-implemented: SuperAdmin.tsx renders
 * this whole panel only inside the admin route, and the callable itself carries
 * `role: "SUPER_ADMIN"`. A second client-side check here would be decoration.
 */
const MIGRATION_DEFAULT_LIMIT = 100;
/** See `limitValid` below — bounded by the callable's plannedWrites cap, not by its schema. */
const MIGRATION_MAX_LIMIT = 200;

const PoolPasswordMigrationCard: React.FC = () => {
  const toast = useToast();
  // Requirement: the dry-run box starts CHECKED. Going live is a deliberate act
  // — two of them, counting the config.
  const [dryRun, setDryRun] = useState(true);
  const [limitInput, setLimitInput] = useState(String(MIGRATION_DEFAULT_LIMIT));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which button opened the confirm modal: a fresh pass, or the next page. */
  const [pending, setPending] = useState<null | 'start' | 'continue'>(null);
  /**
   * EVERY page of the current pass, oldest first — not just the latest one
   * (codex r2, P2). Step 4 of the arming procedure is "page through … keep
   * every report", and a card that replaced the report on each Continue
   * destroyed page 1's `plannedWrites` the moment page 2 arrived. The server's
   * own `admin_audit` row keeps only the first 100 planned writes, so nothing
   * else in the system holds the full list either.
   *
   * `requestedDryRun` is stored per page because it is what decides whether the
   * cursor may be resumed, and the report's own `dryRun` because the config can
   * force a page dry regardless of what was asked for.
   */
  const [pages, setPages] = useState<Array<{
    page: number;
    requestedDryRun: boolean;
    report: MigratePoolPasswordsReport;
  }>>([]);

  const latest = pages.length > 0 ? pages[pages.length - 1] : null;
  const report = latest?.report ?? null;
  const page = latest?.page ?? 0;
  /**
   * The mode the LATEST page was produced under — both what the operator asked
   * for and what the server actually did. A cursor is only meaningful inside one
   * pass, and these two values decide whether the pass the cursor belongs to is
   * the same pass the next click would run (codex r1, P1).
   */
  const pass = latest && !latest.report.skipped
    ? { requestedDryRun: latest.requestedDryRun, effectiveDryRun: latest.report.dryRun }
    : null;

  // The cursor is CARRIED, not copied by hand. `skipped` responses have no
  // `nextCursor` at all, so a refusal never leaves a stale cursor armed.
  const cursorFromReport = report && !report.skipped ? report.nextCursor ?? null : null;

  /**
   * Pools this page could not process. The callable catches per-pool errors and
   * keeps going, so a page can carry failures AND a cursor — and the cursor is
   * already PAST the pools that failed (codex r2, P1). Resuming from it would
   * step over them for the rest of the pass, and on a live run their plaintext
   * would stay on the public document while the card showed a finished sweep.
   */
  const failures = report && !report.skipped ? report.failures ?? [] : [];
  const hasFailures = failures.length > 0;

  /**
   * WHY A CURSOR CAN GO STALE WITHOUT THE REPORT CHANGING (codex r1, P1).
   *
   * `startAfter` skips everything BEFORE it, so resuming from a cursor is only
   * correct if the earlier pages did the same thing this page is about to do.
   * Two ways that stops being true, both of which the operator can reach by
   * ticking one box:
   *
   *  1. Page 1 ran DRY and returned a cursor; the operator unticks the box and
   *     clicks Continue. Pools 1..N are skipped by the live sweep entirely and
   *     keep their plaintext on the public document — the exact outcome this
   *     whole sweep exists to prevent, arrived at through the resume control.
   *  2. The operator unticked the box but `system/config` is still dry, so the
   *     pass wrote NOTHING while reporting pages. Continuing after Kevin fixes
   *     the config would resume past pools nothing has touched.
   *
   * So: same requested mode, and — when a write is being asked for — the pass
   * so far must actually have been writing. Anything else disables Continue and
   * says why. The cursor is still SHOWN; it is the resume that is withheld.
   */
  const cursorUsable = Boolean(
    cursorFromReport && pass && !hasFailures && dryRun === pass.requestedDryRun && (dryRun || !pass.effectiveDryRun),
  );
  const cursorStaleReason = !cursorFromReport || cursorUsable
    ? null
    : hasFailures
      ? `this page reported ${failures.length} failure(s), and the cursor is already past the pools that failed. Resuming would step over them for the rest of the pass. Fix the cause and run the pass again from the beginning — the sweep is idempotent, so a pool already done costs a no-op.`
      : pass && dryRun !== pass.requestedDryRun
        ? `the pages so far ran as a ${pass.requestedDryRun ? 'dry run' : 'LIVE run'}, and the box now asks for a ${dryRun ? 'dry run' : 'LIVE run'}. Resuming would skip every pool those pages already covered.`
        : 'the server forced this pass dry (system/config.poolPasswordMigration.dryRun is still true), so nothing has been written yet. Set that to false, then start the pass again from the beginning.';
  const nextCursor = cursorUsable ? cursorFromReport : null;

  const parsedLimit = Number(limitInput);
  // 200, not the schema's 500: the callable stops appending to `plannedWrites`
  // at 200 entries (migratePoolPasswords.ts:153). A larger page could therefore
  // change pools this card does not list, while the card tells the operator to
  // read the list in full and stop on anything unexpected — an instruction the
  // UI would be quietly unable to honour (codex r1, P2). This narrows the UI
  // only; the server schema still accepts 1..500.
  const limitValid = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= MIGRATION_MAX_LIMIT;

  const run = async (mode: 'start' | 'continue') => {
    setPending(null);
    // Belt for the Continue path: the button is disabled without a usable
    // cursor, but a `continue` that fell through with `startAfter: null` would
    // silently RESTART the sweep at pool #1 while labelling itself the next
    // page — a live pass would then re-scan pools it had already done and the
    // page numbers in `admin_audit` would describe a run that never happened.
    if (mode === 'continue' && !nextCursor) return;
    setRunning(true);
    setError(null);
    const startAfter = mode === 'continue' ? nextCursor : null;
    const pageNumber = mode === 'continue' ? page + 1 : 1;
    try {
      const result = await dbService.migratePoolPasswords({
        dryRun,
        limit: limitValid ? parsedLimit : MIGRATION_DEFAULT_LIMIT,
        startAfter,
      });
      // A fresh pass REPLACES the history; a continuation appends to it. A
      // refusal replaces it too — it read nothing and returned no cursor, so it
      // must not leave a previous pass's pages (or its mode) standing behind it.
      const entry = { page: pageNumber, requestedDryRun: dryRun, report: result };
      setPages((prev) => (mode === 'continue' && !result.skipped ? [...prev, entry] : [entry]));
      const failed = !result.skipped && (result.failures?.length ?? 0) > 0;
      if (result.skipped) {
        // NOT a toast.error: the doc's step 1 is a deliberately disarmed call
        // whose whole purpose is to watch the gate refuse. Calling that a
        // failure would train the operator to ignore the one signal that proves
        // the kill-switch works.
        toast.info('Migration refused by the kill-switch — see the card.');
      } else if (failed) {
        // A page that left pools unprocessed did NOT succeed, whatever the
        // counters say — the panel's own convention is that a REPORTED failure
        // is audited as an error, not just a thrown one.
        toast.error(`Pool password sweep page ${pageNumber} left ${result.failures!.length} pool(s) unprocessed — read the report.`);
      } else {
        toast.success(`Pool password sweep page ${pageNumber} (${result.dryRun ? 'dry run' : 'LIVE'}) finished.`);
      }
      await dbService.logAdminAction({
        action: 'OP_MIGRATEPOOLPASSWORDS',
        status: failed ? 'error' : 'success',
        metadata: {
          label: 'Pool Password Migration',
          requestedDryRun: dryRun,
          effectiveDryRun: result.dryRun,
          page: pageNumber,
          resumedFrom: startAfter,
          skipped: result.skipped ?? null,
          poolsScanned: result.poolsScanned,
          poolsChanged: result.poolsChanged,
          failures: result.failures?.length ?? 0,
          nextCursor: result.nextCursor ?? null,
        },
      });
    } catch (e) {
      const msg = getUserMessage(e, 'Pool password migration failed.');
      setError(msg);
      toast.error(msg);
      await dbService.logAdminAction({
        action: 'OP_MIGRATEPOOLPASSWORDS',
        status: 'error',
        error: msg,
        // The cursor the failed page STARTED from, so a retry resumes from a
        // page that was never applied rather than from pool #1.
        metadata: { label: 'Pool Password Migration', requestedDryRun: dryRun, page: pageNumber, resumedFrom: startAfter },
      });
    } finally {
      setRunning(false);
    }
  };

  const modalTitle = pending === 'continue' ? 'Pool Password Migration — next page' : 'Pool Password Migration';
  const modalDescription = dryRun
    ? `DRY RUN. Reads pools${pending === 'continue' ? ' starting after the cursor below' : ' from the beginning'} and reports what it WOULD change. Writes nothing. Read plannedWrites in full before going live — if a pool you did not expect appears, stop and investigate.`
    : `LIVE. Moves password material off pools/{id} into pools/{id}/private/access and DELETES the public copies. There is no rollback for the deletions. The server still refuses to write unless system/config.poolPasswordMigration.dryRun is also false.`;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6" data-testid="pool-password-migration">
      <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
        <KeyRound size={20} className="text-amber-400" /> Pool Password Migration
      </h3>
      <p className="text-sm text-slate-400 mb-4">
        Evacuates legacy <span className="font-mono">gridPassword</span> / <span className="font-mono">accessControl.password</span> /{' '}
        <span className="font-mono">passwordHash</span> off the world-readable <span className="font-mono">pools/{'{id}'}</span> document
        into <span className="font-mono">pools/{'{id}'}/private/access</span>. Follow PLAN-AUDIT-AUTH-HARDENING-SWEEPS.md §S1 —
        run it dry, read <span className="font-mono">plannedWrites</span> in full, then arm and run it live.
      </p>

      <p className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-4">
        <span className="font-bold uppercase tracking-wider">Two switches, both server-side.</span>{' '}
        Nothing here runs at all until <span className="font-mono">system/config.poolPasswordMigration.enabled = true</span>, and
        nothing WRITES until that same config has <span className="font-mono">dryRun = false</span> <em>and</em> the box below is
        unticked. Unticking the box on its own leaves the run dry — that is the config doing its job, not a bug.
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <label htmlFor="ppm-dry-run" className="flex items-center gap-2 text-sm text-slate-200">
          <input
            id="ppm-dry-run"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={running}
            className="w-4 h-4 accent-indigo-500"
          />
          Dry run (writes nothing)
        </label>

        <label htmlFor="ppm-limit" className="flex flex-col gap-1 text-xs text-slate-400">
          Pools per page (1–{MIGRATION_MAX_LIMIT}, the report&apos;s own cap)
          <input
            id="ppm-limit"
            type="number"
            min={1}
            max={MIGRATION_MAX_LIMIT}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            disabled={running}
            className={`w-28 bg-slate-950 border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-indigo-500 ${limitValid ? 'border-slate-700' : 'border-rose-500'}`}
          />
        </label>
      </div>

      {!dryRun && (
        <p className="text-xs font-bold uppercase tracking-wider text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 mb-4 flex items-center gap-2">
          <ShieldAlert size={14} className="shrink-0" />
          Live mode requested — deletions are irreversible. The dry run is your only rollback.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setPending('start')}
          disabled={running || !limitValid}
          className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 border ${dryRun ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30' : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border-rose-500/30'}`}
        >
          {running ? 'Running…' : dryRun ? 'Run sweep (dry run)' : 'Run sweep (LIVE)'}
        </button>
        <button
          onClick={() => setPending('continue')}
          disabled={running || !nextCursor || !limitValid}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <ArrowRight size={14} /> Continue from cursor
        </button>
      </div>

      {error && (
        <p className="mt-4 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 break-all">
          {error}
        </p>
      )}

      {report?.skipped && (
        // Requirement 1: the refusal is rendered VERBATIM, not swallowed into a
        // generic error toast. This exact string is what step 1 of the arming
        // procedure is looking for.
        <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3" data-testid="migration-skipped">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-1">Refused by the kill-switch</p>
          <p className="text-sm text-amber-100 font-mono break-all">{report.skipped}</p>
          <p className="text-xs text-slate-400 mt-2">
            Nothing was read and nothing was written. This is the expected result of step 1 — the gate proving itself. To
            proceed, set <span className="font-mono">poolPasswordMigration = {'{ enabled: true, dryRun: true }'}</span> on{' '}
            <span className="font-mono">system/config</span> in the Firebase console and run it again.
          </p>
        </div>
      )}

      {report && !report.skipped && (
        <div className="mt-4 space-y-3">
          <div
            className={`rounded-lg border px-4 py-3 ${cursorFromReport ? (cursorUsable ? 'border-amber-400/30 bg-amber-400/10' : 'border-rose-500/30 bg-rose-500/10') : 'border-emerald-500/30 bg-emerald-500/10'}`}
            data-testid="migration-cursor-status"
          >
            <p className="text-sm font-bold text-white">
              Page {page} — {report.dryRun ? 'dry run (nothing written)' : 'LIVE (writes applied)'} · scanned {report.poolsScanned} ·
              changed {report.poolsChanged}
            </p>
            {cursorFromReport && cursorUsable && (
              <p className="text-xs text-amber-200 mt-1 break-all">
                More pools remain. Click <span className="font-bold">Continue from cursor</span> to run the next page from{' '}
                <span className="font-mono">{cursorFromReport}</span>.
              </p>
            )}
            {cursorFromReport && !cursorUsable && (
              <p className="text-xs text-rose-200 mt-1 break-all" data-testid="migration-cursor-stale">
                More pools remain (<span className="font-mono">{cursorFromReport}</span>) but this cursor can no longer be
                resumed: {cursorStaleReason} Start the pass again from the beginning.
              </p>
            )}
            {!cursorFromReport && (
              <p className="text-xs text-emerald-200 mt-1">
                <span className="font-mono">nextCursor</span> is null — this pass has reached the end of the pool collection.
              </p>
            )}
          </div>

          {hasFailures && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3" data-testid="migration-failures">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-300 mb-1">
                {failures.length} pool(s) not processed on this page
              </p>
              <p className="text-xs text-rose-100">
                The callable keeps going past a pool it cannot process, so this page has a cursor that is already PAST them.
                Paging on would step over these pools for the rest of the pass — so Continue is disabled. Fix the cause and
                run the pass again from the beginning; the sweep is idempotent, so a pool already done costs a no-op. The
                per-pool errors are in the report below.
              </p>
            </div>
          )}

          {/* Requirement 3: the WHOLE report, not a count — and EVERY page of the
              pass, not just the last one (codex r2 P2). The sweep doc tells the
              operator to read plannedWrites, stop on anything unexpected, and
              keep every report, so nothing here is summarised away, truncated,
              or replaced when the next page arrives. */}
          <div className="space-y-2" data-testid="migration-reports">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Full reports — {pages.length} page{pages.length === 1 ? '' : 's'} of this pass, newest first
            </p>
            {[...pages].reverse().map((entry) => (
              <div key={entry.page}>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
                  Page {entry.page} — requested {entry.requestedDryRun ? 'dry run' : 'LIVE'}, server ran{' '}
                  {entry.report.dryRun ? 'dry' : 'LIVE'}
                </p>
                <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 font-mono overflow-auto max-h-96 whitespace-pre-wrap break-all">
                  {JSON.stringify(entry.report, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={pending !== null}
        title={modalTitle}
        description={modalDescription}
        blastRadius={
          dryRun
            ? 'Read-only — no writes. Reports plannedWrites per pool.'
            : 'Deletes gridPassword / accessControl.password / passwordHash from every scanned pool and writes the hash to pools/{id}/private/access. Irreversible.'
        }
        confirmToken={dryRun ? undefined : 'RUN'}
        destructive={!dryRun}
        confirmLabel={pending === 'continue' ? 'Run next page' : 'Run sweep'}
        onConfirm={() => pending && run(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};

export const OperationsPanel: React.FC = () => {
  const toast = useToast();
  const [pending, setPending] = useState<OpAction | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ id: string; ok: boolean; text: string }>>([]);

  const execute = async (action: OpAction) => {
    setPending(null);
    setRunning(action.id);
    try {
      const result = await action.run();
      // An op that RETURNS `ok: false` did not succeed — it reported a failure
      // instead of throwing one, which is how the roster backfill surfaces a
      // partial run together with the cursor needed to resume it. Logging that as
      // a green line, and auditing it as a success, would be the same lie as
      // swallowing an exception.
      const ok = (result as { ok?: unknown } | null)?.ok !== false;
      // 400, not 160: a migration's dry run IS its evidence, and at 160 the roster
      // backfill's report (226 chars with every count at zero) lost its last three
      // counters — including the finished-pool count its own card tells the operator
      // to read before running the destructive variant. Truncation is still the
      // design, for the ops that return unbounded plannedWrites arrays.
      setLog((prev) => [{ id: action.id, ok, text: `${action.label}: ${JSON.stringify(result).slice(0, 400)}` }, ...prev]);
      if (ok) toast.success(`${action.label} completed.`);
      else toast.error(`${action.label} did not complete — read the Run Log.`);
      await dbService.logAdminAction({ action: `OP_${action.id.toUpperCase()}`, status: ok ? 'success' : 'error', metadata: { label: action.label } });
    } catch (e) {
      const msg = getUserMessage(e, `${action.label} failed.`);
      setLog((prev) => [{ id: action.id, ok: false, text: `${action.label}: ${msg}` }, ...prev]);
      toast.error(msg);
      await dbService.logAdminAction({ action: `OP_${action.id.toUpperCase()}`, status: 'error', error: msg, metadata: { label: action.label } });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2"><Wrench size={20} className="text-indigo-400" /> Global Operations</h3>
        <p className="text-sm text-slate-400 mb-6">Every action here is confirmed before it runs and recorded in the Admin Audit Log. Destructive actions require typing <span className="font-mono">RUN</span> to confirm.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ACTIONS.map((a) => (
            <div key={a.id} className={`bg-slate-800/60 border rounded-xl p-4 ${a.destructive ? 'border-rose-500/20' : 'border-slate-700'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={a.destructive ? 'text-rose-400' : 'text-indigo-400'}><a.icon size={16} /></span>
                <span className="font-bold text-white text-sm">{a.label}</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">{a.description}</p>
              <button
                onClick={() => setPending(a)}
                disabled={running === a.id}
                className={`w-full py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${a.destructive ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30' : 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30'}`}
              >
                {running === a.id ? 'Running…' : 'Run'}
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500 mt-4 border-t border-slate-800 pt-3">
          <span className="text-slate-400 font-semibold">March Madness / men&apos;s tournament re-init</span> is
          tournament-scoped (it depends on which season&apos;s bracket you mean), so it lives on the
          <span className="text-indigo-300"> Tournament</span> tab → Tournament Manager → select the tournament →
          <span className="text-indigo-300"> Re-initialize Skeleton</span>. The Big 12 / Big East cards above are
          fixed conference skeletons, which is why they can run param-lessly from here.
        </p>
      </div>

      <PoolPasswordMigrationCard />

      {log.length > 0 && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Run Log</h4>
          <div className="space-y-1 font-mono text-[11px]">
            {log.map((entry, i) => (
              <div key={i} className={`flex items-start gap-2 ${entry.ok ? 'text-slate-300' : 'text-rose-400'}`}>
                {entry.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : <XCircle size={12} className="mt-0.5 shrink-0" />}
                <span className="break-all">{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmActionModal
        open={!!pending}
        title={pending?.label ?? ''}
        description={pending?.description ?? ''}
        blastRadius={pending?.blastRadius}
        confirmToken={pending?.destructive ? 'RUN' : undefined}
        destructive={pending?.destructive}
        confirmLabel="Run operation"
        onConfirm={() => pending && execute(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};
