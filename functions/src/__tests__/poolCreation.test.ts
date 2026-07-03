import { describe, it, expect } from 'vitest';
import { validateCreateInput, assertNotBanned, freeBilling } from '../lib/poolCreation';

// Full side-effect bundle (managedPools / participations / activity / role
// upgrade) is verified against the emulator per the plan; here we lock the pure
// gate + ban + billing logic that guards every create path.

describe('validateCreateInput (schema gate)', () => {
  it('accepts a valid squares payload', () => {
    expect(() => validateCreateInput('SQUARES', { name: 'Big Game', costPerSquare: 10 })).not.toThrow();
  });
  it('rejects squares missing costPerSquare', () => {
    expect(() => validateCreateInput('SQUARES', { name: 'Big Game' })).toThrow();
  });
  it('rejects an NFL pickem missing season', () => {
    expect(() =>
      validateCreateInput('NFL_PICKEM', {
        type: 'NFL_PICKEM',
        name: 'Weekly',
        settings: { entryFee: 0, payouts: { places: [], bonuses: [] } },
      }),
    ).toThrow();
  });
  it('accepts a valid bracket payload', () => {
    expect(() =>
      validateCreateInput('BRACKET', { name: 'Madness', seasonYear: 2026, settings: { entryFee: 20 } }),
    ).not.toThrow();
  });
});

describe('assertNotBanned', () => {
  it('throws when the claim role is BANNED', () => {
    expect(() => assertNotBanned('BANNED', undefined)).toThrow();
  });
  it('throws when the user-doc role is BANNED', () => {
    expect(() => assertNotBanned(undefined, 'BANNED')).toThrow();
  });
  it('allows normal roles (new + legacy)', () => {
    expect(() => assertNotBanned('MEMBER', 'PARTICIPANT')).not.toThrow();
    expect(() => assertNotBanned('COMMISSIONER', 'POOL_MANAGER')).not.toThrow();
  });
});

describe('freeBilling', () => {
  it('stamps the free plan (no auto-lock)', () => {
    const b = freeBilling();
    expect(b.status).toBe('free');
    expect(b.tier).toBe('free_tier');
    expect(b.pricePaid).toBe(0);
  });
});
