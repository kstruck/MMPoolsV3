import { ADDON_KEYS, type AddonSelection } from '@shared/schemas/quote';

/**
 * Which add-ons the upgrade page should pre-select for a pool
 * (PLAN-WIZARD-BUYFLOW-FIXES T3).
 *
 * The bug: /pricing seeded its toggles from `billing.featuresUnlocked`, which a
 * TRIAL launch stamps all-false (`functions/src/lib/poolCreation.ts`,
 * `LOCKED_FEATURES`). So the commissioner who ticked AI Commissioner in the
 * wizard, saw a $147 quote, and clicked "Upgrade Now" landed on a checkout with
 * nothing selected — and the field that DID hold their choice, top-level
 * `pool.addons` (written by `readLaunchFields`), was never read.
 *
 * The rule, in order:
 *
 *  1. A pool that has actually PAID (`billing.paid` exists) is described by
 *     `featuresUnlocked` — that is what it owns. Its stored `addons` is the
 *     older wizard intent and may name things the commissioner chose not to
 *     buy; seeding from it would re-sell them.
 *  2. Otherwise the commissioner's own selection (`addons`) wins.
 *  3. A legacy pool with no `addons` map at all falls back to
 *     `featuresUnlocked`, which is the only record it has.
 *
 * Nothing here decides price — the server re-quotes whatever the card sends.
 * This only decides which boxes start ticked.
 */
export interface AddonSeedPool {
    addons?: Partial<Record<string, unknown>> | null;
    billing?: {
        paid?: unknown;
        featuresUnlocked?: Partial<Record<string, unknown>> | null;
    } | null;
}

export function addonSeed(pool: AddonSeedPool | null | undefined): AddonSelection {
    const unlocked = (pool?.billing?.featuresUnlocked ?? {}) as Record<string, unknown>;
    const selected = pool?.addons;
    const hasSelection = !!selected && typeof selected === 'object';
    const hasPaid = pool?.billing?.paid != null;

    const source: Record<string, unknown> =
        hasPaid || !hasSelection ? unlocked : (selected as Record<string, unknown>);

    return ADDON_KEYS.reduce((acc, key) => {
        acc[key] = source[key] === true;
        return acc;
    }, {} as Record<string, boolean>) as AddonSelection;
}
