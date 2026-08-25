import { ADDON_KEYS, INCLUDED_ADDON_KEYS, UNSELLABLE_ADDON_KEYS, MIDSEASON_SELLABLE_ADDON_KEYS, type AddonKey } from '@shared/schemas/quote';
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

/**
 * Add-on keys a pool may still be SOLD, before the live config is consulted:
 * not free with every pool, not withdrawn from sale.
 *
 * Derived from `MIDSEASON_SELLABLE_ADDON_KEYS` in `shared/`, which the SERVER
 * enforces too — a stale bundle cannot offer what the checkout will refuse.
 * That list is narrower than "not included and not withdrawn": `whatIfSimulator`
 * is priced in the config but is rendered only by the Bracket dashboard and is
 * UNGATED there, so buying it separately delivers nothing to anybody. See the
 * reasoning at its definition. (codex r4 [P1].)
 *
 * ⚠️ NOT SUFFICIENT ON ITS OWN. `computeAddonLines` also drops any add-on whose
 * `billing_config` entry is `isPremium: false` or `addonPrice: 0`, so a static
 * list alone can offer a button that opens a checkout the server prices at $0
 * and then refuses as "nothing to buy" — a guaranteed dead end reachable from
 * one config save. `sellableAddonKeys(config)` applies that half. (codex.)
 */
export const PURCHASABLE_ADDON_KEYS: readonly AddonKey[] = ADDON_KEYS.filter(
    (k) => (MIDSEASON_SELLABLE_ADDON_KEYS as readonly string[]).includes(k)
        && !(INCLUDED_ADDON_KEYS as readonly string[]).includes(k)
        && !(UNSELLABLE_ADDON_KEYS as readonly string[]).includes(k),
);

/** The `billing_config.features` shape this module needs. Identity-keyed to the add-ons. */
export type AddonFeatureConfig = Partial<Record<AddonKey, { isPremium?: boolean; addonPrice?: number } | undefined>>;

/**
 * The add-ons the CONFIG will actually price, mirroring `computeAddonLines`:
 * premium, and priced above zero. With no config loaded yet, nothing is
 * offered — an empty section for a moment beats a button that dead-ends.
 */
export function sellableAddonKeys(features: AddonFeatureConfig | null | undefined): AddonKey[] {
    if (!features) return [];
    return PURCHASABLE_ADDON_KEYS.filter((k) => {
        const feat = features[k];
        return !!feat && feat.isPremium === true && (feat.addonPrice ?? 0) > 0;
    });
}

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

/**
 * The add-ons this pool could still buy. Empty means there is nothing to sell.
 *
 * `features` is the live `billing_config.features` map. Omitted, it falls back
 * to the static list — which is what the unit tests exercise, and what a caller
 * with no config in hand gets.
 */
export function purchasableAddons(
    pool: AddonablePool | null | undefined,
    features?: AddonFeatureConfig | null,
): AddonKey[] {
    const owned = new Set(ownedAddonKeys(pool));
    const offerable = features === undefined ? PURCHASABLE_ADDON_KEYS : sellableAddonKeys(features);
    return offerable.filter((k) => !owned.has(k));
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
export function addonablePools<T extends AddonablePool>(
    pools: T[],
    uid: string | undefined,
    features?: AddonFeatureConfig | null,
): T[] {
    return pools.filter((p) =>
        canCheckoutPool(p, uid)
        && p.billing?.status === 'active'
        && purchasableAddons(p, features).length > 0);
}
