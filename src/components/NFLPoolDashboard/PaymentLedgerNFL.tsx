import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { Pool, WeeklyRecap } from '../../types';
import { weeklyAwardId, type PayoutRecord, type PayoutRecordPrivate } from '@shared/payoutRecords';
import { buildPoolRoster, duesRates } from '../../utils/poolRoster';
import { nflWeekChip } from '../../utils/nflWeekLabel';
import { poolSeasonType } from '../../utils/nflPending';

/**
 * The commissioner's payment LEDGER (PLAN-PAYMENT-LEDGER T5 — D3/D4/D5/D6,
 * K3/K7/K11/K12; signed 2026-08-15) — ONE spreadsheet (Kevin, 2026-08-16 late,
 * after screenshots showed three things called "ledger"):
 *
 *   Member | Entry fee | Fee paid ☐ | HOF | W1 | W2 … | Season $ | totals
 *
 * One row per member (per ENTRY when a member holds several). "Fee paid" is
 * the Member Record's Paid Status — the same `setPaidStatus` toggle that used
 * to sit on the roster row, handed in as `onTogglePaid` (the writer stays in
 * NFLManagerView; this component never calls a payment callable for fees).
 * Each scored-week cell is the WEEKLY PRIZE the recap PUBLISHED for that entry
 * (`weeklyPlaces` rows with a `prize`, priced against the frozen `weeklyPrize`)
 * with a checkbox that RECORDS it as a settled Payout Record
 * (`recordPoolPayouts`, deterministic id, idempotent) or flips settlement on the
 * record that exists (`setPayoutSettled`). Nothing is auto-recorded by scoring:
 * the checkbox is the act of recording (K3 — the invariant).
 *
 * After a rescore (K12) a live record that no longer matches the recap shows
 * STALE; the cell offers Re-record (supersedes it via `staleAwardId`) or
 * Reverse ($0). The recap wins; the ledger never silently keeps a stale award.
 *
 * Season $ is a placeholder until WEEKLY-PRIZES step 3 lands (season awards go
 * through Record Payouts after finalization).
 *
 * Reads only: recaps (public), payoutRecords (participant-readable),
 * payoutRecordsPrivate (commissioner + recipient).
 */

type Rec = PayoutRecord & { id: string };
type Priv = PayoutRecordPrivate & { id: string };

interface Props {
  pool: Pool;
  members: any[];
  entries: any[];
  /** The roster's fee toggle (setPaidStatus lives in NFLManagerView). */
  onTogglePaid?: (uid: string, currentStatus: string) => void;
  /** Survivor rebuy dues settle independently of base dues (P3). */
  onSettleRebuys?: (uid: string, settle: boolean) => void;
  /**
   * Payment method / date / note on a PAID fee (the old Advanced Payment
   * Ledger's editor, folded in — codex r2/r6 on #460). Same setPaidStatus
   * callable, `isPaid: true` + details; the writer stays in NFLManagerView.
   */
  onSavePaidDetails?: (uid: string, details: { paymentMethod: string; paidAt: number; paymentNote: string | null }) => Promise<boolean>;
  /** uid currently being written by either fee handler — disables that row's fee controls. */
  savingFeeUid?: string | null;
}

const money = (n: number) => `$${Math.floor(n).toLocaleString()}`;
// LOCAL calendar date <-> <input type="date"> value. `toISOString()` is UTC and
// pre-fills tomorrow after ~6pm in US time zones; `new Date('YYYY-MM-DD')` parses
// as UTC midnight and displays as yesterday (codex r8 on #460).
const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (ymd: string): number => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };

/** Owner uid of an entry doc: entry #1's id IS the uid; extras carry `ownerUid`. */
const entryOwner = (e: any): string => e?.ownerUid || e?.id;

export const PaymentLedgerNFL: React.FC<Props> = ({ pool, members, entries, onTogglePaid, onSettleRebuys, onSavePaidDetails, savingFeeUid = null }) => {
  // Inline fee-details editor: which uid is open + its draft.
  const [editUid, setEditUid] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ method: string; date: string; note: string }>({ method: 'Venmo', date: '', note: '' });
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [records, setRecords] = useState<Rec[]>([]);
  const [priv, setPriv] = useState<Priv[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Other awards" (PLAN-PAYMENT-LEDGER T7 — the Record Payouts card folded in):
  // free-form BONUS / ADJUSTMENT rows the commissioner adds after finalization,
  // plus any legacy free-form PLACE record. Draft for the add form.
  const [otherDraft, setOtherDraft] = useState<{ uid: string; kind: 'BONUS' | 'ADJUSTMENT'; amount: string; note: string; settled: boolean } | null>(null);
  // Settlement state comes from the PRIVATE records; if that listener fails
  // (permissions, offline) every box would read "unpaid" — say so and disable
  // the boxes instead (qodo #10 on #456).
  const [privUnavailable, setPrivUnavailable] = useState(false);
  const [privLoaded, setPrivLoaded] = useState(false);
  // Prize totals are unknown until BOTH public listeners have delivered once —
  // "$0" before load is a plausible-looking substitute, not a figure (qodo #1 on #460).
  const [recapsLoaded, setRecapsLoaded] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);

  useEffect(() => {
    // Pool switch without remount: drop the previous pool's data before the
    // new snapshots arrive — award ids are deterministic and could collide
    // across pools (codex r9).
    setRecaps([]); setRecords([]); setPriv([]); setPrivLoaded(false); setPrivUnavailable(false); setError(null); setRecapsLoaded(false); setRecordsLoaded(false);
    setBusy(null); setEditUid(null); // an in-flight toggle or open editor belongs to the previous pool (qodo #5 on #460)
    const u1 = dbService.subscribeToWeeklyRecaps(pool.id, (rows) => { setRecaps(rows); setRecapsLoaded(true); });
    const u2 = dbService.subscribeToPayoutRecords(pool.id, (rows) => { setRecords(rows as Rec[]); setRecordsLoaded(true); });
    const u3 = dbService.subscribeToPayoutRecordsPrivate(pool.id, (rows) => { setPriv(rows as never); setPrivUnavailable(false); setPrivLoaded(true); }, undefined, () => setPrivUnavailable(true));
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

  /** Scored weeks, ascending — one column each. Survivor publishes no weekly places (no weekly prizes), so no columns. */
  const weeks = useMemo(() => pool.type === 'NFL_SURVIVOR' ? [] : [...recaps].sort((a, b) => a.week - b.week), [recaps, pool.type]);
  /** Weeks with a recap but no published `weeklyPlaces` — scored before this feature shipped (or void). */
  const unpublishedWeeks = useMemo(() => weeks.filter(r => !r.weeklyPlaces && !r.weeklyPlacesError), [weeks]);
  const erroredWeeks = useMemo(() => weeks.filter(r => !!r.weeklyPlacesError), [weeks]);

  /** One line per (entry, week) with a published prize — or a live award the recap no longer backs. */
  const prizeRows = useMemo(() => {
    const rows: Array<{
      /** The NFL week, or undefined for the SEASON prize (PLAN-WEEKLY-PRIZES step 3). */
      key: string; week: number | undefined; entryId: string; uid: string; name: string; rank: number; owed: number;
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
    // Reversals (K12, codex r6 on T4): a LIVE weekly award whose entry no longer
    // holds a prize in that week's recap — the recap wins, so the ledger shows
    // it as STALE / no longer owed and the checkbox records a $0 supersession.
    const seen = new Set(rows.map(r => `${r.entryId}|${r.week}`));
    for (const [key, live] of liveWeekly) {
      if (seen.has(key) || Number(live.amount) === 0) continue;
      const recap = recaps.find(r => r.week === live.week);
      if (!recap?.weeklyPlaces || !recap.weeklyPrize) continue; // week not (re)published — leave it
      const row = recap.weeklyPlaces.find(p => p.entryId === live.entryId);
      rows.push({
        key: `${live.week}|${live.entryId}`, week: live.week!, entryId: live.entryId!, uid: live.uid,
        name: row ? (row.entryName ? `${row.entryName} · ${row.userName}` : row.userName) : live.entryId!,
        // NaN = place unknown (entry no longer in the recap) — rendered as "—", never 0 (qodo #8 on #456).
        rank: row?.rank ?? Number.NaN, owed: 0, live, settled: false, stale: true,
      });
    }
    // ---- SEASON prize (PLAN-WEEKLY-PRIZES step 3): the pool's published
    // `seasonPlaces` (frozen prize at finalization, never re-priced here) joined
    // to the LIVE bound season award — a PLACE record at a `season-…` id with an
    // entryId and NO week. A free-form season PLACE record (Record Payouts card,
    // or one written before seasonPlaces existed) never satisfies the published
    // prize (codex r1 on #464). A re-finalized (rescored) pool republishes the
    // places, so the same STALE / Re-record / Reverse rule as the weeks applies
    // (codex r3 on #464).
    const seasonPlaces = pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_PICKEM' || pool.type === 'NFL_MARGIN' ? pool.seasonPlaces : undefined;
    if (Array.isArray(seasonPlaces)) {
      const liveSeason = new Map<string, Rec>();
      for (const r of records) {
        if (r.supersededBy || r.kind !== 'PLACE' || r.week !== undefined || !r.entryId || !r.id.startsWith('season-')) continue;
        liveSeason.set(r.entryId, r);
      }
      const seenSeason = new Set<string>();
      for (const p of seasonPlaces) {
        if (typeof p.prize !== 'number' || p.prize <= 0) continue;
        seenSeason.add(p.entryId);
        const live = liveSeason.get(p.entryId);
        const stale = !!live && (Number(live.amount) !== p.prize || Number(live.place) !== p.rank);
        rows.push({
          key: `season|${p.entryId}`, week: undefined, entryId: p.entryId, uid: p.userId,
          name: p.entryName ? `${p.entryName} · ${p.userName}` : p.userName,
          rank: p.rank, owed: p.prize, live, settled: !!live && !stale && privById.get(live.id)?.settled === true, stale,
        });
      }
      for (const [entryId, live] of liveSeason) {
        if (seenSeason.has(entryId) || Number(live.amount) === 0) continue;
        const row = seasonPlaces.find(p => p.entryId === entryId);
        rows.push({
          key: `season|${entryId}`, week: undefined, entryId, uid: live.uid,
          name: row ? (row.entryName ? `${row.entryName} · ${row.userName}` : row.userName) : entryId,
          rank: row?.rank ?? Number.NaN, owed: 0, live, settled: false, stale: true,
        });
      }
    }
    return rows;
  }, [recaps, liveWeekly, privById, pool, records]);

  const prizeByCell = useMemo(() => new Map(prizeRows.map(r => [`${r.entryId}|${r.week ?? 'season'}`, r])), [prizeRows]);

  const nflPool = pool.type === 'NFL_SURVIVOR' || pool.type === 'NFL_PICKEM' || pool.type === 'NFL_MARGIN' ? pool : undefined;
  const seasonPublished = Array.isArray(nflPool?.seasonPlaces);

  /**
   * Ledger rows: one per ENTRY, grouped under the member. Rows come from the
   * CANONICAL roster (`buildPoolRoster`: participantIds ∪ Member Records ∪
   * entries, Member Record authoritative) so a legacy participant without a
   * Member Record is still listed (codex r1 on T5). Fee columns render on a
   * member's FIRST row only — the fee is per member (`feeOwed = fee × liable
   * entries`, shared/memberRecord), prizes are per entry.
   */
  const ledgerRows = useMemo(() => {
    // Same fallback the manager's payment controls use: a legacy Member Record
    // (or a participant/entry-only row) with no `feeOwed` stamp owes the pool's
    // entry fee, not $0 (codex r5 on T5).
    const rates = duesRates(pool);
    const entriesByUid = new Map<string, any[]>();
    for (const e of entries ?? []) {
      const uid = entryOwner(e);
      if (!uid) continue;
      const list = entriesByUid.get(uid) ?? [];
      list.push(e);
      entriesByUid.set(uid, list);
    }
    const rows: Array<{
      key: string; uid: string; entryId: string; name: string; first: boolean;
      hasMember: boolean; feeOwed: number | null; paidStatus: 'PAID' | 'UNPAID' | null;
      rebuyOwed: number; rebuyPaid: number;
      /** Payment metadata (method / date / note) — shown under the fee box, editable via onSavePaidDetails. */
      paidMeta?: string; paymentMethod?: string; paidAt?: number | null; paymentNote?: string | null;
    }> = [];
    const membersByUid = new Map<string, any>((members ?? []).map((m: any) => [m.uid, m]));
    const roster = buildPoolRoster({ pool, members, entries }).sort((a, b) => (a.userName ?? a.uid).localeCompare(b.userName ?? b.uid));
    const rosterUids = new Set<string>();
    for (const r of roster) {
      rosterUids.add(r.uid);
      // Entry roster = the Member Record's `entries` map (existence + index +
      // name, reveal-safe — PLAN-MULTI-ENTRY) ∪ the entry docs we were given,
      // which can be the per-OWNER standings fold and hide entry #2+ (codex r4).
      const byId = new Map<string, { id: string; entryIndex?: number; entryName?: string }>();
      for (const [id, v] of Object.entries((membersByUid.get(r.uid)?.entries ?? {}) as Record<string, { entryIndex?: number; name?: string }>)) byId.set(id, { id, entryIndex: v?.entryIndex, entryName: v?.name });
      for (const e of entriesByUid.get(r.uid) ?? []) byId.set(e.id, { id: e.id, entryIndex: e.entryIndex ?? byId.get(e.id)?.entryIndex, entryName: e.entryName ?? byId.get(e.id)?.entryName });
      const own = [...byId.values()].sort((a, b) => (a.entryIndex ?? 1) - (b.entryIndex ?? 1));
      const ids = own.length ? own.map(e => e.id) : [r.uid]; // entry #1's id is the uid
      // Fallback is per LIABLE entry (feeOwed = fee × entries, shared/memberRecord) — an
      // unstamped member with two entries owes two fees, not one (codex r3 on this PR).
      const feeOwed = typeof r.feeOwed === 'number' ? r.feeOwed : rates.entryFee * Math.max(1, own.length);
      const rebuyOwed = typeof r.rebuyOwed === 'number' ? r.rebuyOwed : (r.rebuysUsed ?? 0) * rates.rebuyCost;
      ids.forEach((entryId, i) => {
        const e = own[i];
        const label = e?.entryName ? `${e.entryName} · ${r.userName ?? r.uid}` : (r.userName ?? r.uid);
        rows.push({
          key: entryId, uid: r.uid, entryId, name: i > 0 && !e?.entryName ? `${label} (Entry ${e?.entryIndex ?? i + 1})` : label, first: i === 0,
          hasMember: r.hasMember, feeOwed, paidStatus: r.paidStatus, rebuyOwed, rebuyPaid: r.rebuyPaid ?? 0,
          paidMeta: r.paidStatus === 'PAID' ? [r.paymentMethod, r.paidAt ? new Date(r.paidAt).toLocaleDateString() : null, r.paymentNote].filter(Boolean).join(' · ') || undefined : undefined,
          paymentMethod: r.paymentMethod, paidAt: r.paidAt, paymentNote: r.paymentNote,
        });
      });
    }
    // A prize row whose ENTRY has no ledger row yet. Two cases (codex r1 on
    // this PR): (a) an extra entry of a known member — `entries` here can be
    // the per-OWNER standings fold, which hides entry #2+ — so add it under
    // that member (fee columns blank, `first: false`); (b) a recipient outside
    // the roster entirely (should not happen): fee/status UNKNOWN, rendered
    // "—", never $0 (qodo #9 on #456).
    // Season winners are in prizeRows too (week undefined) — same treatment (codex r2 on #464).
    for (const p of prizeRows) {
      if (rows.some(r => r.entryId === p.entryId)) continue;
      const known = rosterUids.has(p.uid);
      const row = { key: p.entryId, uid: p.uid, entryId: p.entryId, name: p.name, first: !known, hasMember: false, feeOwed: null as number | null, paidStatus: null as 'PAID' | 'UNPAID' | null, rebuyOwed: 0, rebuyPaid: 0 };
      const last = known ? rows.map(r => r.uid).lastIndexOf(p.uid) : -1;
      if (last >= 0) rows.splice(last + 1, 0, row); else rows.push(row);
    }
    return rows;
  }, [pool, members, entries, prizeRows]);

  const totals = useMemo(() => {
    let owedIn = 0, paidIn = 0, owedOut = 0, paidOut = 0;
    for (const r of ledgerRows) {
      if (r.first && r.feeOwed !== null) { owedIn += r.feeOwed + r.rebuyOwed; if (r.paidStatus === 'PAID') paidIn += r.feeOwed; paidIn += Math.min(r.rebuyPaid, r.rebuyOwed); }
    }
    for (const p of prizeRows) { owedOut += p.owed; if (p.settled) paidOut += p.owed; }
    // Other awards (BONUS / ADJUSTMENT / legacy free-form PLACE) count in the
    // out totals too — an adjustment may be negative (T7).
    for (const r of records) {
      if (r.supersededBy || (r.kind === 'PLACE' && r.entryId && (typeof r.week === 'number' || r.id.startsWith('season-')))) continue;
      owedOut += Number(r.amount); if (privById.get(r.id)?.settled === true) paidOut += Number(r.amount);
    }
    return { owedIn, paidIn, owedOut, paidOut };
  }, [ledgerRows, prizeRows, records, privById]);

  const toggle = async (r: (typeof prizeRows)[number], checked: boolean) => {
    setBusy(r.key); setError(null);
    try {
      if (!r.live) {
        // First record: the deterministic id makes this safe to double-click.
        await dbService.recordPoolPayouts(pool.id, [{ uid: r.uid, entryId: r.entryId, amount: r.owed, kind: 'PLACE', place: r.rank, week: r.week, settled: checked }]);
      } else if (r.stale) {
        // Never re-record from an unknown settlement state (codex r8): a paid
        // award must not come back as unpaid because the listener had not loaded.
        if (!privLoaded || privUnavailable) throw new Error('Settlement state has not loaded yet — try again in a moment.');
        // K12: re-record by supersession against the live id we are looking
        // at. Settlement CARRIES OVER from the record being replaced — a
        // correction is not a payment (codex r3 on T5); the checkbox on the
        // fresh record then flips it as usual.
        const wasSettled = privById.get(r.live.id)?.settled === true;
        await dbService.recordPoolPayouts(pool.id, [{ uid: r.uid, entryId: r.entryId, amount: r.owed, kind: 'PLACE', place: r.rank, week: r.week, settled: wasSettled, staleAwardId: r.live.id }]);
        void checked;
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

  const seasonType = poolSeasonType(pool);
  const chip = (week: number) => nflWeekChip(seasonType, week);
  const finalized = !!(pool as any).finalizedAt || (pool as any).status === 'FINAL' || (pool as any).status === 'COMPLETED';
  /** Live records that are NOT bound weekly/season PLACE awards: BONUS, ADJUSTMENT, legacy free-form PLACE. */
  const otherAwards = useMemo(() => records
    .filter(r => !r.supersededBy && !(r.kind === 'PLACE' && r.entryId && (typeof r.week === 'number' || r.id.startsWith('season-'))))
    .sort((a, b) => Number(b.recordedAt) - Number(a.recordedAt)), [records]);
  const nameOf = (uid: string) => ledgerRows.find(r => r.uid === uid)?.name.split(' · ').pop() ?? uid;
  const submitOther = async () => {
    if (!otherDraft) return;
    const amount = Number(otherDraft.amount);
    if (!otherDraft.uid || !Number.isInteger(amount) || (otherDraft.kind === 'BONUS' && amount <= 0)) { setError('Pick a member and a WHOLE-dollar amount (bonus > 0; an adjustment may be negative).'); return; }
    setBusy('other'); setError(null);
    try {
      await dbService.recordPoolPayouts(pool.id, [{ uid: otherDraft.uid, amount, kind: otherDraft.kind, settled: otherDraft.settled, ...(otherDraft.note.trim() ? { note: otherDraft.note.trim() } : {}) }]);
      setOtherDraft(null);
    } catch (e: any) {
      logger.error('ledger other-award failed', e);
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const settleOther = async (r: Rec, checked: boolean) => {
    setBusy(r.id); setError(null);
    try { await dbService.setPayoutSettled(pool.id, r.id, checked); }
    catch (e: any) { logger.error('ledger other-award settle failed', e); setError(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };
  const th = 'py-2 px-2 font-display font-bold uppercase text-[10px] tracking-[0.06em] text-muted whitespace-nowrap';
  const td = 'py-2 px-2 whitespace-nowrap';

  const chipOf = (week: number | undefined) => week === undefined ? 'Season' : chip(week);
  const renderPrizeCell = (entryId: string, recap: WeeklyRecap | 'season') => {
    const r = prizeByCell.get(`${entryId}|${recap === 'season' ? 'season' : recap.week}`);
    if (!r) {
      if (recap === 'season') return <span className="text-faint" title={seasonPublished ? 'No season prize for this entry' : 'Published when the season is finalized'}>—</span>;
      if (!recap.weeklyPlaces) return <span className="text-faint text-[9px] uppercase" title={recap.weeklyPlacesError ? `Not published: ${recap.weeklyPlacesError}` : 'Scored before weekly prizes existed — Score Week again to publish.'}>unpublished</span>;
      return <span className="text-faint">—</span>;
    }
    const disabled = busy === r.key || privUnavailable || !privLoaded;
    const recorded = r.live ? (r.stale
      ? (r.owed > 0 ? `STALE — recorded ${money(Number(r.live.amount))} at place ${r.live.place}; the recap now says ${money(r.owed)} at place ${r.rank}. Re-record to update.` : `STALE — recorded ${money(Number(r.live.amount))} at place ${r.live.place}; after the rescore this entry has no prize. Reverse to $0.`)
      : `${money(Number(r.live.amount))} recorded (place ${r.rank})`) : `Place ${r.rank} — not recorded yet; tick to record as paid.`;
    return (
      <span className="inline-flex items-center gap-1.5" title={recorded}>
        <span className={`num font-bold ${r.owed > 0 ? 'text-gold-700 dark:text-gold-400' : 'text-faint font-normal line-through'}`}>{money(r.owed > 0 ? r.owed : Number(r.live?.amount ?? 0))}</span>
        {r.stale ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => toggle(r, false)}
            className="text-[9px] font-display font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border border-brandred-600 text-brandred-600 dark:text-brandred-500 hover:bg-brandred-600/10 disabled:opacity-50"
            aria-label={r.owed > 0 ? `Re-record ${chipOf(r.week)} prize for ${r.name} at ${money(r.owed)}` : `Reverse the ${chipOf(r.week)} award for ${r.name}`}
          >
            {r.owed > 0 ? 'Re-record' : 'Reverse'}
          </button>
        ) : (
          <input
            type="checkbox"
            aria-label={`${chipOf(r.week)} prize for ${r.name} paid`}
            checked={r.settled}
            disabled={disabled}
            onChange={e => toggle(r, e.target.checked)}
            className="h-4 w-4 accent-navy-600 dark:accent-gold-500"
          />
        )}
      </span>
    );
  };

  return (
    <div className="bg-card border border-line shadow-card rounded-xl p-6 space-y-4">
      <h3 className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted flex items-center gap-2">
        <DollarSign size={14} className="text-gold-600 dark:text-gold-400" aria-hidden="true" /> Payment Ledger
      </h3>
      <p className="text-[11px] font-body text-muted leading-relaxed">
        One row per member (per entry when a member holds several). <strong>Fee paid</strong> is the Member Record's Paid Status. Each week column is the prize the scorer published for that week — frozen pot × your payout places, whole dollars. Ticking a prize box <strong>records</strong> it as paid; nothing is recorded until you tick it. March Melee Pools moves no money.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-body border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={`${th} text-left`}>Member</th>
              <th className={`${th} text-right`}>Entry fee</th>
              <th className={`${th} text-center`}>Fee paid</th>
              {weeks.map(w => (
                <th key={w.week} className={`${th} text-center`} title={w.weeklyPrize ? `Weekly pot ${money(w.weeklyPrize.pot)}` : w.weeklyPlaces ? 'Published unpriced (no weekly pot)' : w.weeklyPlacesError ? `Not published: ${w.weeklyPlacesError}` : 'Scored before weekly prizes existed — Score Week again to publish.'}>
                  {chip(w.week)}
                </th>
              ))}
              <th className={`${th} text-center`} title={seasonPublished ? (nflPool?.seasonPrize ? `Season pot ${money(nflPool.seasonPrize.pot)} — published at finalization` : nflPool?.seasonPlacesError ? `Not priced: ${nflPool.seasonPlacesError}` : 'Season places published unpriced (no season pot)') : 'Published when the season is finalized.'}>Season $</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map(r => (
              <tr key={r.key} className="border-t border-line">
                <td className={`${td} text-[color:var(--text)] font-bold`}>{r.name}</td>
                <td className={`${td} text-right num`}>{r.first ? (r.feeOwed === null ? <span className="text-faint">—</span> : money(r.feeOwed)) : ''}</td>
                <td className={`${td} text-center`}>
                  {r.first && (r.paidStatus === null ? <span className="text-faint text-[10px]">unknown</span> : (
                    <span className="inline-flex flex-col items-center gap-1">
                      <input
                        type="checkbox"
                        aria-label={`${r.name} entry fee paid`}
                        checked={r.paidStatus === 'PAID'}
                        disabled={!onTogglePaid || savingFeeUid === r.uid}
                        onChange={() => onTogglePaid?.(r.uid, r.paidStatus ?? 'UNPAID')}
                        className="h-4 w-4 accent-navy-600 dark:accent-gold-500"
                      />
                      {r.paidMeta && editUid !== r.uid && <span className="text-[9px] text-faint max-w-[10rem] truncate" title={r.paidMeta}>{r.paidMeta}</span>}
                      {onSavePaidDetails && r.hasMember && editUid !== r.uid && (
                        <button type="button" className="text-[9px] text-muted underline hover:text-[color:var(--text)]" title="Record how / when this fee was paid (marks it paid)"
                          onClick={() => { setEditUid(r.uid); setDraft({ method: r.paymentMethod || 'Venmo', date: localYmd(r.paidAt ? new Date(r.paidAt) : new Date()), note: r.paymentNote || '' }); }}>
                          {r.paidMeta ? 'edit details' : 'add details'}
                        </button>
                      )}
                      {onSavePaidDetails && editUid === r.uid && (
                        <span className="flex flex-col gap-1 items-stretch text-left">
                          <select value={draft.method} onChange={e => setDraft(d => ({ ...d, method: e.target.value }))} className="bg-page border border-line rounded px-1 py-0.5 text-[10px]" aria-label="Payment method">
                            {['Venmo', 'Zelle', 'PayPal', 'Cash', 'Card', 'Other'].map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} className="bg-page border border-line rounded px-1 py-0.5 text-[10px]" aria-label="Paid date" />
                          <input type="text" value={draft.note} placeholder="Tx id / note" onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} className="bg-page border border-line rounded px-1 py-0.5 text-[10px] w-28" aria-label="Payment note" />
                          <span className="flex gap-1 justify-center">
                            <button type="button" disabled={savingFeeUid === r.uid} className="text-[9px] font-display font-bold uppercase px-2 py-0.5 rounded bg-navy-800 text-white disabled:opacity-50"
                              onClick={async () => { const ok = await onSavePaidDetails(r.uid, { paymentMethod: draft.method, paidAt: draft.date ? fromYmd(draft.date) : Date.now(), paymentNote: draft.note || null }); if (ok) setEditUid(null); /* on failure keep the draft (codex r7) */ }}>
                              {savingFeeUid === r.uid ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" className="text-[9px] font-display font-bold uppercase px-2 py-0.5 rounded border border-line text-muted" onClick={() => setEditUid(null)}>Cancel</button>
                          </span>
                        </span>
                      )}
                      {/* Rebuy dues are a SEPARATE settlement from base dues (P3): the callable needs a Member Record. */}
                      {r.rebuyOwed > 0 && r.hasMember && onSettleRebuys && (() => {
                        const settled = r.rebuyPaid >= r.rebuyOwed;
                        const outstanding = Math.max(0, r.rebuyOwed - r.rebuyPaid);
                        return (
                          <button
                            type="button"
                            onClick={() => onSettleRebuys(r.uid, !settled)}
                            disabled={savingFeeUid === r.uid}
                            title={settled ? 'Rebuy dues settled — click to reverse' : 'Click when the rebuy money is collected'}
                            className={`px-2 py-0.5 rounded font-display font-bold uppercase text-[9px] tracking-[0.06em] disabled:opacity-50 ${settled ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]' : 'bg-gold-500/15 border border-gold-500/30 text-gold-700 dark:text-gold-400 hover:bg-gold-500/25'}`}
                          >
                            {settled ? `Rebuys ${money(r.rebuyOwed)} settled` : `Rebuys ${money(outstanding)} owed`}
                          </button>
                        );
                      })()}
                    </span>
                  ))}
                </td>
                {weeks.map(w => <td key={w.week} className={`${td} text-center`}>{renderPrizeCell(r.entryId, w)}</td>)}
                <td className={`${td} text-center`}>{renderPrizeCell(r.entryId, 'season')}</td>
              </tr>
            ))}
            {ledgerRows.length === 0 && (
              <tr><td colSpan={4 + weeks.length} className="py-2 text-faint">No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-body border-t border-line pt-3">
        <span className="text-muted">Owed in <span className="num font-bold text-[color:var(--text)]">{money(totals.owedIn)}</span></span>
        <span className="text-muted">Paid in <span className="num font-bold text-green-700 dark:text-green-400">{money(totals.paidIn)}</span></span>
        {/* Prize totals: unknown until recaps + records + settlement have loaded (never a placeholder $0). */}
        <span className="text-muted">Owed out <span className="num font-bold text-[color:var(--text)]">{recapsLoaded && recordsLoaded ? money(totals.owedOut) : <span className="text-faint" title="Loading…">—</span>}</span></span>
        <span className="text-muted">Paid out <span className="num font-bold text-green-700 dark:text-green-400">{recapsLoaded && recordsLoaded && privLoaded ? money(totals.paidOut) : <span className="text-faint" title={privUnavailable ? 'Settlement state unavailable' : 'Loading…'}>—</span>}</span></span>
      </div>

      {/* Other awards — the Record Payouts card folded into the ledger (T7): free-form BONUS / ADJUSTMENT after finalization; legacy free-form PLACE records listed for settlement. */}
      {(finalized || otherAwards.length > 0) && (
        <div className="border-t border-line pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-display font-bold uppercase text-[11px] tracking-[0.06em] text-muted">Other awards</h4>
            {finalized && !otherDraft && (
              <button type="button" onClick={() => setOtherDraft({ uid: ledgerRows.find(r => r.first)?.uid ?? '', kind: 'BONUS', amount: '', note: '', settled: false })} className="text-[10px] font-display font-bold uppercase tracking-[0.06em] px-2 py-1 rounded-md border border-line text-muted hover:text-[color:var(--text)]">
                + Bonus / adjustment
              </button>
            )}
          </div>
          {otherAwards.length === 0 && !otherDraft && <p className="text-[11px] font-body text-faint">None recorded. Weekly and season prizes live in the table above; use this only for a bonus or a correction.</p>}
          {otherAwards.length > 0 && (
            <ul className="divide-y divide-line text-[12px] font-body">
              {otherAwards.map(r => (
                <li key={r.id} className="py-1 flex items-center justify-between gap-3">
                  <span className="text-[color:var(--text)]">{nameOf(r.uid)} <span className="text-muted text-[10px] uppercase font-display font-bold ml-1">{r.kind === 'PLACE' ? `place ${r.place ?? '?'} (legacy)` : r.kind.toLowerCase()}</span></span>
                  <span className="flex items-center gap-2">
                    <span className={`num font-bold ${Number(r.amount) < 0 ? 'text-brandred-600 dark:text-brandred-500' : 'text-gold-700 dark:text-gold-400'}`}>{Number(r.amount) < 0 ? `−${money(-Number(r.amount))}` : money(Number(r.amount))}</span>
                    <input type="checkbox" aria-label={`${r.kind} award for ${nameOf(r.uid)} paid`} checked={privById.get(r.id)?.settled === true} disabled={busy === r.id || privUnavailable || !privLoaded} onChange={e => settleOther(r, e.target.checked)} className="h-4 w-4 accent-navy-600 dark:accent-gold-500" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {otherDraft && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-body">
              <select value={otherDraft.uid} onChange={e => setOtherDraft(d => d && ({ ...d, uid: e.target.value }))} className="bg-page border border-line rounded px-1 py-0.5" aria-label="Recipient">
                {ledgerRows.filter(r => r.first).map(r => <option key={r.uid} value={r.uid}>{nameOf(r.uid)}</option>)}
              </select>
              <select value={otherDraft.kind} onChange={e => setOtherDraft(d => d && ({ ...d, kind: e.target.value as 'BONUS' | 'ADJUSTMENT' }))} className="bg-page border border-line rounded px-1 py-0.5" aria-label="Kind">
                <option value="BONUS">Bonus</option>
                <option value="ADJUSTMENT">Adjustment</option>
              </select>
              <input type="number" step="1" value={otherDraft.amount} onChange={e => setOtherDraft(d => d && ({ ...d, amount: e.target.value }))} placeholder="$" className="bg-page border border-line rounded px-1 py-0.5 w-20" aria-label="Amount (whole dollars)" />
              <input type="text" value={otherDraft.note} onChange={e => setOtherDraft(d => d && ({ ...d, note: e.target.value }))} placeholder="Note" className="bg-page border border-line rounded px-1 py-0.5 w-40" aria-label="Note" />
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={otherDraft.settled} onChange={e => setOtherDraft(d => d && ({ ...d, settled: e.target.checked }))} className="h-4 w-4 accent-navy-600 dark:accent-gold-500" /> paid</label>
              <button type="button" disabled={busy === 'other'} onClick={submitOther} className="text-[10px] font-display font-bold uppercase px-2 py-1 rounded bg-navy-800 text-white disabled:opacity-50">{busy === 'other' ? 'Recording…' : 'Record'}</button>
              <button type="button" onClick={() => setOtherDraft(null)} className="text-[10px] font-display font-bold uppercase px-2 py-1 rounded border border-line text-muted">Cancel</button>
            </div>
          )}
        </div>
      )}

      {pool.type === 'NFL_SURVIVOR' ? (
        <p className="text-[11px] font-body text-faint">Survivor pools have no weekly prizes — the season prize is recorded from Record Payouts after finalization.</p>
      ) : weeks.length === 0 && (
        <p className="text-[11px] font-body text-faint">No weeks scored yet — prize columns appear here after a week is scored on a pool with a weekly prize pot.</p>
      )}
      {unpublishedWeeks.length > 0 && (
        <p className="text-[11px] font-body text-faint">
          {unpublishedWeeks.map(w => chip(w.week)).join('/')} {unpublishedWeeks.length === 1 ? 'was' : 'were'} scored before weekly prizes existed — <strong>Score Week</strong> again (Scoring tab) to publish {unpublishedWeeks.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      {erroredWeeks.length > 0 && (
        <p className="text-[11px] font-body text-brandred-600 dark:text-brandred-500">
          {erroredWeeks.map(w => `${chip(w.week)}: ${w.weeklyPlacesError}`).join(' · ')} — prizes were not published for {erroredWeeks.length === 1 ? 'that week' : 'those weeks'} (duplicate payout ranks in settings is the usual cause). Fix and Score Week again.
        </p>
      )}
      {privUnavailable && <p className="text-[11px] font-body text-brandred-600 dark:text-brandred-500">Settlement state unavailable (could not read the private payout records) — the prize boxes are disabled until it loads. Reload the page; if it persists, tell support.</p>}
      {error && <p className="text-[11px] font-body text-brandred-600 dark:text-brandred-500">{error}</p>}
      <p className="text-[10px] font-body text-faint leading-relaxed">
        A ticked prize box is a settled Payout Record (`{weeklyAwardId(1, 'entry', 1)}`-style id, one per entry per week; `season-…` for the season prize). Un-ticking marks it unpaid; the recorded amount never changes. After a rescore a weekly cell can show Re-record (writes the new figure) or Reverse (writes $0), superseding the old record and keeping its paid/unpaid state. Season prizes appear once the season is finalized (ties break on the pick-record cascade, then split). A bonus or a correction is an "Other award" below the table — also a Payout Record, also settled by ticking. Every prize is DISPLAYED from the published figures until you record it; nothing is recorded for you (ADR 0008).
      </p>
    </div>
  );
};
