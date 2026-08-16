import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { Pool, WeeklyRecap } from '../../types';
import { weeklyAwardId, type PayoutRecord, type PayoutRecordPrivate } from '@shared/payoutRecords';

/**
 * The commissioner's payment LEDGER (PLAN-PAYMENT-LEDGER T5 — D3/D4/D5/D6,
 * K3/K7/K11/K12; signed 2026-08-15).
 *
 * Per member: the entry fee owed and its Paid Status (read from the Member
 * Record — toggled in the Members & Payments controls above, unchanged). Per
 * (entry, week, place): the WEEKLY PRIZE the recap PUBLISHED — `weeklyPlaces`
 * rows with a `prize`, priced against the frozen `weeklyPrize` — shown as
 * "Owed (est.)", and a checkbox that RECORDS it as a settled Payout Record
 * (`recordPoolPayouts`, deterministic id, idempotent) or flips settlement on
 * the record that exists (`setPayoutSettled`). Nothing is auto-recorded by
 * scoring: the checkbox is the act of recording (K3 — the invariant).
 *
 * After a rescore (K12) a live record that no longer matches the recap shows
 * STALE with the current figure beside it; the checkbox becomes "re-record",
 * which supersedes it (`staleAwardId`). The recap wins; the ledger never
 * silently keeps a stale award.
 *
 * Reads only: recaps (public), payoutRecords (participant-readable),
 * payoutRecordsPrivate (commissioner + recipient). Season prizes and free-form
 * BONUS/ADJUSTMENT awards stay on the Record Payouts card below (finalized
 * pools) — this ledger is the WEEKLY half the plan puts first.
 */

type Rec = PayoutRecord & { id: string };
type Priv = PayoutRecordPrivate & { id: string };

interface Props {
  pool: Pool;
  members: any[];
}

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`;

export const PaymentLedgerNFL: React.FC<Props> = ({ pool, members }) => {
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [records, setRecords] = useState<Rec[]>([]);
  const [priv, setPriv] = useState<Priv[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const u1 = dbService.subscribeToWeeklyRecaps(pool.id, setRecaps);
    const u2 = dbService.subscribeToPayoutRecords(pool.id, setRecords as never);
    const u3 = dbService.subscribeToPayoutRecordsPrivate(pool.id, setPriv as never);
    return () => { u1(); u2(); u3(); };
  }, [pool.id]);

  const privById = useMemo(() => new Map(priv.map(p => [p.id, p])), [priv]);

  /** Live weekly awards keyed by `${entryId}|${week}` (one by construction). */
  const liveWeekly = useMemo(() => {
    const m = new Map<string, Rec>();
    for (const r of records) {
      if (r.supersededBy || r.kind !== 'PLACE' || typeof r.week !== 'number' || !r.entryId) continue;
      m.set(`${r.entryId}|${r.week}`, r);
    }
    return m;
  }, [records]);

  /** One line per (entry, week) with a published prize. */
  const prizeRows = useMemo(() => {
    const rows: Array<{
      key: string; week: number; entryId: string; uid: string; name: string; rank: number; owed: number;
      live?: Rec; settled: boolean; stale: boolean;
    }> = [];
    for (const recap of recaps) {
      if (!recap.weeklyPlaces || !recap.weeklyPrize) continue;
      for (const p of recap.weeklyPlaces) {
        if (typeof p.prize !== 'number' || p.prize <= 0) continue;
        const live = liveWeekly.get(`${p.entryId}|${recap.week}`);
        const stale = !!live && (Number(live.amount) !== p.prize || Number(live.place) !== p.rank);
        rows.push({
          key: `${recap.week}|${p.entryId}`, week: recap.week, entryId: p.entryId, uid: p.userId,
          name: p.entryName ? `${p.entryName} · ${p.userName}` : p.userName,
          rank: p.rank, owed: p.prize, live, settled: !!live && !stale && privById.get(live.id)?.settled === true, stale,
        });
      }
    }
    return rows.sort((a, b) => a.week - b.week || a.rank - b.rank || a.name.localeCompare(b.name));
  }, [recaps, liveWeekly, privById]);

  /** Per-member roll-up: fee owed / paid, prizes owed / recorded-settled. */
  const memberRows = useMemo(() => {
    const byUid = new Map<string, { uid: string; name: string; feeOwed: number; paid: boolean; owed: number; settled: number }>();
    for (const m of members) {
      byUid.set(m.uid, { uid: m.uid, name: m.userName ?? m.uid, feeOwed: Number(m.feeOwed ?? 0), paid: m.paidStatus === 'PAID', owed: 0, settled: 0 });
    }
    for (const r of prizeRows) {
      const row = byUid.get(r.uid) ?? { uid: r.uid, name: r.name, feeOwed: 0, paid: false, owed: 0, settled: 0 };
      row.owed += r.owed;
      if (r.settled) row.settled += r.owed;
      byUid.set(r.uid, row);
    }
    return [...byUid.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members, prizeRows]);

  const toggle = async (r: (typeof prizeRows)[number], checked: boolean) => {
    setBusy(r.key); setError(null);
    try {
      if (!r.live) {
        // First record: the deterministic id makes this safe to double-click.
        await dbService.recordPoolPayouts(pool.id, [{ uid: r.uid, entryId: r.entryId, amount: r.owed, kind: 'PLACE', place: r.rank, week: r.week, settled: checked }]);
      } else if (r.stale) {
        // K12: re-record by supersession against the live id we are looking at.
        await dbService.recordPoolPayouts(pool.id, [{ uid: r.uid, entryId: r.entryId, amount: r.owed, kind: 'PLACE', place: r.rank, week: r.week, settled: checked, staleAwardId: r.live.id }]);
      } else {
        await dbService.setPayoutSettled(pool.id, r.live.id, checked);
      }
    } catch (e: any) {
      logger.error('ledger update failed', e);
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const anyPrizes = prizeRows.length > 0;

  return (
    <div className="bg-card border border-line shadow-card rounded-xl p-6 space-y-5">
      <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
        <DollarSign size={14} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Payment Ledger
      </h3>
      <p className="text-[11px] font-body text-muted leading-relaxed">
        Entry fees come from each Member Record (mark paid in the Members &amp; Payments controls). Weekly prizes are what the scorer published for each week — the frozen pot × your payout places, whole dollars, estimates. Ticking a box <strong>records</strong> that prize as paid; nothing is recorded until you tick it. March Melee Pools moves no money.
      </p>

      {/* Per-member roll-up */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-body">
          <thead>
            <tr className="text-muted uppercase tracking-[0.06em] text-[10px] font-display font-bold">
              <th className="text-left py-1 pr-2">Member</th>
              <th className="text-right py-1 pr-2">Entry fee</th>
              <th className="text-left py-1 pr-2">Fee status</th>
              <th className="text-right py-1 pr-2">Prizes owed (est.)</th>
              <th className="text-right py-1">Prizes paid</th>
            </tr>
          </thead>
          <tbody>
            {memberRows.map(m => (
              <tr key={m.uid} className="border-t border-line">
                <td className="py-1 pr-2 text-[color:var(--text)]">{m.name}</td>
                <td className="py-1 pr-2 text-right num">{money(m.feeOwed)}</td>
                <td className="py-1 pr-2">
                  <span className={`text-[10px] font-display font-bold uppercase ${m.paid ? 'text-green-600 dark:text-green-400' : 'text-brandred-600 dark:text-brandred-500'}`}>{m.paid ? 'Paid' : 'Unpaid'}</span>
                </td>
                <td className="py-1 pr-2 text-right num">{m.owed > 0 ? money(m.owed) : <span className="text-faint">—</span>}</td>
                <td className="py-1 text-right num">{m.owed > 0 ? money(m.settled) : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
            {memberRows.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-faint">No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Per-(entry, week) prize lines */}
      <div>
        <h4 className="font-display font-bold uppercase text-[11px] tracking-[0.06em] text-muted mb-1">Weekly prizes</h4>
        {!anyPrizes && (
          <p className="text-[11px] font-body text-faint">No weekly prizes published yet — they appear here after a week is scored on a pool with a weekly prize pot.</p>
        )}
        {anyPrizes && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-body">
              <thead>
                <tr className="text-muted uppercase tracking-[0.06em] text-[10px] font-display font-bold">
                  <th className="text-left py-1 pr-2">Week</th>
                  <th className="text-left py-1 pr-2">Player</th>
                  <th className="text-right py-1 pr-2">Place</th>
                  <th className="text-right py-1 pr-2">Owed (est.)</th>
                  <th className="text-left py-1 pr-2">Recorded</th>
                  <th className="text-center py-1">Paid</th>
                </tr>
              </thead>
              <tbody>
                {prizeRows.map(r => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="py-1 pr-2 num">{r.week}</td>
                    <td className="py-1 pr-2 text-[color:var(--text)]">{r.name}</td>
                    <td className="py-1 pr-2 text-right num">{r.rank}</td>
                    <td className="py-1 pr-2 text-right num font-bold text-gold-700 dark:text-gold-400">{money(r.owed)}</td>
                    <td className="py-1 pr-2 text-[11px]">
                      {!r.live && <span className="text-faint">not recorded</span>}
                      {r.live && !r.stale && <span className="text-muted">{money(Number(r.live.amount))} recorded</span>}
                      {r.live && r.stale && (
                        <span className="text-brandred-600 dark:text-brandred-500 font-bold" title={`Recorded ${money(Number(r.live.amount))} at place ${r.live.place}; the recap now says ${money(r.owed)} at place ${r.rank}. Tick to re-record.`}>
                          STALE — recorded {money(Number(r.live.amount))} (place {r.live.place})
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-center">
                      <input
                        type="checkbox"
                        aria-label={r.stale ? `Re-record week ${r.week} prize for ${r.name} as paid` : `Week ${r.week} prize for ${r.name} paid`}
                        checked={r.settled}
                        disabled={busy === r.key}
                        onChange={e => toggle(r, e.target.checked)}
                        className="h-4 w-4 accent-navy-600 dark:accent-gold-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="mt-2 text-[11px] font-body text-brandred-600 dark:text-brandred-500">{error}</p>}
        <p className="mt-2 text-[10px] font-body text-faint leading-relaxed">
          A ticked box is a settled Payout Record (`{weeklyAwardId(1, 'entry', 1)}`-style id, one per entry per week). Un-ticking marks it unpaid; the recorded amount never changes. After a rescore a line can show STALE — ticking it records the new figure and supersedes the old one. Season prizes and one-off adjustments: use Record Payouts once the season is finalized.
        </p>
      </div>
    </div>
  );
};
