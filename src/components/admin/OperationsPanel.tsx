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
 * admin_audit entry. Per-pool fixes (fixPoolScores, scoreBracketEntries)
 * stay as per-pool row actions in the Pools tab, per the plan's IA note.
 *
 * NOTE (remaining T7): the equivalent buttons still present in the legacy
 * Tournament/NFL/System tabs should be removed so each action lives in
 * exactly one place — deferred to a browser-verified follow-up.
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
