import { describe, it, expect } from 'vitest';
import { buildPropsPayload } from './buildPropsPayload';
import { propsCreateInputSchema } from '@shared/schemas';

const base: Record<string, unknown> = {
  type: 'PROPS', name: 'SB Props', isPublic: true,
  homeTeam: 'Chiefs', awayTeam: 'Eagles', theme: 'default',
  managerName: '', contactEmail: '',
  paymentHandles: { venmo: '@me', zelle: '', cashapp: '', paypal: '', googlePay: '' },
  paymentInstructions: '',
  branding: { logoUrl: '', primaryColor: '', secondaryColor: '' },
  props: {
    cost: 5, maxCards: 3,
    questions: [
      { text: 'Coin toss?', options: ['Heads', 'Tails'] },
      { text: '', options: ['', ''] }, // empty -> dropped
    ],
  },
};

describe('buildPropsPayload', () => {
  it('produces a PROPS payload passing the schema gate', () => {
    const p = buildPropsPayload(base) as Record<string, any>;
    expect(p.type).toBe('PROPS');
    expect(p.props.cost).toBe(5);
    expect(p.props.maxCards).toBe(3);
    expect(propsCreateInputSchema.safeParse(p).success).toBe(true);
  });

  it('drops empty questions and trims option lists', () => {
    const p = buildPropsPayload(base) as Record<string, any>;
    expect(p.props.questions.length).toBe(1);
    expect(p.props.questions[0].text).toBe('Coin toss?');
    expect(p.props.questions[0].options).toEqual(['Heads', 'Tails']);
  });

  it('dual-writes legacy handles', () => {
    const p = buildPropsPayload(base) as Record<string, any>;
    expect(p.venmo).toBe('@me');
    expect(p.paymentHandles.venmo).toBe('@me');
  });
});
