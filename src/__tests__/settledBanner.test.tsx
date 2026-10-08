/**
 * PLAN-SPLIT-POT-SETTLEMENT §2.4 — the settled-pool banner and the client
 * `poolIsOver` mirror.
 *
 * The banner is the only member-facing statement that "A and B split the pot",
 * so it must say exactly what the server record says: the winners, the week,
 * the amount ONLY when priced, the note when there is one — and nothing at all
 * when there is no settlement record.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettledBanner } from '../components/NFLPoolDashboard/SettledBanner';
import { poolIsOver } from '../utils/poolIsOver';
import type { PoolSettlement } from '@shared/settlement';

const base: PoolSettlement = {
  kind: 'SPLIT', entryIds: ['a', 'b'], winnerNames: ['Alex', 'Sam'], settledAt: 1, settledBy: 'h',
  note: null, throughWeek: 4, notifyMembers: true, prizePerEntry: 100, pot: 200, rebuyDuesExcluded: 0,
};
const html = (s: PoolSettlement | null | undefined) => renderToStaticMarkup(<SettledBanner settlement={s} />);

describe('SettledBanner', () => {
  it('renders nothing without a settlement record', () => {
    expect(html(undefined)).toBe('');
    expect(html(null)).toBe('');
  });

  it('names one, two and three winners in plain English', () => {
    expect(html({ ...base, winnerNames: ['Alex'] })).toContain('Alex agreed to split the pot');
    expect(html(base)).toContain('Alex and Sam agreed to split the pot after week 4');
    expect(html({ ...base, winnerNames: ['Alex', 'Sam', 'Kim'] })).toContain('Alex, Sam and Kim agreed');
  });

  it('states the amount only when the server priced it', () => {
    expect(html(base)).toContain('$100 each');
    expect(html({ ...base, prizePerEntry: null })).not.toContain('each');
  });

  it('shows the note only when there is one', () => {
    expect(html(base)).not.toContain('note');
    expect(html({ ...base, note: 'Paid by Venmo' })).toContain('Paid by Venmo');
  });

  it('omits the week when nothing was scored', () => {
    expect(html({ ...base, throughWeek: null })).not.toContain('after week');
  });
});

describe('poolIsOver (client mirror of the server POOL_OVER rule)', () => {
  it('is false for a live pool, including a FINAL status not yet finalized', () => {
    expect(poolIsOver({ status: 'OPEN' })).toBe(false);
    expect(poolIsOver({ status: 'FINAL' })).toBe(false);
  });
  it('is true for voided, closed or finalized pools', () => {
    for (const p of [{ status: 'CANCELED' }, { status: 'completed' }, { status: 'archived' },
      { status: 'OPEN', closedVia: 'SETTLED' }, { status: 'OPEN', finalizedAt: {} }, null]) {
      expect(poolIsOver(p)).toBe(true);
    }
  });
});
