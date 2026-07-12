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

const call = (name: string, data: Record<string, unknown> = {}) =>
  httpsCallable(functions, name)(data).then((r) => r.data);

/**
 * Member Record roster backfill (ADR 0003). The callable pages ~100 pools per call and
 * returns a nextCursor; this loops all pages and accumulates the invariant report so one
 * click covers every pool. Dry run writes nothing.
 */
const runBackfill = async (dryRun: boolean) => {
  let cursor: string | undefined;
  let pages = 0;
  const agg = { dryRun, poolsScanned: 0, membersCreated: 0, membersAlreadyPresent: 0, guestSkipped: 0, participantIdsWithoutMember: 0, poolsFlipped: 0, failures: [] as any[] };
  do {
    const r: any = await call('backfillMemberRecords', { dryRun, limit: 100, startAfter: cursor });
    agg.poolsScanned += r.poolsScanned || 0;
    agg.membersCreated += r.membersCreated || 0;
    agg.membersAlreadyPresent += r.membersAlreadyPresent || 0;
    agg.guestSkipped += r.guestSkipped || 0;
    agg.participantIdsWithoutMember += r.participantIdsWithoutMember || 0;
    agg.poolsFlipped += r.poolsFlipped || 0;
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
    id: 'backfillPools',
    label: 'Backfill Pools',
    description: 'Backfill missing base fields + managed-pool indexes across all pools.',
    blastRadius: 'Batched writes across every pool + user (thousands of docs).',
    destructive: true,
    icon: Database,
    run: () => call('backfillPools'),
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
    label: 'Backfill Member Roster (dry run)',
    description: 'Report how many members (incl. commissioners / no-entry members) would be added to each pool roster. Writes nothing.',
    blastRadius: 'Read-only — no writes. Reports invariant counts.',
    destructive: false,
    icon: CheckCircle2,
    run: () => runBackfill(true),
  },
  {
    id: 'backfillMemberRecords',
    label: 'Backfill Member Roster',
    description: 'Create Member Records for every existing member (incl. commissioners and members with no entry) across all pools. Idempotent — skips members already present.',
    blastRadius: 'Creates pools/{id}/members docs across every pool; sets rosterSchemaVersion per pool.',
    destructive: true,
    icon: Users,
    run: () => runBackfill(false),
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
      setLog((prev) => [{ id: action.id, ok: true, text: `${action.label}: ${JSON.stringify(result).slice(0, 160)}` }, ...prev]);
      toast.success(`${action.label} completed.`);
      await dbService.logAdminAction({ action: `OP_${action.id.toUpperCase()}`, status: 'success', metadata: { label: action.label } });
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
