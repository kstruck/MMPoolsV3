import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkoutPricingType } from '../src/utils/checkoutPricingType';
import { checkoutPricingType as serverCheckoutPricingType } from '../functions/src/stripe';
import { POOL_TYPES } from '../shared/poolTypes';

/**
 * The pricing page quotes, and the add-on button sends, the type the SERVER
 * prices a checkout as. If the two differ, the page shows one price and Stripe
 * charges another — or, for a legacy type the schemas reject, the pay button
 * never arms. So the client copy is pinned to the server function itself.
 */

const STORED_TYPES: unknown[] = [
  undefined, null, '', '   ', 42, {},
  'SQUARES', 'squares', ' Squares ',
  'BRACKET', 'bracket',
  'NFL_PLAYOFFS', 'nfl_playoffs',
  'playoff', 'PLAYOFF', 'Playoff',
  'NFL_PLAYOFF', 'nfl_playoff',
  'PROPS', 'NFL_PICKEM', 'nfl_pickem', 'NFL_SURVIVOR', 'NFL_MARGIN',
];

describe('checkoutPricingType (client) matches the server', () => {
  it.each(STORED_TYPES.map((t) => [t]))('stored type %j', (stored) => {
    expect(checkoutPricingType(stored)).toBe(serverCheckoutPricingType(stored));
  });

  it('every type a pool is stored with today, and the legacy ones, prices as a real format', () => {
    for (const stored of [...POOL_TYPES, 'playoff', 'NFL_PLAYOFF', undefined, '']) {
      expect(POOL_TYPES as readonly string[]).toContain(checkoutPricingType(stored));
    }
  });

  it('legacy cases', () => {
    expect(checkoutPricingType('playoff')).toBe('NFL_PLAYOFFS');
    expect(checkoutPricingType(undefined)).toBe('SQUARES');
  });
});

describe('the checkout callers use it', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

  it('the pricing page quotes the selected pool as its checkout pricing type', () => {
    const pricing = read('src/components/PricingPage.tsx');
    expect(pricing).toContain('setCalcPoolType(checkoutPricingType(');
    expect(pricing).not.toContain('setCalcPoolType(pool.type)');
  });

  it('the add-on button sends the checkout pricing type, not the raw stored type', () => {
    const button = read('src/components/billing/AddonUpgradeButton.tsx');
    expect(button).toContain('poolType: checkoutPricingType(');
    expect(button).not.toContain('poolType: pool.type,');
  });
});
