import React, { useEffect, useMemo, useState } from 'react';
import { Trophy, Plus, Trash2, CheckCircle } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import type { Pool } from '../../types';

interface RecordPayoutsCardProps {
  pool: Pool;
  entries: any[]; // manager view has raw entries
}

interface AwardRow {
  uid: string;
  userName: string;
  amount: string; // input state
  kind: 'PLACE' | 'BONUS';
  place?: number;
  settled: boolean;
  note: string;
}

/**
 * Commissioner "Record payouts" flow (ADR 0005 Phase 4). Appears once the pool is
 * finalized. Prefills PLACE rows from the pool's payout places[] x final standings
 * order; bonuses must be added manually with an explicit recipient (never
 * auto-assigned). Submits to the recordPoolPayouts callable — the platform records
 * the figures; the money itself moves peer-to-peer.
 */
export const RecordPayoutsCard: React.FC<RecordPayoutsCardProps> = ({ pool, entries }) => {
  const toast = useToast();
  const castPool = pool as any;
  const [rows, setRows] = useState<AwardRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [existing, setExisting] = useState<any[]>([]);

  const finalized = !!castPool.finalizedAt || castPool.status === 'FINAL' || castPool.status === 'COMPLETED';

  useEffect(() => {
    if (!finalized) return;
    return dbService.subscribeToPayoutRecords(pool.id, setExisting);
  }, [pool.id, finalized]);

  // Standings order for prefill (client-side, same sort the standings tab shows).
  const ranked = useMemo(() => {
    const type = castPool.type;
    const list = [...entries];
    if (type === 'NFL_PICKEM') list.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    else if (type === 'NFL_MARGIN') list.sort((a, b) => (b.seasonTotal || 0) - (a.seasonTotal || 0));
    else if (type === 'NFL_SURVIVOR') {
      list.sort((a, b) => {
        const aAlive = a.status !== 'ELIMINATED' ? 1 : 0;
        const bAlive = b.status !== 'ELIMINATED' ? 1 : 0;
        return bAlive - aAlive || (b.eliminatedWeek || 0) - (a.eliminatedWeek || 0);
      });
    }
    return list;
  }, [entries, castPool.type]);

  const prefill = () => {
    const places: Array<{ place?: number; percentage?: number; amount?: number }> =
      castPool.payoutSettings?.places || castPool.payouts?.places || [];
    const fee = Number(castPool.settings?.entryFee ?? 0);
    const pot = fee * entries.length;
    const next: AwardRow[] = places.map((p, idx) => {
      const winner = ranked[idx];
      const suggested = p.amount ?? (p.percentage ? Math.round(pot * p.percentage) / 100 * 100 / 100 : 0);
      return {
        uid: winner?.ownerUid || '',
        userName: winner?.userName || '(pick a member)',
        amount: suggested ? String(suggested) : '',
        kind: 'PLACE',
        place: p.place ?? idx + 1,
        settled: false,
        note: '',
      };
    });
    setRows(next.length ? next : [{ uid: ranked[0]?.ownerUid || '', userName: ranked[0]?.userName || '', amount: '', kind: 'PLACE', place: 1, settled: false, note: '' }]);
  };

  const addBonusRow = () => {
    setRows(r => [...r, { uid: '', userName: '', amount: '', kind: 'BONUS', settled: false, note: '' }]);
  };

  const submit = async () => {
    const awards = rows
      .filter(r => r.uid && r.amount !== '' && Number.isFinite(Number(r.amount)))
      .map(r => ({
        uid: r.uid,
        amount: Number(r.amount),
        kind: r.kind,
        ...(r.kind === 'PLACE' && r.place ? { place: r.place } : {}),
        settled: r.settled,
        ...(r.note.trim() ? { note: r.note.trim() } : {}),
      }));
    if (awards.length === 0) {
      toast.error('Every award needs a recipient and an amount.');
      return;
    }
    setSubmitting(true);
    try {
      await dbService.recordPoolPayouts(pool.id, awards);
      toast.success('Payouts recorded.');
      setRows([]);
    } catch (err) {
      toast.error(getUserMessage(err, 'Failed to record payouts.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!finalized) return null;

  const active = existing.filter(r => !r.supersededBy);

  return (
    <div className="bg-card border border-line shadow-card rounded-xl p-6 space-y-4">
      <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
        <Trophy size={15} className="text-gold-500" /> Record Payouts
      </h3>
      <p className="font-body text-[12px] text-muted">
        Season settled. Record who won what — prizes are paid by you, peer-to-peer; the
        platform only records the figures for member profiles and the pool ledger.
      </p>

      {active.length > 0 && (
        <div className="bg-page border border-line rounded-lg p-3 space-y-1">
          <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">Recorded</span>
          {active.map((r) => (
            <div key={r.id} className="flex justify-between font-body text-[12px] text-[color:var(--text)]">
              <span>{entries.find(e => e.ownerUid === r.uid)?.userName || r.uid}{r.place ? ` — ${r.place}${['','st','nd','rd'][r.place] || 'th'}` : ''} ({r.kind})</span>
              <span className="num font-bold">${Number(r.amount).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <button
          onClick={prefill}
          className="w-full py-2.5 rounded-lg bg-navy-700 text-white font-display font-bold uppercase text-[12px] tracking-[0.08em] hover:bg-navy-600 transition-colors"
        >
          {active.length > 0 ? 'Record a correction / more awards' : 'Prefill from final standings'}
        </button>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 bg-page border border-line rounded-lg p-2">
              <select
                value={row.uid}
                onChange={(e) => {
                  const uid = e.target.value;
                  const m = entries.find(en => en.ownerUid === uid);
                  setRows(rs => rs.map((r, j) => j === i ? { ...r, uid, userName: m?.userName || '' } : r));
                }}
                className="bg-card border border-line rounded px-2 py-1.5 font-body text-[12px] text-[color:var(--text)] flex-1 min-w-[140px]"
              >
                <option value="">Recipient…</option>
                {entries.map(e => (
                  <option key={e.ownerUid} value={e.ownerUid}>{e.userName}</option>
                ))}
              </select>
              <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-faint w-14">
                {row.kind === 'PLACE' ? `${row.place}${['','st','nd','rd'][row.place || 0] || 'th'}` : 'Bonus'}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-muted font-body text-[12px]">$</span>
                <input
                  type="number"
                  min="0"
                  value={row.amount}
                  onChange={(e) => setRows(rs => rs.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                  className="w-24 bg-card border border-line rounded px-2 py-1.5 font-body text-[12px] num text-[color:var(--text)]"
                  placeholder="0"
                />
              </div>
              <label className="flex items-center gap-1.5 font-body text-[11px] text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={row.settled}
                  onChange={(e) => setRows(rs => rs.map((r, j) => j === i ? { ...r, settled: e.target.checked } : r))}
                />
                Paid
              </label>
              <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-faint hover:text-brandred-600" aria-label="Remove award row">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={addBonusRow} className="flex-1 py-2 rounded-lg border border-line font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted hover:bg-page flex items-center justify-center gap-1.5">
              <Plus size={13} /> Add bonus award
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 py-2 rounded-lg bg-navy-700 text-white font-display font-bold uppercase text-[11px] tracking-[0.08em] hover:bg-navy-600 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <CheckCircle size={13} /> {submitting ? 'Recording…' : 'Record payouts'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
