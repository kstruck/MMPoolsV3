import { describe, it, expect } from 'vitest';
import { buildNFLPayload } from './buildNFLPayload';
import { pickemCreateInputSchema, survivorCreateInputSchema } from '@shared/schemas';

const pickemBase: Record<string, unknown> = {
  type: 'NFL_PICKEM', name: 'Weekly Pickem', season: '2025', isPublic: true,
  managerName: '', contactEmail: '',
  paymentHandles: { venmo: '@x', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  paymentInstructions: '',
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  settings: {
    entryFee: 10, isListedPublic: true, lockMode: 'PER_GAME', payoutMode: 'SEASON',
    pickMode: 'STRAIGHT', lockBufferMinutes: 5, confidenceMode: false,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
  },
};

describe('buildNFLPayload', () => {
  it('builds a pickem payload that passes the server schema gate', () => {
    const p = buildNFLPayload(pickemBase, 'NFL_PICKEM');
    expect(p.type).toBe('NFL_PICKEM');
    expect(p.league).toBe('NFL');
    expect(p.season).toBe('2025');
    expect(pickemCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('dual-writes legacy handles', () => {
    const p = buildNFLPayload(pickemBase, 'NFL_PICKEM') as Record<string, any>;
    expect(p.venmo).toBe('@x');
    expect(p.paymentHandles.venmo).toBe('@x');
    expect('zelle' in p).toBe(false);
  });

  it('passes through survivor-specific settings and gate', () => {
    const survivorBase: Record<string, unknown> = {
      ...pickemBase, type: 'NFL_SURVIVOR',
      settings: {
        entryFee: 20, isListedPublic: true,
        maxStrikes: 1, maxRebuys: 0, rebuyDeadlineWeek: 4, rebuyCost: 20,
        pickLosersMode: false, autoSurviveExemptionEnabled: true,
        payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
      },
    };
    const p = buildNFLPayload(survivorBase, 'NFL_SURVIVOR');
    expect((p.settings as any).maxStrikes).toBe(1);
    expect(survivorCreateInputSchema.safeParse(p).success).toBe(true);
  });
});
