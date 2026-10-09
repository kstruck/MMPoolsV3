import React, { useEffect, useState } from 'react';
import { Handshake } from 'lucide-react';
import type { Pool } from '../../types';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { logger } from '../../utils/logger';
import { useToast } from '../ui/Toast';
import { FieldLabel } from '../ui/Field';
import { joinNames, type PoolSettlement, type SettlementPreview } from '@shared/settlement';

/**
 * "End the pool — split the pot" (PLAN-SPLIT-POT-SETTLEMENT §2.4).
 *
 * Survivor only, owner only — the parent renders it under the same
 * `viewerIsOwner` flag as Cancel, because `settlePool` refuses a
 * co-commissioner server-side (D2).
 *
 * 🛑 THE WINNERS COME FROM THE SERVER, NOT FROM THE STANDINGS ROWS (codex
 * code-review r1 P1). `buildMemberStandings` marks an entry that has not been
 * scored yet as `unscored`, exactly like a roster-only member with no entry, so
 * the client cannot tell an ALIVE survivor from someone who never played. The
 * panel asks `settlePool` for a read-only preview — the ALIVE entries, the pot
 * and the per-winner share, computed by the finalizer's own functions — shows
 * it, and sends back exactly those ids. The server re-checks under the scoring
 * lease and refuses if the field changed in between (D3).
 */
export const SettlePoolPanel: React.FC<{ pool: Pool }> = ({ pool }) => {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  // Stamped with its pool and checked at render, like the grid's reveal: the
  // component is reused across pool navigation, and an effect reset lands one
  // frame late.
  const [state, setState] = useState<{ poolId: string; preview?: SettlementPreview; error?: string } | null>(null);

  // A settled pool only reaches this panel when its follow-up is still owed
  // (NFLManagerView): it offers the retry instead of a preview.
  const settled = (pool as { settlement?: PoolSettlement }).settlement;

  useEffect(() => {
    if (settled) return;
    let live = true;
    dbService.previewSettlement(pool.id)
      .then(preview => { if (live) setState({ poolId: pool.id, preview }); })
      .catch(err => {
        logger.error('Failed to load the settlement preview:', err);
        if (live) setState({ poolId: pool.id, error: getUserMessage(err) });
      });
    return () => { live = false; };
  }, [pool.id, settled]);

  const current = state?.poolId === pool.id ? state : null;
  const preview = current?.preview;
  const names = preview ? preview.alive.map(a => a.name) : [];

  const handleSettle = async () => {
    if (!preview || preview.alive.length === 0) return;
    const first = await toast.confirm({
      title: 'End this pool and split the pot?',
      message: names.length === 1
        ? `This ends "${pool.name}" now. ${names[0]} wins 1st place${preview.prizePerEntry !== null ? ` — $${preview.prizePerEntry}` : ''}. Picks close for everyone.`
        : `This ends "${pool.name}" now. ${joinNames(names)} share 1st place${preview.prizePerEntry !== null ? ` — $${preview.prizePerEntry} each` : ''}. Picks close for everyone.`,
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
        entryIds: preview.alive.map(a => a.id),
        ...(note.trim() ? { note: note.trim() } : {}),
        notifyMembers: notify,
        // What the owner was shown; the server refuses if it moved (codex r11).
        expectedPot: preview.pot,
        expectedPrizePerEntry: preview.prizePerEntry,
      });
      toast.success(notify ? `Pool settled. Emailed ${res.emailed} member(s).` : 'Pool settled.');
      // A failed send is not a failed settlement — the pool IS over. Say so, and
      // say how many were missed, rather than claim everyone was told.
      if (res.emailFailed > 0 || res.adminAuditFailed) {
        toast.error(`The pool is settled, but ${res.emailFailed > 0 ? `${res.emailFailed} email(s) could not be sent` : 'the record for site staff could not be written'}. Use Retry below.`);
      }
    } catch (err) {
      logger.error('Failed to settle pool:', err);
      toast.error(getUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!settled) return;
    setBusy(true);
    try {
      // FOLLOW_UP phase server-side: only the owed audit / emails run.
      const res = await dbService.settlePool({
        poolId: pool.id,
        entryIds: settled.entryIds,
        notifyMembers: settled.notifyMembers,
        // FOLLOW_UP never re-prices; these satisfy the schema only.
        expectedPot: settled.pot,
        expectedPrizePerEntry: settled.prizePerEntry,
      });
      if (res.followUpInProgress) {
        toast.error('Another attempt is already finishing this. Check back in a few minutes.');
      } else if (res.emailFailed > 0 || res.adminAuditFailed) {
        toast.error(`Still not finished: ${res.emailFailed} email(s) failed${res.adminAuditFailed ? ' and the audit record could not be written' : ''}. Try again later.`);
      } else {
        toast.success(res.emailed > 0 ? `Done. Emailed ${res.emailed} more member(s).` : 'Done.');
      }
    } catch (err) {
      logger.error('Failed to finish the settlement follow-up:', err);
      toast.error(getUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (settled) {
    return (
      <div className="bg-gold-500/5 border border-gold-500/30 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Handshake size={14} className="text-gold-700 dark:text-gold-400" aria-hidden="true" />
          <p className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-gold-700 dark:text-gold-400">
            Pool Settled — Finish Up
          </p>
        </div>
        <p className="font-body text-[12px] text-muted leading-relaxed">
          The pool is settled and over. Something after that did not finish
          {settled.notifyMembers && !settled.emailedAt ? ': not every member has been emailed yet' : ': the record for site staff was not written'}.
          Retrying only does what is missing — nobody who was already emailed is emailed again.
        </p>
        <div className="flex justify-end">
          <button
            onClick={handleRetry}
            disabled={busy}
            className="min-h-[44px] bg-navy-800 hover:bg-navy-700 disabled:opacity-50 text-white font-display font-bold uppercase tracking-[0.05em] px-6 rounded-lg flex items-center gap-2 transition-ui duration-150 fine:hover:-translate-y-px cursor-pointer text-xs"
          >
            {busy ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

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

      {!current ? (
        <p className="font-body text-[12px] text-faint italic">Checking who is still alive…</p>
      ) : current.error ? (
        <p className="font-body text-[12px] text-brandred-600">{current.error}</p>
      ) : !preview || preview.alive.length === 0 ? (
        <p className="font-body text-[12px] text-faint italic">Nobody is still alive, so there is no pot to split.</p>
      ) : (
        <>
          <div className="bg-page border border-line rounded-md p-3 space-y-1">
            <p className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted num">
              {preview.alive.length === 1 ? 'Wins 1st place' : `Sharing 1st place (${preview.alive.length})`}
            </p>
            <p className="font-body text-sm text-[color:var(--text)]">{joinNames(names)}</p>
            <p className="font-body text-[12px] text-muted num">
              {preview.pot !== null
                ? <>Pot ${preview.pot}
                    {preview.entryCount !== null ? <>, priced on {preview.entryCount} {preview.entryCount === 1 ? 'entry' : 'entries'}</> : null}.{' '}
                    {preview.prizePerEntry !== null ? <>Recorded as ${preview.prizePerEntry} each.</> : <>The per-player amount is not priced.</>}</>
                : <>This pool has no priced pot, so no amount is recorded.</>}
            </p>
            <p className="font-body text-[11px] text-faint num">
              {preview.rebuyDuesExcluded > 0
                ? <>${preview.rebuyDuesExcluded} of rebuy dues are NOT part of this pot. </>
                : <>Rebuy dues are not part of the pot. </>}
              Money is still settled between you and your players.
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
          <label htmlFor="settle-notify-members" className="flex items-center gap-2 font-display font-bold uppercase text-[11px] tracking-[0.08em] text-[color:var(--text)] cursor-pointer">
            <input id="settle-notify-members" type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
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
