import { describe, it, expect } from 'vitest';
import { buildSquaresPayload } from './buildSquaresPayload';
import { squaresCreateInputSchema } from '@shared/schemas';

const base: Record<string, unknown> = {
  type: 'SQUARES', name: 'Big Game Squares', isPublic: true,
  homeTeam: 'Chiefs', awayTeam: 'Eagles',
  costPerSquare: 10, maxSquaresPerPlayer: 5, numberSets: '4', gridSize: '10x10', theme: 'default',
  managerName: '', contactEmail: '',
  paymentHandles: { venmo: '@me', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  paymentInstructions: '',
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
};

describe('buildSquaresPayload', () => {
  it('produces a SQUARES payload passing the schema gate', () => {
    const p = buildSquaresPayload(base) as Record<string, any>;
    expect(p.type).toBe('SQUARES');
    expect(p.name).toBe('Big Game Squares');
    expect(p.costPerSquare).toBe(10);
    expect(p.numberSets).toBe(4); // coerced select string -> number
    expect(squaresCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('dual-writes legacy handles and coerces numeric fields', () => {
    const p = buildSquaresPayload(base) as Record<string, any>;
    expect(p.venmo).toBe('@me');
    expect(p.paymentHandles.venmo).toBe('@me');
    expect(p.maxSquaresPerPlayer).toBe(5);
  });
});
