// @vitest-environment jsdom
//
// (Opt-in, same convention as pickDistributionScope.test.tsx — the repo default is node.)
/**
 * COMMISSIONER OVERVIEW ON A POOL THAT IS OVER.
 *
 * Measured live 2026-10-09 on a settled Survivor pool: the banner said "No more
 * picks can be made" while the Overview below it still showed a Week 5 pick
 * completion rate, eight "Pending Pick Sheets" with Nudge Email buttons, and
 * "Auto-reminders enabled". The server now refuses a PICKS reminder on such a
 * pool (`sendManualReminder`, POOL_OVER); this pins that the screen no longer
 * offers one, and that an OPEN pool is unchanged.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
// The main tab list, as source text: the card must name a tab that exists there.
import dashboardSource from '../components/NFLPoolDashboard/NFLPoolDashboard.tsx?raw';

vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));
// Every dbService call is a no-op; every `subscribe*` hands back an unsubscribe.
vi.mock('../services/dbService', () => ({
  dbService: new Proxy({}, { get: () => () => () => {} }),
}));
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), confirm: vi.fn(async () => false) }),
}));

import { NFLManagerBentoDashboard } from '../components/NFLPoolDashboard/NFLManagerBentoDashboard';

afterEach(cleanup);

const base = { id: 'p1', type: 'NFL_SURVIVOR', name: 'P', ownerId: 'o', seasonType: 2, participantIds: ['u1', 'u2'], settings: { entryFee: 25 } };
const members = [
  { uid: 'u1', userName: 'Pat', role: 'PARTICIPANT', paidStatus: 'PAID', joinedAt: 1 },
  { uid: 'u2', userName: 'Sam', role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: 1 },
];

function renderOverview(pool: Record<string, unknown>) {
  return render(
    <NFLManagerBentoDashboard
      pool={pool as never}
      entries={[]}
      members={members}
      games={[]}
      week={5}
      user={null}
      onSelectTab={() => {}}
    />,
  );
}

describe('NFLManagerBentoDashboard — a pool that is over', () => {
  it.each([
    ['settled', { status: 'COMPLETED', closedVia: 'SETTLED' }, 'Pool Over'],
    ['cancelled', { status: 'CANCELED' }, 'Pool Cancelled'],
    ['finalized', { finalizedAt: 1 }, 'Pool Over'],
  ])('a %s pool shows the ended card instead of the live pick tracker and the Nudge buttons', (_label, over, heading) => {
    const { container, queryByTestId } = renderOverview({ ...base, ...over });
    expect(queryByTestId('pool-over-card')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain(heading);
    expect(text).not.toContain('Submission Health');
    expect(text).not.toContain('Pending Pick Sheets');
    expect(text).not.toContain('Auto-reminders enabled');
    expect(text).not.toMatch(/Nudge/i);
  });

  it('points to a tab that really holds the results — Standings & Results, not the Scoring sub-tab (qodo #2 on #723)', () => {
    // A settled pool, as the server leaves it: the finalizer has stamped finalizedAt.
    const { container } = renderOverview({ ...base, status: 'COMPLETED', closedVia: 'SETTLED', finalizedAt: 1 });
    const text = container.textContent ?? '';
    expect(text).toContain('Standings & Results');
    expect(text).not.toMatch(/Scoring tab/i);
    // The name the card uses must be the label of a real main tab.
    expect(dashboardSource).toContain("{ tab: 'standings', label: 'Standings & Results' }");
  });

  it('a CANCELLED pool has no results, so the card does not send anyone to look for them (qodo on #724)', () => {
    const { container, queryByTestId } = renderOverview({ ...base, status: 'CANCELED' });
    const card = queryByTestId('pool-over-card')?.textContent ?? '';
    expect(card).toContain('Pool Cancelled');
    expect(card).toContain('It has no final results.');
    expect(card).not.toContain('Standings & Results');
    expect(card).toContain('Payment Ledger');
    // A cancelled pool that ALSO carries closedVia / lower-case status is still cancelled.
    cleanup();
    const again = renderOverview({ ...base, status: 'canceled', closedVia: 'CANCELLED' });
    expect(again.queryByTestId('pool-over-card')?.textContent).toContain('Pool Cancelled');
    expect(container).toBeTruthy();
  });

  it('promises results ONLY when the finalizer published them (finalizedAt) — every other ending makes no such promise (qodo on #724, round 2)', () => {
    // Ended WITHOUT a finalize: an admin close, a bare COMPLETED, an archive, an
    // unknown future closedVia. None may send the commissioner to look for results.
    const noResults = [
      { status: 'COMPLETED', closedVia: 'ADMIN_CLOSE' },
      { status: 'COMPLETED' },
      { status: 'ARCHIVED' },
      { status: 'OPEN', closedVia: 'SOMETHING_NEW' },
      { status: 'COMPLETED', closedVia: 'SETTLED' },            // settled record but no finalize stamp: still no promise
    ];
    for (const over of noResults) {
      const card = renderOverview({ ...base, ...over }).queryByTestId('pool-over-card')?.textContent ?? '';
      expect(card, JSON.stringify(over)).toContain('Pool Over');
      expect(card, JSON.stringify(over)).not.toContain('Standings & Results');
      expect(card, JSON.stringify(over)).not.toMatch(/final results/i);
      expect(card, JSON.stringify(over)).toContain('Payment Ledger');
      cleanup();
    }
    // Finalized by any route: the promise is made.
    for (const over of [{ finalizedAt: 1 }, { status: 'COMPLETED', closedVia: 'SETTLED', finalizedAt: { seconds: 1 } }]) {
      const card = renderOverview({ ...base, ...over }).queryByTestId('pool-over-card')?.textContent ?? '';
      expect(card, JSON.stringify(over)).toContain('The final results are under Standings & Results');
      cleanup();
    }
    // Cancelled wins over finalized: a cancelled pool never promises results.
    const cancelled = renderOverview({ ...base, status: 'CANCELED', finalizedAt: 1 }).queryByTestId('pool-over-card')?.textContent ?? '';
    expect(cancelled).toContain('It has no final results.');
    expect(cancelled).not.toContain('Standings & Results');
  });

  it('every sentence on the card is separated by a space — nothing runs together', () => {
    for (const over of [
      { status: 'COMPLETED', closedVia: 'SETTLED', finalizedAt: 1 },   // results message
      { status: 'COMPLETED', closedVia: 'ADMIN_CLOSE' },               // closed, no results
      { status: 'CANCELED' },                                          // cancelled
    ]) {
      const { queryByTestId } = renderOverview({ ...base, ...over });
      const card = queryByTestId('pool-over-card')?.textContent ?? '';
      // A full stop followed directly by a capital letter is two sentences joined.
      expect(card).not.toMatch(/[a-z]\.[A-Z]/);
      cleanup();
    }
  });

  it('keeps the money side: Buy-ins at a glance is still there', () => {
    const { container } = renderOverview({ ...base, status: 'COMPLETED', closedVia: 'SETTLED' });
    expect(container.textContent).toContain('Buy-ins at a glance');
  });

  it('an OPEN pool is unchanged: the pick tracker and Nudge buttons are shown', () => {
    const { container, queryByTestId } = renderOverview({ ...base, status: 'OPEN' });
    expect(queryByTestId('pool-over-card')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('Submission Health');
    expect(text).toContain('Pending Pick Sheets');
    expect(text).toMatch(/Nudge/i);
  });
});
