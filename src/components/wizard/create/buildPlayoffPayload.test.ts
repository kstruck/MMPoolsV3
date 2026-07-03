import { describe, it, expect } from 'vitest';
import { buildPlayoffPayload } from './buildPlayoffPayload';
import { playoffCreateInputSchema } from '@shared/schemas';

const base: Record<string, unknown> = {
  type: 'NFL_PLAYOFFS',
  name: 'Test Pool',
  season: '2025',
  isPublic: true,
  managerName: '',
  contactEmail: '',
  paymentHandles: { venmo: '@me', zelle: '', cashapp: '', paypal: '', googlePay: 'g' },
  paymentInstructions: '',
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  reminders: { auto24h: true, auto1h: true, autoLock: true, announceWinner: true },
  lockDate: '2026-01-10T18:00',
  settings: {
    entryFee: 25,
    payouts: { places: [{ rank: 1, percentage: 100 }], bonuses: [] },
    scoring: { roundMultipliers: { WILD_CARD: 1, DIVISIONAL: 2, CONF_CHAMP: 3, SUPER_BOWL: 4 } },
  },
};

describe('buildPlayoffPayload', () => {
  it('produces a well-formed NFL_PLAYOFFS payload', () => {
    const p = buildPlayoffPayload(base) as Record<string, any>;
    expect(p.type).toBe('NFL_PLAYOFFS');
    expect(p.league).toBe('NFL');
    expect(p.name).toBe('Test Pool');
    expect(p.settings.entryFee).toBe(25);
    expect(p.settings.scoring.roundMultipliers.SUPER_BOWL).toBe(4);
    expect(Array.isArray(p.teams)).toBe(true);
    expect(p.teams.length).toBe(14);
  });

  it('dual-writes legacy handles and drops the empty ones', () => {
    const p = buildPlayoffPayload(base) as Record<string, any>;
    expect(p.venmo).toBe('@me');
    expect(p.paymentHandles.venmo).toBe('@me');
    expect(p.paymentHandles.googlePay).toBe('g');
    expect('zelle' in p).toBe(false);
    expect('zelle' in p.paymentHandles).toBe(false);
  });

  it('converts a datetime-local lockDate to millis', () => {
    const p = buildPlayoffPayload(base) as Record<string, any>;
    expect(typeof p.lockDate).toBe('number');
    expect(p.lockDate).toBe(new Date('2026-01-10T18:00').getTime());
  });

  it('output passes the server-side create schema gate', () => {
    const p = buildPlayoffPayload(base);
    const result = playoffCreateInputSchema.safeParse(p);
    expect(result.success).toBe(true);
  });
});
