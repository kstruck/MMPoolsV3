import { describe, it, expect } from 'vitest';
import { buildBracketPayload } from './buildBracketPayload';
import { bracketCreateInputSchema } from '@shared/schemas';

const base: Record<string, unknown> = {
  type: 'BRACKET', name: 'Office Madness', isPublic: true,
  seasonYear: 2026, gender: 'mens', tournamentType: 'ncaa',
  paymentInstructions: 'Venmo before tip-off',
  paymentHandles: { venmo: '@host', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  settings: {
    entryFee: 20, scoringSystem: 'CLASSIC',
    tieBreakers: { closestAbsolute: true, closestUnder: false },
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
};

describe('buildBracketPayload', () => {
  it('produces a createBracketPool payload passing the schema gate', () => {
    const p = buildBracketPayload(base) as Record<string, any>;
    expect(p.name).toBe('Office Madness');
    expect(p.seasonYear).toBe(2026);
    expect(p.gender).toBe('mens');
    expect(p.settings.entryFee).toBe(20);
    expect(bracketCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('nests handles under settings.paymentHandles (bracket shape), dropping blanks', () => {
    const p = buildBracketPayload(base) as Record<string, any>;
    expect(p.settings.paymentHandles.venmo).toBe('@host');
    expect('zelle' in p.settings.paymentHandles).toBe(false);
    expect(p.venmo).toBeUndefined(); // no legacy top-level for bracket
  });

  it('carries top-level launch fields (estimatedPlayers + addons) the server reads for free/trial', () => {
    const p = buildBracketPayload({
      ...base,
      estimatedPlayers: 25,
      addons: { aiCommissioner: true, smsNotifications: false, whatIfSimulator: false, customBranding: false },
    }) as Record<string, any>;
    expect(p.estimatedPlayers).toBe(25);
    expect(p.addons).toEqual({ aiCommissioner: true, smsNotifications: false, whatIfSimulator: false, customBranding: false });
    expect(bracketCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('omits estimatedPlayers when blank/0 and defaults all addons to false', () => {
    const p = buildBracketPayload(base) as Record<string, any>;
    expect('estimatedPlayers' in p).toBe(false); // no estimate → server treats as free
    expect(p.addons).toEqual({ aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false });
  });
});
