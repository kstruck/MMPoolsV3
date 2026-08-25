import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { getUserMessage } from '../../utils/errorMessages';
import { useToast } from '../ui/Toast';
import type { Pool } from '../../types';
import type { AddonKey } from '@shared/schemas/quote';

/**
 * Buy ONE add-on for a pool that is already active, mid-season
 * (PLAN-PER-POOL-PREMIUM C2). Kevin, 2026-08-23:
 *
 * > "a pool manager must be able to buy a premium feature anytime during the
 * > season… He needs a path to purchase this feature and then have that feature
 * > automatically turned on without my intervention."
 *
 * The "without my intervention" half is the Stripe webhook: on
 * `checkout.session.completed`, `finalizePoolPayment` merges the add-on into
 * `billing.featuresUnlocked` and `billing.paid.addons`. Nothing here grants
 * anything.
 *
 * ⚠️ NO PRICE IS RENDERED HERE, deliberately. `computeQuote` /
 * `computeAddonUpgradeQuote` are the only price authority (ADR-0001) and the
 * client never computes one; Stripe's own checkout page shows the amount before
 * anything is charged, so a second quote surface would be a second place for
 * the two numbers to disagree.
 */
export const AddonUpgradeButton: React.FC<{
  pool: Pool;
  addon: AddonKey;
  /** What the commissioner is buying, in their words. */
  label: string;
  className?: string;
}> = ({ pool, addon, label, className }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const buy = async () => {
    const ok = await toast.confirm({
      title: `Add ${label} to this pool?`,
      message: `You will be taken to Stripe to pay for ${label}. The price is shown there before anything is charged, and ${label} switches on for "${pool.name}" as soon as the payment completes.`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { sessionUrl } = await dbService.createCheckoutSession({
        purchaseKind: 'addon',
        poolId: pool.id,
        poolName: pool.name,
        poolType: pool.type,
        // Ignored by the server on this path — it prices no seats and reads the
        // pool's own allowance — but the shared schema requires the field.
        estimatedPlayers: 0,
        addons: { [addon]: true } as never,
      });
      window.location.href = sessionUrl;
    } catch (err) {
      toast.error(getUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={buy}
      disabled={busy}
      className={className ?? 'mt-2 inline-flex items-center gap-1.5 border border-gold-500/60 text-gold-700 dark:text-gold-300 px-4 py-2 rounded-md font-display font-bold uppercase text-[10px] tracking-[0.08em] transition-all duration-150 hover:bg-gold-500/10 disabled:opacity-50 disabled:cursor-not-allowed'}
    >
      <Sparkles size={13} aria-hidden="true" /> {busy ? 'Opening checkout…' : `Add ${label}`}
    </button>
  );
};
