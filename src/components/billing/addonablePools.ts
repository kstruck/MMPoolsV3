import { ADDON_KEYS, INCLUDED_ADDON_KEYS, UNSELLABLE_ADDON_KEYS, type AddonKey } from '@shared/schemas/quote';
import { canCheckoutPool, type UpgradeablePool } from './upgradeablePools';
import type { BillingStatus } from '../../types';

/**
 * Which of a commissioner's pools can be sold an ADD-ON right now, and which
 * add-ons (PLAN-PER-POOL-PREMIUM C2, and codex's carried finding on #539).
 *
 * The server path is pool-type agnostic and already works for every format —
 * what was missing was a surface every format can reach. `/pricing` is that
 * surface: the free-plan lock banner and the lock email already send
 * commissioners here, and it needs no new placement decision in three
 * unfamiliar dashboards (Kevin's ruling, 2026-08-24: option (a)).
 *
 * ⚠️ THIS DECIDES WHAT TO OFFER, NEVER WHAT TO CHARGE. Prices come from
 * `computeAddonUpgradeQuote` on the server and are shown on Stripe's own
 * checkout page (ADR-0001). Everything here is presentation: showing a pool a
 * button it cannot use is the defect this avoids, not a security boundary.
 */

/** Add-on keys a pool may still be SOLD: not free with every pool, not withdrawn. */
export const PURCHASABLE_ADDON_KEYS: readonly AddonKey[] = ADDON_KEYS.filter(
    (k) => !(INCLUDED_ADDON_KEYS as readonly string[]).includes(k)
        && !(UNSELLABLE_ADDON_KEYS as readonly string[]).includes(k),
);

/** Commissioner-facing names. The keys are internal; these are not. */
export const ADDON_LABELS: Record<AddonKey, string> = {
    aiCommissioner: 'AI Commissioner',
    smsNotifications: 'SMS notifications',
    whatIfSimulator: 'What-If simulator',
    customBranding: 'Custom branding',
};

export interface AddonablePool extends UpgradeablePool {
    name?: string;
    type?: string;
    /**
     * Widens `UpgradeablePool['billing']` rather than replacing it — the
     * `status` type has to stay `BillingStatus` or this stops being assignable
     * to the shape `canCheckoutPool` reads, and the two lists would drift on
     * exactly the field that separates them.
     */
    billing?: {
        status?: BillingStatus;
        featuresUnlocked?: Record<string, boolean>;
        paid?: { addons?: string[] };
    } | null;
}

/**
 * What this pool already holds, from BOTH sources — they can differ.
 * `paid.addons` records purchases; `featuresUnlocked` ALSO carries a
 * super-admin grant (`adminSetPoolFeature`) on a pool that never bought
 * anything. The server unions the same two before pricing, so offering a
 * button the server would refuse as "nothing to buy" is the mismatch this
 * closes.
 */
export function ownedAddonKeys(pool: AddonablePool | null | undefined): string[] {
    const billing = pool?.billing;
    const paid = Array.isArray(billing?.paid?.addons) ? billing!.paid!.addons! : [];
    const granted = Object.entries(billing?.featuresUnlocked ?? {})
        .filter(([, on]) => on === true)
        .map(([k]) => k);
    return Array.from(new Set([...paid, ...granted]));
}

/** The add-ons this pool could still buy. Empty means there is nothing to sell. */
export function purchasableAddons(pool: AddonablePool | null | undefined): AddonKey[] {
    const owned = new Set(ownedAddonKeys(pool));
    return PURCHASABLE_ADDON_KEYS.filter((k) => !owned.has(k));
}

/**
 * The pools to list under "Add-ons".
 *
 * ACTIVE only, and that is not a UI preference: `createCheckoutSession`
 * refuses an add-on purchase for a pool that is not active ("Buy hosting for it
 * first — add-ons come with that purchase"), because an inactive pool's add-ons
 * come with the hosting purchase it has not made yet. Those pools belong in the
 * UPGRADE list above, not this one — which is also why `upgradeablePools`
 * excludes `active` and this includes only `active`. The two lists are
 * deliberately disjoint.
 */
export function addonablePools<T extends AddonablePool>(pools: T[], uid: string | undefined): T[] {
    return pools.filter((p) =>
        canCheckoutPool(p, uid)
        && p.billing?.status === 'active'
        && purchasableAddons(p).length > 0);
}
