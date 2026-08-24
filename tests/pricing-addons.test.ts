import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  addonablePools,
  purchasableAddons,
  ownedAddonKeys,
  PURCHASABLE_ADDON_KEYS,
  ADDON_LABELS,
  type AddonablePool,
} from '../src/components/billing/addonablePools';
import { upgradeablePools } from '../src/components/billing/upgradeablePools';
import { ADDON_KEYS } from '../shared/schemas/quote';

/**
 * D2 (Kevin, 2026-08-24, option (a)) — the surface for C2's mid-season add-on
 * purchase, and codex's carried finding on #539.
 *
 * The server path is pool-type agnostic and already worked for every format.
 * What was missing was somewhere every format can reach: the buy button existed
 * only on the NFL manager card and the Bracket dashboard, and PLAYOFF and PROPS
 * gate the feature on a TAB, where a purchase CTA does not belong. `/pricing`
 * serves all of them at once, and is already where the free-plan lock banner
 * and the lock email send a commissioner.
 */
const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');
const page = read('src/components/PricingPage.tsx');

const OWNER = 'u1';
const pool = (over: Partial<AddonablePool> = {}): AddonablePool => ({
  id: 'p1', name: 'Pool', type: 'NFL_PICKEM', ownerId: OWNER,
  billing: { status: 'active' }, ...over,
});

describe('what can still be sold', () => {
  it('excludes add-ons that are free with every pool, and ones nothing sells', () => {
    // customBranding ships free (T4/D1); smsNotifications is clamped unsellable.
    // Offering either would open a checkout the server prices at $0 and then
    // refuses as "nothing to buy".
    expect(PURCHASABLE_ADDON_KEYS).toEqual(['aiCommissioner', 'whatIfSimulator']);
  });

  it('names every key the schema has, so a new one cannot ship unlabelled', () => {
    for (const key of ADDON_KEYS) expect(ADDON_LABELS[key]).toBeTruthy();
  });

  it('counts what a pool owns from BOTH purchases and grants', () => {
    // `paid.addons` records purchases; `featuresUnlocked` also carries a
    // super-admin grant (adminSetPoolFeature) on a pool that bought nothing.
    expect(ownedAddonKeys(pool({
      billing: { status: 'active', paid: { addons: ['whatIfSimulator'] }, featuresUnlocked: { aiCommissioner: true } },
    })).sort()).toEqual(['aiCommissioner', 'whatIfSimulator']);
  });

  it('a granted-then-revoked add-on counts as NOT owned', () => {
    expect(ownedAddonKeys(pool({
      billing: { status: 'active', featuresUnlocked: { aiCommissioner: false } },
    }))).toEqual([]);
  });

  it('offers only what the pool is missing', () => {
    expect(purchasableAddons(pool())).toEqual(['aiCommissioner', 'whatIfSimulator']);
    expect(purchasableAddons(pool({
      billing: { status: 'active', featuresUnlocked: { aiCommissioner: true } },
    }))).toEqual(['whatIfSimulator']);
  });
});

describe('which pools are listed', () => {
  it('ACTIVE only — the server refuses an add-on checkout for anything else', () => {
    for (const status of ['trial', 'grace_period', 'free', 'locked'] as const) {
      expect(addonablePools([pool({ billing: { status } })], OWNER)).toEqual([]);
    }
    expect(addonablePools([pool()], OWNER)).toHaveLength(1);
  });

  it('is DISJOINT from the upgrade list — a pool is never in both', () => {
    const pools = [
      pool({ id: 'active', billing: { status: 'active' } }),
      pool({ id: 'trial', billing: { status: 'trial' } }),
      pool({ id: 'locked', billing: { status: 'locked' } }),
    ];
    const addon = addonablePools(pools, OWNER).map(p => p.id);
    const upgrade = upgradeablePools(pools as never[], OWNER).map((p: { id?: string }) => p.id);
    expect(addon).toEqual(['active']);
    expect(upgrade.sort()).toEqual(['locked', 'trial']);
    expect(addon.filter(id => upgrade.includes(id))).toEqual([]);
  });

  it('drops a pool that already owns everything, rather than showing an empty row', () => {
    expect(addonablePools([pool({
      billing: { status: 'active', featuresUnlocked: { aiCommissioner: true, whatIfSimulator: true } },
    })], OWNER)).toEqual([]);
  });

  it('never lists someone else’s pool', () => {
    expect(addonablePools([pool({ ownerId: 'someone-else' })], OWNER)).toEqual([]);
    expect(addonablePools([pool()], undefined)).toEqual([]);
  });
});

describe('the page renders it', () => {
  it('lists the pools and a button per missing add-on', () => {
    expect(page).toContain('Add-ons for your active pools');
    expect(page).toContain('{addonPools.map((pool) => (');
    expect(page).toContain('{purchasableAddons(pool).map((addon) => (');
    expect(page).toContain('<AddonUpgradeButton');
  });

  it('renders nothing at all when there is nothing to sell', () => {
    // The list is already filtered, so an empty one means every pool owns
    // everything — a heading there would be noise, not information.
    expect(page).toContain('{addonPools.length > 0 && (');
  });

  it('feeds both lists from the SAME snapshot, so they cannot disagree', () => {
    expect(page).toContain('setUserPools(upgradeablePools(poolsList, user.id));');
    expect(page).toContain('setAddonPools(addonablePools(poolsList as unknown as AddonablePool[], user.id));');
  });

  it('quotes no price — Stripe does that (ADR-0001)', () => {
    expect(page).toContain('The price is shown at checkout before anything is charged');
  });
});
