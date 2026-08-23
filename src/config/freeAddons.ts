import { ADDON_KEYS, type AddonSelection } from '@shared/schemas/quote';

/**
 * Add-ons that are INCLUDED with every pool and must never be sold
 * (PLAN-WIZARD-BUYFLOW-FIXES T4, Kevin's ruling D1: "Free for everyone, remove
 * the $29 fee. No one has paid that yet.").
 *
 * The defect: `customBranding` was priced ($29 by default) and stamped into
 * `billing.featuresUnlocked.customBranding` on activation, but **nothing gated
 * it**. No server check passed `customBranding` to `checkBillingAccess`, no
 * render path read the flag, and the wizard's branding step asked everyone for
 * a logo and two colours regardless. Commissioners could be charged for a flag
 * with zero effect while the feature it names was free.
 *
 * Why a client-side strip rather than only the config change: setting
 * `isPremium: false` in `settings/billing_config` makes `computeAddonLines`
 * drop the line server-side, and that save is Kevin's to make in the Super-Admin
 * panel. This module makes the UI correct **without depending on it** — the
 * client simply stops asking for the add-on, so the price is $0 either way and
 * the two changes can land in either order.
 *
 * The key, the schema and the `featuresUnlocked` plumbing all stay, dormant,
 * for a future genuinely-premium branding tier (cover images, custom headers,
 * themes). When that exists, delete the key from this list.
 */
export const FREE_ADDON_KEYS = ['customBranding'] as const;

export function isFreeAddon(key: string): boolean {
    return (FREE_ADDON_KEYS as readonly string[]).includes(key);
}

/** The add-on keys a wizard or pricing surface may offer for sale. */
export const SELLABLE_ADDON_KEYS = ADDON_KEYS.filter((k) => !isFreeAddon(k));

/**
 * Clears every free add-on before a selection is sent to `getPoolQuote` or
 * `createCheckoutSession`. A pool created before this change can still carry
 * `addons.customBranding: true`, and the upgrade page seeds its toggles from
 * exactly that — so without this strip an old pool would still be quoted $29
 * for something no longer on screen.
 */
export function stripFreeAddons(addons: AddonSelection): AddonSelection {
    const out = { ...addons };
    for (const key of FREE_ADDON_KEYS) out[key] = false;
    return out;
}
