import React, { useMemo, useState } from 'react';
import { Handshake } from 'lucide-react';
import type { Pool } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { logger } from '../../utils/logger';
import { rowDisplayName } from '../../utils/entrySelection';
import { useToast } from '../ui/Toast';
import { FieldLabel } from '../ui/Field';
import { computeSeasonPrizeSnapshot } from '@shared/seasonPrizes';
import { splitPrizes } from '@shared/prizeSplit';
import { joinNames } from '@shared/settlement';

/**
 * "End the pool — split the pot" (PLAN-SPLIT-POT-SETTLEMENT §2.4).
 *
 * Survivor only, owner only — the parent renders it under the same
 * `viewerIsOwner` flag as Cancel, because `settlePool` refuses a
 * co-commissioner server-side (D2).
 *
 * 🛑 THE WINNERS ARE NOT A CHOICE (D3). The list is every ALIVE row, read-only,
 * and that exact list is what is sent. The server re-reads the ALIVE set under
 * the scoring lease and refuses a mismatch, so a stale screen (someone was
 * eliminated since it loaded) is refused rather than settling a field the
 * commissioner did not see.
 *
 * The pot shown is the one the server will record: the same
 * `computeSeasonPrizeSnapshot` + `splitPrizes` the finalizer runs, over
 * `pool.entryCount` (liable entries, PLAN-MULTI-ENTRY D8) — printed beside it so
 * the commissioner can check it (D6). Every winner ranks 1st, so their share
 * depends only on how many there are, never on the eliminated order.
 */
interface SettlePoolPanelProps {
  pool: Pool;
  /** Standings rows (`buildMemberStandings`), the same array the Standings tab gets. */
  entries: any[];
}

export const SettlePoolPanel: React.FC<SettlePoolPanelProps> = ({ pool, entries }) => {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const castPool = pool as any;

  const alive = useMemo(
    () => entries.filter(e => !e.unscored && e.status === 'ALIVE')
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    [entries],
  );

  const preview = useMemo(() => {
    const entryCount = typeof castPool.entryCount === 'number' ? castPool.entryCount : undefined;
    const snap = computeSeasonPrizeSnapshot(castPool.settings ?? {}, entryCount, Date.now());
    if (!snap || alive.length === 0) return { entryCount, pot: snap?.pot ?? null, each: null as number | null };
    const ranked = alive.map(e => ({ id: String(e.id), rank: 1 }));
    try {
      const split = splitPrizes({ places: snap.places, pot: snap.pot, ranked });
      const amounts = ranked.map(r => split.awards[r.id] ?? 0);
      const each = amounts.every(a => a === amounts[0]) ? amounts[0] : null;
      return { entryCount, pot: snap.pot, each };
    } catch {
      // A malformed place list — the server publishes it UNPRICED (fail-closed).
      return { entryCount, pot: snap.pot, each: null };
    }
  }, [castPool.entryCount, castPool.settings, alive]);

  const names = alive.map(rowDisplayName);

  const handleSettle = async () => {
    if (alive.length === 0) return;
    const first = await toast.confirm({
      title: 'End this pool and split the pot?',
      message: `This ends "${pool.name}" now. ${joinNames(names)} share 1st place${preview.each !== null ? ` — $${preview.each} each` : ''}. Picks close for everyone.`,
      confirmLabel: 'Continue',
      danger: true,
    });
    if (!first) return;
    const second = await toast.confirm({
      title: 'Are you absolutely sure?',
      message: notify
        ? 'This cannot be undone. Every member will be emailed that the pool is over.'
        : 'This cannot be undone. No email will be sent.',
      confirmLabel: 'Yes, End the Pool',
      danger: true,
    });
    if (!second) return;
    setBusy(true);
    try {
      const res = await dbService.settlePool({
        poolId: pool.id,
        entryIds: alive.map(e => String(e.id)),
        ...(note.trim() ? { note: note.trim() } : {}),
        notifyMembers: notify,
      });
      toast.success(notify ? `Pool settled. Emailed ${res.emailed} member(s).` : 'Pool settled.');
    } catch (err) {
      logger.error('Failed to settle pool:', err);
      toast.error(getUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gold-500/5 border border-gold-500/30 rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Handshake size={14} className="text-gold-700 dark:text-gold-400" aria-hidden="true" />
        <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-gold-700 dark:text-gold-400">
          End the Pool — Split the Pot
        </p>
      </div>
      <p className="font-body text-[11px] text-muted leading-relaxed">
        Use this when the players still alive agree to split the pot instead of playing on. Everyone still
        alive shares 1st place, the pool ends now, and nobody can make another pick. It cannot be undone.
      </p>

      {alive.length === 0 ? (
        <p className="font-body text-[12px] text-faint italic">Nobody is still alive, so there is no pot to split.</p>
      ) : (
        <>
          <div className="bg-page border border-line rounded-md p-3 space-y-1">
            <p className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">
              Sharing 1st place ({alive.length})
            </p>
            <p className="font-body text-sm text-[color:var(--text)]">{joinNames(names)}</p>
            <p className="font-body text-[12px] text-muted num">
              {preview.pot !== null
                ? <>Pot ${preview.pot}, priced on {preview.entryCount} {preview.entryCount === 1 ? 'entry' : 'entries'}.{' '}
                    {preview.each !== null ? <>Recorded as ${preview.each} each.</> : <>The per-player amount is not priced.</>}</>
                : <>This pool has no priced pot, so no amount is recorded.</>}
            </p>
            <p className="font-body text-[11px] text-faint">
              Rebuy dues are not part of the pot. Money is still settled between you and your players.
            </p>
          </div>
          <div>
            <FieldLabel tone="muted" helpId="nfl.manager.settlePool">Note to members (optional)</FieldLabel>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. Alex and Sam agreed to split it 50/50"
              className="w-full font-body bg-page border border-line rounded-md px-4 py-2.5 text-[color:var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 transition-ui"
            />
          </div>
          <label className="flex items-center gap-2 font-body text-[12px] text-[color:var(--text)] cursor-pointer">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            Email every member that the pool is over
          </label>
          <div className="flex justify-end">
            <button
              onClick={handleSettle}
              disabled={busy}
              className="min-h-[44px] bg-navy-800 hover:bg-navy-700 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] px-6 rounded-lg flex items-center gap-2 transition-ui duration-150 fine:hover:-translate-y-px cursor-pointer text-xs"
            >
              <Handshake size={13} aria-hidden="true" />
              {busy ? 'Ending the pool...' : 'End Pool & Split Pot...'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
