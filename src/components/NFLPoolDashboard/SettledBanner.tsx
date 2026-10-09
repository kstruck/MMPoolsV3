import React from 'react';
import { Handshake } from 'lucide-react';
import { joinNames, type PoolSettlement } from '@shared/settlement';

/**
 * "Pool over — the pot was split" (PLAN-SPLIT-POT-SETTLEMENT §2.4).
 *
 * Rendered from `pool.settlement` ALONE — a server-owned field (firestore.rules),
 * written only by `settlePool` in the same transaction that ends the pool. It is
 * deliberately not driven by `closedVia`: the claim "A and B split the pot" must
 * come from the record that names them.
 *
 * The amount is shown only when the server priced it; an unpriced pool says
 * who shared 1st and nothing about money.
 */
export const SettledBanner: React.FC<{ settlement: PoolSettlement | undefined | null }> = ({ settlement }) => {
  if (!settlement || settlement.kind !== 'SPLIT' || !Array.isArray(settlement.winnerNames)) return null;
  const names = joinNames(settlement.winnerNames);
  const week = typeof settlement.throughWeek === 'number' ? ` after week ${settlement.throughWeek}` : '';
  // One survivor is a winner, not a split (qodo re-review of #715).
  const solo = settlement.winnerNames.length === 1;
  return (
    <div
      role="status"
      className="bg-gold-500/10 border border-gold-500/40 rounded-xl p-5 flex gap-3 items-start"
    >
      <Handshake size={20} className="text-gold-700 dark:text-gold-400 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-display font-bold uppercase text-[13px] tracking-[0.06em] text-[color:var(--text)]">
          {solo ? 'Pool over — we have a winner' : 'Pool over — the pot was split'}
        </p>
        <p className="font-body text-sm text-[color:var(--text)] num">
          {solo
            ? <>{names} won the pool{week}{typeof settlement.prizePerEntry === 'number' ? <>, ${settlement.prizePerEntry}</> : null}.</>
            : <>{names} agreed to split the pot{week} and share 1st place
                {typeof settlement.prizePerEntry === 'number' ? <>, ${settlement.prizePerEntry} each</> : null}.</>}
          {' '}No more picks can be made.
        </p>
        {settlement.note && (
          <p className="font-body text-[13px] text-muted">
            <span className="font-bold">Commissioner&rsquo;s note:</span> {settlement.note}
          </p>
        )}
      </div>
    </div>
  );
};
