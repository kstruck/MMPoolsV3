import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkoutPoolInputSchema, PURCHASE_KINDS } from '../shared/schemas/quote';

/**
 * C2 of PLAN-PER-POOL-PREMIUM. Kevin, 2026-08-23:
 *
 * > "a pool manager must be able to buy a premium feature anytime during the
 * > season. For example, a pool manager decides he wants the AI premium
 * > feature. He needs a path to purchase this feature and then have that
 * > feature automatically turned on without my intervention."
 *
 * Three real blockers stood in the way, all verified in the code before this
 * change:
 *
 *  1. `createCheckoutSession` refused outright: *"This pool is already active."*
 *  2. `finalizePoolPayment` treated ANY session arriving for an active pool as
 *     a DOUBLE CHARGE — it no-op'd the entire finalization and filed an alert.
 *     A mid-season payment would have taken the money and granted nothing.
 *  3. `billing.featuresUnlocked` and `billing.paid.addons` were written by
 *     REPLACEMENT, so a second purchase revoked everything bought before it.
 *
 * (3) also bit the hosting path, which is why the merge below is not scoped to
 * add-on purchases: `adminSetPoolFeature` can grant a feature on a free or
 * trial pool, and activation would then have revoked Kevin's own grant.
 */
const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const stripe = read('functions/src/stripe.ts');
const engine = read('functions/src/lib/quoteEngine.ts');
const button = read('src/components/billing/AddonUpgradeButton.tsx');
const managerCard = read('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');
const bracket = read('src/components/BracketPoolDashboard/BracketPoolDashboard.tsx');

describe('purchaseKind — the input says what is being bought', () => {
  const valid = {
    poolId: 'p1', poolName: 'Pool', poolType: 'NFL_PICKEM', estimatedPlayers: 25,
    addons: { aiCommissioner: true },
  };

  it('defaults to `pool`, so every client that predates the field is unchanged', () => {
    const parsed = checkoutPoolInputSchema.parse(valid);
    expect(parsed.purchaseKind).toBe('pool');
  });

  it('accepts addon', () => {
    expect(checkoutPoolInputSchema.parse({ ...valid, purchaseKind: 'addon' }).purchaseKind).toBe('addon');
  });

  it('is a closed list', () => {
    expect(PURCHASE_KINDS).toEqual(['pool', 'addon']);
    expect(checkoutPoolInputSchema.safeParse({ ...valid, purchaseKind: 'anything' }).success).toBe(false);
  });
});

describe('checkout: the add-on path has its own preconditions', () => {
  it('the already-active refusal is scoped to the HOSTING path', () => {
    // Blocker 1. Un-scoping it entirely would let an inactive pool buy add-ons
    // with no hosting, so both directions are asserted.
    expect(stripe).toContain('if (!isAddonPurchase && freshBilling?.status === "active")');
    expect(stripe).toContain('if (isAddonPurchase && freshBilling?.status !== "active")');
  });

  it('refuses when there is nothing left to sell', () => {
    expect(stripe).toContain('quote.addonLines.length === 0 || serverPrice <= 0');
  });

  it('refuses an add-on that cannot be delivered on its own (codex r4 [P1])', () => {
    // `whatIfSimulator` is priced and premium in the config, but the feature is
    // rendered only by the Bracket dashboard AND is ungated there, so buying it
    // separately delivers nothing to anybody. Enforced server-side because a
    // stale client bundle would keep offering it.
    expect(stripe).toContain('.filter((k) => !isMidseasonSellableAddon(k));');
    expect(stripe).toContain('These features cannot be bought on their own:');
  });

  it('refuses credits and coupons on this path, rather than ignoring them', () => {
    expect(stripe).toContain('Pool credits pay for hosting, not for add-ons.');
    expect(stripe).toContain("Coupons apply to a pool's hosting purchase, not to add-ons bought later.");
  });

  it('counts what the pool owns from BOTH the purchase record and the grants', () => {
    // A super-admin grant (adminSetPoolFeature) lands in `featuresUnlocked`;
    // selling a commissioner something Kevin already gave them would be the
    // worst version of this feature.
    expect(stripe).toContain('existingBilling.paid?.addons');
    expect(stripe).toContain('Object.entries(existingBilling.featuresUnlocked ?? {})');
  });

  it('prices seats from the POOL, never from the client payload', () => {
    expect(stripe).toContain('estimatedPlayers: existingBilling.paid?.maxPlayersAllowed');
  });

  it('sends a PATCH of featuresUnlocked, not the four-key picture', () => {
    // The hosting shape carries `false` for every add-on the pool already owns,
    // which is a revocation once it is merged.
    expect(stripe).toContain('Object.fromEntries(pricedAddonKeys(quote.addonLines).map((k) => [k, true]))');
  });

  it('carries the kind on the session record AND in Stripe metadata', () => {
    expect(stripe).toContain('status: "pending",\n            purchaseKind,');
    expect(stripe).toContain('poolType,\n        purchaseKind,\n        reservationId,');
  });

  it('skips the free-tier rule, which is about activating a pool', () => {
    expect(stripe).toContain('if (!isAddonPurchase && (quote.tier === "free_tier" || serverPrice === 0))');
  });
});

describe('finalization: an active pool is no longer proof of a double charge', () => {
  it('reads the kind from the SESSION RECORD first, metadata second', () => {
    // The session doc is written by our own transaction; the metadata
    // round-trips through Stripe.
    expect(stripe).toContain('const purchaseKind = sessionKind ?? metadata.purchaseKind ?? "pool";');
  });

  it('scopes the double-charge guard to the hosting path', () => {
    expect(stripe).toContain('if (!isAddonPurchase && billing?.status === "active")');
  });

  it('replaces it with LEDGER idempotency for add-ons', () => {
    // The ledger row id IS the Stripe session id. This matters more here than
    // on the hosting path: `pricePaid` is an INCREMENT, so a replayed webhook
    // would inflate recorded spend even though the entitlement writes are
    // idempotent.
    expect(stripe).toContain('db.collection("billingCharges").doc(sessionId)');
    expect(stripe).toContain('if (ledgerSnap.exists) {');
  });

  it('merges the entitlement and the paid ceiling instead of replacing them', () => {
    expect(stripe).toContain('const mergedUnlocked: Record<string, boolean> = { ...priorUnlocked };');
    expect(stripe).toContain('const mergedPaidAddons = Array.from(new Set([...priorPaidAddons,');
    // Both paths, because the hosting path could otherwise revoke a
    // super-admin grant made before activation.
    expect(stripe).toContain('"billing.featuresUnlocked": mergedUnlocked,\n                "billing.paid.addons": mergedPaidAddons,');
    expect(stripe).toContain('addons: mergedPaidAddons,');
  });

  it('an add-on purchase does not re-negotiate hosting', () => {
    const addonWrite = stripe.slice(
      stripe.indexOf('if (isAddonPurchase) {\n            // Entitlement + ceiling + money.'),
      stripe.indexOf('} else {\n            // Activate pool + copy pending snapshot'),
    );
    expect(addonWrite).toContain('"billing.pricePaid"');
    expect(addonWrite).not.toContain('"billing.status"');
    expect(addonWrite).not.toContain('"billing.tier"');
    expect(addonWrite).not.toContain('"billing.maxPlayersAllowed"');
  });
});

describe('pricing stays server-side (ADR-0001)', () => {
  it('the add-on quote goes through the same computeAddonLines choke point', () => {
    expect(engine).toContain('const addonLines = computeAddonLines(config, requested);');
  });

  it('the button renders no price and computes none', () => {
    expect(button).not.toMatch(/\$\{?\d/);
    expect(button).not.toContain('addonPrice');
    expect(button).toContain('The price is shown there before anything is charged');
  });
});

describe('the commissioner has a path to it', () => {
  it('the button asks the server for a checkout session with the addon kind', () => {
    expect(button).toContain("purchaseKind: 'addon'");
    expect(button).toContain('dbService.createCheckoutSession(');
  });

  it('sits on the AI card, where the absence is felt', () => {
    expect(managerCard).toContain('<AddonUpgradeButton pool={pool} addon="aiCommissioner" label="AI Commissioner" />');
  });

  it('is offered only on an ACTIVE pool, matching what the server accepts', () => {
    expect(managerCard).toContain("castPool.billing?.status === 'active' && (");
  });
});

describe('codex r1 findings', () => {
  it('[P2] the Stripe product names the ADD-ON, not hosting', () => {
    // An add-on session used to tell Stripe the product was "Premium Hosting"
    // with a hosting-fee description, on a pool whose hosting was already paid
    // for. The receipt and the card statement would both have named something
    // the buyer did not buy.
    expect(stripe).toContain('quote.addonLines.map((l) => l.label).join(" + ")');
    expect(stripe).toContain('Your hosting is already paid for and is not charged again.');
  });

  it('[r2 P2] a grant that lands while the buyer is on Stripe is not silent', () => {
    // The ownership snapshot is taken at checkout. If Kevin grants the same
    // add-on before the customer finishes paying, the merge is still correct -
    // they own it - but they were charged for something that became free. The
    // money is already gone by webhook time, so the alert is the fix.
    expect(stripe).toContain('type: "ADDON_ALREADY_OWNED"');
    expect(stripe).toContain('.filter((k) => priorUnlocked[k] === true)');
    // Read from the pool AS READ IN THIS TRANSACTION, never from the session's
    // (stale) snapshot of what was owned.
    expect(stripe).toContain('const priorUnlocked = (billing?.featuresUnlocked ?? {}) as Record<string, boolean>;');
  });

  it('[P1] a Bracket commissioner gets the same path', () => {
    // The server path is pool-type agnostic; only the button placement was
    // NFL-only.
    expect(bracket).toContain('<AddonUpgradeButton pool={pool} addon="aiCommissioner" label="AI Commissioner" />');
    expect(bracket).toContain("isManager && aiPoolBilling?.status === 'active'");
  });
});
