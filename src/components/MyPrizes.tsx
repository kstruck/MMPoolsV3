import React, { useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { dbService } from '../services/dbService';
import type { Pool, WeeklyRecap } from '../types';
import type { PayoutRecord, PayoutRecordPrivate } from '@shared/payoutRecords';
import { nflWeekChip } from '../utils/nflWeekLabel';
import { poolSeasonType } from '../utils/nflPending';

/**
 * Member-facing "My prizes" (PLAN-PAYMENT-LEDGER T6, K7): the viewer's OWN
 * published prize rows only — weekly (`weekly_recaps/*.weeklyPlaces`, priced by
 * the frozen `weeklyPrize`) and season (`pool.seasonPlaces`, published at
 * finalization) — with the state of the commissioner's Payout Record for each:
 * not recorded yet / recorded, unpaid / recorded, paid.
 *
 * Reads: recaps (pool-public), payoutRecords (participant-readable — filtered
 * to own rows HERE, other members' rows are never rendered), and
 * payoutRecordsPrivate for the viewer's OWN uid only (rules refuse others'
 * `settled`, and this component never asks). Nothing here writes; the ledger
 * (commissioner) is the only recorder. March Melee Pools moves no money —
 * every figure is the commissioner's published estimate.
 */

type Rec = PayoutRecord & { id: string };
type Priv = PayoutRecordPrivate & { id: string };

interface Props {
  pool: Pool;
  uid: string;
}

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`;

export const MyPrizes: React.FC<Props> = ({ pool, uid }) => {
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [records, setRecords] = useState<Rec[]>([]);
  const [priv, setPriv] = useState<Priv[]>([]);
  const [loaded, setLoaded] = useState({ recaps: false, records: false, priv: false });
  const [privUnavailable, setPrivUnavailable] = useState(false);

  useEffect(() => {
    setRecaps([]); setRecords([]); setPriv([]); setLoaded({ recaps: false, records: false, priv: false }); setPrivUnavailable(false);
    const u1 = dbService.subscribeToWeeklyRecaps(pool.id, rows => { setRecaps(rows); setLoaded(l => ({ ...l, recaps: true })); });
    const u2 = dbService.subscribeToPayoutRecords(pool.id, rows => { setRecords(rows as Rec[]); setLoaded(l => ({ ...l, records: true })); });
    // OWN private rows only (K7) — the query is uid-scoped, so rules admit it for any member.
    const u3 = dbService.subscribeToPayoutRecordsPrivate(pool.id, rows => { setPriv(rows as Priv[]); setLoaded(l => ({ ...l, priv: true })); }, uid, () => setPrivUnavailable(true));
    return () => { u1(); u2(); u3(); };
  }, [pool.id, uid]);

  const seasonType = poolSeasonType(pool);
  const nflPool = pool.type === 'NFL_PICKEM' || pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_MARGIN' ? pool : undefined;

  const rows = useMemo(() => {
    const privById = new Map(priv.map(p => [p.id, p]));
    // My LIVE bound PLACE awards: weekly keyed by `${entryId}|${week}`, season by `${entryId}|season` (deterministic `season-` ids only).
    const live = new Map<string, Rec>();
    for (const r of records) {
      if (r.uid !== uid || r.supersededBy || r.kind !== 'PLACE' || !r.entryId) continue;
      if (typeof r.week === 'number') live.set(`${r.entryId}|${r.week}`, r);
      else if (r.id.startsWith('season-')) live.set(`${r.entryId}|season`, r);
    }
    const out: Array<{ key: string; label: string; entryName?: string; rank: number; prize: number; state: 'unrecorded' | 'unpaid' | 'paid' | 'stale' }> = [];
    const stateOf = (rec: Rec | undefined, prize: number, rank: number): 'unrecorded' | 'unpaid' | 'paid' | 'stale' => {
      if (!rec) return 'unrecorded';
      if (Number(rec.amount) !== prize || Number(rec.place) !== rank) return 'stale';
      return privById.get(rec.id)?.settled === true ? 'paid' : 'unpaid';
    };
    for (const recap of [...recaps].sort((a, b) => a.week - b.week)) {
      if (!recap.weeklyPlaces || !recap.weeklyPrize) continue;
      for (const p of recap.weeklyPlaces) {
        if (p.userId !== uid || typeof p.prize !== 'number' || p.prize <= 0) continue;
        out.push({ key: `${recap.week}|${p.entryId}`, label: nflWeekChip(seasonType, recap.week), entryName: p.entryName, rank: p.rank, prize: p.prize, state: stateOf(live.get(`${p.entryId}|${recap.week}`), p.prize, p.rank) });
      }
    }
    for (const p of nflPool?.seasonPlaces ?? []) {
      if (p.userId !== uid || typeof p.prize !== 'number' || p.prize <= 0) continue;
      out.push({ key: `season|${p.entryId}`, label: 'Season', entryName: p.entryName, rank: p.rank, prize: p.prize, state: stateOf(live.get(`${p.entryId}|season`), p.prize, p.rank) });
    }
    return out;
  }, [recaps, records, priv, uid, seasonType, nflPool]);

  const ready = loaded.recaps && loaded.records;
  const totals = useMemo(() => ({ won: rows.reduce((s, r) => s + r.prize, 0), paid: rows.filter(r => r.state === 'paid').reduce((s, r) => s + r.prize, 0) }), [rows]);

  if (!nflPool) return null;

  return (
    <div className="bg-card border border-line rounded-3xl p-6 shadow-card">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
          <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.16em] text-muted">My Prizes</h3>
        </div>
        {ready && rows.length > 0 && (
          <span className="text-[11px] font-body text-muted">
            Won <span className="num font-bold text-[color:var(--text)]">{money(totals.won)}</span>
            {' · '}Paid <span className="num font-bold text-green-700 dark:text-green-400">{loaded.priv && !privUnavailable ? money(totals.paid) : '—'}</span>
          </span>
        )}
      </div>
      {!ready && <p className="text-sm font-body text-faint">Loading…</p>}
      {ready && rows.length === 0 && (
        <p className="text-sm font-body text-muted">No prizes published for you yet. Weekly prizes appear here after a week is scored on a pool with a weekly pot; the season prize after finalization.</p>
      )}
      {ready && rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map(r => (
            <li key={r.key} className="py-2 flex items-center justify-between gap-3 text-[13px] font-body">
              <span className="text-[color:var(--text)]">
                <span className="font-display font-bold uppercase text-[11px] tracking-[0.06em] text-muted mr-2">{r.label}</span>
                {r.entryName ? <span className="text-muted mr-2">{r.entryName}</span> : null}
                place {r.rank}
              </span>
              <span className="flex items-center gap-3">
                <span className="num font-bold text-gold-700 dark:text-gold-400">{money(r.prize)}</span>
                <span className={`text-[10px] font-display font-bold uppercase tracking-[0.06em] ${r.state === 'paid' ? 'text-green-700 dark:text-green-400' : r.state === 'stale' ? 'text-brandred-600 dark:text-brandred-500' : 'text-muted'}`}>
                  {r.state === 'paid' ? 'Paid' : r.state === 'unpaid' ? 'Recorded — not paid yet' : r.state === 'stale' ? 'Being corrected' : 'Awaiting commissioner'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10px] font-body text-faint leading-relaxed">
        Estimates from the published pot × your commissioner's payout places, whole dollars. "Paid" means your commissioner marked it settled — March Melee Pools moves no money. Only your own rows are shown here.
      </p>
    </div>
  );
};
