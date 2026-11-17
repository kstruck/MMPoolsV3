import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// stripe.ts touches admin.firestore() at module load — stub the SDK so the pure
// helper can be imported (same shape as checkoutOwnership.test.ts).
vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({}), {
    FieldValue: { delete: () => null, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) },
  });
  return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore, apps: [], initializeApp: () => undefined };
});
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => null, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) } }));

import { checkoutPricingType } from '../stripe';

/**
 * qodo #786, finding 1: `createCheckoutSession` priced a pool from the CALLER's
 * `poolType`. Once a $0 squares band is quoted free_tier
 * (PLAN-SQUARES-ZERO-PRICE-FREE), the owner of a non-squares pool could send
 * `poolType: "SQUARES"` and take the $0 free path — and before that, price any
 * pool as the cheapest format. A hosting checkout is now priced as the pool's
 * STORED type.
 */
describe('checkoutPricingType', () => {
  it('is the stored type, whatever the caller would have sent', () => {
    expect(checkoutPricingType('NFL_PICKEM')).toBe('NFL_PICKEM');
    expect(checkoutPricingType('BRACKET')).toBe('BRACKET');
    expect(checkoutPricingType('SQUARES')).toBe('SQUARES');
  });
  // The pricing page always sent `poolType.toUpperCase()`, and formatTierMap is
  // keyed in capitals, so a legacy lowercase stored type must price the same.
  it('is upper-cased, as the pricing page always sent it', () => {
    expect(checkoutPricingType('playoff')).toBe('PLAYOFF');
    expect(checkoutPricingType(' squares ')).toBe('SQUARES');
  });
    it('a pool with no stored type is a legacy squares pool (createPool and the rules agree)', () => {
    for (const t of [undefined, null, '', '  ', 42]) expect(checkoutPricingType(t)).toBe('SQUARES');
  });
});

describe('createCheckoutSession prices the stored type, never the request', () => {
  const src = readFileSync(resolve(__dirname, '../stripe.ts'), 'utf8');
  const body = src.slice(src.indexOf('export const createCheckoutSession'));
  const poolPath = body.slice(body.indexOf('STANDARD POOL PURCHASE PATH'));

  it('does not take poolType from the request', () => {
    const destructure = poolPath.slice(poolPath.indexOf('const {'), poolPath.indexOf('} = input;'));
    expect(destructure).not.toMatch(/\bpoolType\b/);
    expect(poolPath).not.toMatch(/input\.poolType/);
  });

  it('derives it from the pool read, before anything is priced', () => {
    const read = poolPath.indexOf('assertPoolTypePurchasable(poolData?.type)');
    const derive = poolPath.indexOf('const poolType = checkoutPricingType(poolData?.type)');
    const firstPrice = poolPath.indexOf('loadBillingConfig(');
    expect(read).toBeGreaterThan(-1);
    expect(derive).toBeGreaterThan(read);
    expect(firstPrice).toBeGreaterThan(derive);
  });
});
