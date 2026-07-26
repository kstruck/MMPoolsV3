import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { dbService } from '../../services/dbService';
import { ConfirmActionModal } from './ConfirmActionModal';
import { useToast } from '../ui/Toast';
import { getUserMessage } from '../../utils/errorMessages';
import { Wrench, RefreshCw, Database, Trophy, Users, CheckCircle2, XCircle } from 'lucide-react';

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
 * Last cursor a backfill run stopped on, so clicking Run again continues instead of
 * restarting at pool #1 (codex r4). Module-scoped rather than component state because
 * ACTIONS is a module-level const whose closures cannot see a hook.
 *
 * Keyed by the run's flags: resuming a wide sweep from a narrow sweep's cursor would
 * silently skip pools. Cleared on a clean finish, so a completed migration always
 * starts over from the beginning next time.
 */
const backfillResume = new Map<string, string>();

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
  let cursor: string | undefined = backfillResume.get(resumeKey);
  const resumedFrom = cursor ?? null;
  let pages = 0;
  // 25 on the incl.-finished path, 100 otherwise. A finished pool used to cost one
  // `continue`; now it costs the full per-member walk, so the same page size is a
  // very different amount of work. 25 is the handler's own default page size and
  // matches backfillProfileData, the other migration that does per-member work.
  const limit = includeFinished ? 25 : 100;
  const agg = { ok: true, dryRun, includeFinished, poolsScanned: 0, finishedPoolsSkipped: 0, testPoolsSkipped: 0, membersCreated: 0, membersAlreadyPresent: 0, guestSkipped: 0, participantIdsWithoutMember: 0, poolsFlipped: 0, resumedFrom, resumeFrom: null as string | null, error: null as string | null, failures: [] as any[] };
  do {
    let r: any;
    try {
      r = await call('backfillMemberRecords', { dryRun, includeFinished, limit, startAfter: cursor }, BACKFILL_TIMEOUT_MS);
    } catch (e) {
      // The paging cursor lives in this closure, so an unhandled throw loses it and
      // the run can only restart from pool #1 — into the same wall. Report it AND
      // park it: `resumeFrom` is the last cursor that WAS accepted, the callable is
      // idempotent, and clicking Run again picks up from there.
      agg.ok = false;
      agg.resumeFrom = cursor ?? null;
      agg.error = e instanceof Error ? e.message : String(e);
      if (cursor) backfillResume.set(resumeKey, cursor);
      return agg;
    }
    agg.poolsScanned += r.poolsScanned || 0;
    agg.membersCreated += r.membersCreated || 0;
    agg.membersAlreadyPresent += r.membersAlreadyPresent || 0;
    agg.guestSkipped += r.guestSkipped || 0;
    agg.participantIdsWithoutMember += r.participantIdsWithoutMember || 0;
    agg.poolsFlipped += r.poolsFlipped || 0;
    agg.testPoolsSkipped += r.testPoolsSkipped || 0;
    agg.finishedPoolsSkipped += r.finishedPoolsSkipped || 0;
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
    backfillResume.set(resumeKey, cursor);
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
    const r: any = await call('backfillPublishedWeeks', { dryRun, limit: 200, startAfter: cursor });
    agg.poolsScanned += r.poolsScanned || 0;
    agg.poolsChanged += r.poolsChanged || 0;
    agg.weeksMarked += r.weeksMarked || 0;
    if (Array.isArray(r.plannedWrites)) agg.plannedWrites.push(...r.plannedWrites);
    if (Array.isArray(r.failures)) agg.failures.push(...r.failures);
    cursor = r.nextCursor || undefined;
    pages++;
  } while (cursor && pages < 100);
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
