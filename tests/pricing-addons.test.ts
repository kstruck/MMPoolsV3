import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  addonablePools,
  purchasableAddons,
  ownedAddonKeys,
  PURCHASABLE_ADDON_KEYS,
  ADDON_LABELS,
  sellableAddonKeys,
  type AddonablePool,
  type AddonFeatureConfig,
} from '../src/components/billing/addonablePools';
import { upgradeablePools } from '../src/components/billing/upgradeablePools';
import { ADDON_KEYS, isMidseasonSellableAddon } from '../shared/schemas/quote';

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
  it('sells only what can actually be delivered on its own', () => {
    // customBranding ships free (T4/D1); smsNotifications is clamped unsellable;
    // and whatIfSimulator is rendered ONLY by the Bracket dashboard and is
    // UNGATED there, so buying it separately delivers nothing to anybody
    // (codex r4 [P1] — filtering to BRACKET would still charge a bracket
    // commissioner for something they already have free).
    expect(PURCHASABLE_ADDON_KEYS).toEqual(['aiCommissioner']);
    expect(PURCHASABLE_ADDON_KEYS).not.toContain('whatIfSimulator');
  });

  it('the offer list is DERIVED from the shared authority the server enforces', () => {
    // A stale client bundle must not be able to offer what checkout refuses.
    for (const k of PURCHASABLE_ADDON_KEYS) expect(isMidseasonSellableAddon(k)).toBe(true);
    expect(isMidseasonSellableAddon('whatIfSimulator')).toBe(false);
    expect(isMidseasonSellableAddon('customBranding')).toBe(false);
    expect(isMidseasonSellableAddon('smsNotifications')).toBe(false);
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
    expect(purchasableAddons(pool())).toEqual(['aiCommissioner']);
    expect(purchasableAddons(pool({
      billing: { status: 'active', featuresUnlocked: { aiCommissioner: true } },
    }))).toEqual([]);
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
      billing: { status: 'active', featuresUnlocked: { aiCommissioner: true } },
    })], OWNER)).toEqual([]);
  });

  it('never lists someone else’s pool', () => {
    expect(addonablePools([pool({ ownerId: 'someone-else' })], OWNER)).toEqual([]);
    expect(addonablePools([pool()], undefined)).toEqual([]);
  });
});

describe('codex [P2]: the CONFIG decides what is sellable, not a static list', () => {
  /**
   * `computeAddonLines` drops any add-on whose `billing_config` entry is
   * `isPremium: false` or `addonPrice: 0`. A static list alone would render a
   * button that opens a checkout the server prices at $0 and then refuses as
   * "nothing to buy" — a guaranteed dead end, one config save away.
   */
  const priced: AddonFeatureConfig = {
    aiCommissioner: { isPremium: true, addonPrice: 19 },
    whatIfSimulator: { isPremium: true, addonPrice: 9 },
  };

  it('offers only what the config will price', () => {
    expect(sellableAddonKeys(priced)).toEqual(['aiCommissioner']);
    expect(sellableAddonKeys({ ...priced, aiCommissioner: { isPremium: false, addonPrice: 19 } }))
      .toEqual([]);
    expect(sellableAddonKeys({ ...priced, aiCommissioner: { isPremium: true, addonPrice: 0 } }))
      .toEqual([]);
  });

  it('offers NOTHING before the config has loaded', () => {
    // An empty section for a moment beats a button that dead-ends.
    expect(sellableAddonKeys(null)).toEqual([]);
    expect(sellableAddonKeys(undefined)).toEqual([]);
    expect(addonablePools([pool()], OWNER, null)).toEqual([]);
  });

  it('a pool whose only remaining add-on was switched off drops off the list', () => {
    const p = pool({ billing: { status: 'active' } });
    expect(addonablePools([p], OWNER, priced)).toHaveLength(1);
    expect(addonablePools([p], OWNER, { ...priced, aiCommissioner: { isPremium: false, addonPrice: 19 } }))
      .toEqual([]);
  });

  it('omitting the config keeps the old static behaviour, for callers without one', () => {
    expect(purchasableAddons(pool())).toEqual(['aiCommissioner']);
  });
});

describe('codex [P2]: the list follows the CURRENT user, never a stale snapshot', () => {
  it('is empty with no signed-in user', () => {
    // Derived from `user?.id` at render rather than filtered into state: the
    // subscription effect returns early when there is no user, so it would
    // never clear what it had written, and the previous account's pools would
    // stay on screen after a sign-out or an account switch.
    expect(addonablePools([pool()], undefined, undefined)).toEqual([]);
  });

  it('the page derives it rather than storing it', () => {
    expect(page).toContain('const addonPools = useMemo(');
    expect(page).toContain('addonablePools(rawPools, user?.id, liveAddonFeatures)');
    expect(page).not.toContain('setAddonPools(');
  });
});

describe('codex r2 [P2]: no CTA until a REAL config has been read', () => {
  it('offers from the STORED features, never the client fallback', () => {
    // `config` falls back to DEFAULT_BILLING_CONFIG, whose add-on prices are
    // NON-ZERO, while the server's `loadBillingConfig` falls back to
    // `addonPrice: 0` for every add-on. Offering from the client default when
    // no config doc exists puts up buttons the server is certain to refuse.
    expect(page).toContain('const [liveAddonFeatures, setLiveAddonFeatures] = useState<AddonFeatureConfig | null>(null);');
    expect(page).toContain('setLiveAddonFeatures(parsed.success ? parsed.data.features : null);');
    expect(page).not.toContain('config?.features');
  });

  it('parses the WHOLE document with the SAME schema the server uses (r3)', () => {
    // `loadBillingConfig` runs BillingConfigSchema over the ENTIRE doc and
    // falls back to $0 add-ons if ANY field fails — a broken `pricing` block
    // included. Reading `features` raw would offer from a document the server
    // has already rejected wholesale.
    expect(page).toContain("import { BillingConfigSchema } from '@shared/schemas/billingConfig';");
    expect(page).toContain('const parsed = BillingConfigSchema.safeParse(raw);');
  });

  it('clears the offer when the config is DELETED or unreadable (r3)', () => {
    // A deleted config must not leave the last-known features standing: the
    // server would be back to $0 add-ons.
    const afterParse = page.slice(page.indexOf('BillingConfigSchema.safeParse(raw)'));
    expect(afterParse).toContain('} else {');
    expect((page.match(/setLiveAddonFeatures\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('a malformed config offers nothing, because the fields it needs are missing', () => {
    expect(sellableAddonKeys({} as AddonFeatureConfig)).toEqual([]);
    expect(sellableAddonKeys({ aiCommissioner: {} } as AddonFeatureConfig)).toEqual([]);
    expect(sellableAddonKeys({ aiCommissioner: { isPremium: true } } as AddonFeatureConfig)).toEqual([]);
  });
});

describe('the page renders it', () => {
  it('lists the pools and a button per missing add-on', () => {
    expect(page).toContain('Add-ons for your active pools');
    expect(page).toContain('{addonPools.map((pool: AddonablePool) => (');
    expect(page).toContain('{purchasableAddons(pool, liveAddonFeatures).map((addon) => (');
    expect(page).toContain('<AddonUpgradeButton');
  });

  it('renders nothing at all when there is nothing to sell', () => {
    // The list is already filtered, so an empty one means every pool owns
    // everything — a heading there would be noise, not information.
    expect(page).toContain('{addonPools.length > 0 && (');
  });

  it('feeds both lists from the SAME snapshot, so they cannot disagree', () => {
    expect(page).toContain('setUserPools(upgradeablePools(poolsList, user.id));');
    expect(page).toContain('setRawPools(poolsList as unknown as AddonablePool[]);');
  });

  it('quotes no price — Stripe does that (ADR-0001)', () => {
    expect(page).toContain('The price is shown at checkout before anything is charged');
  });
});
