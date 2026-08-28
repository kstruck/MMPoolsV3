// @vitest-environment jsdom
//
// (Opt-in, same convention as entrySwitcher.test.tsx — the repo default is node.)
/**
 * PICK DISTRIBUTION SCOPE TOGGLE — the card reads either the pool-scoped
 * aggregate (`pools/{id}/consensus`) or the Site-Wide one
 * (`consensus/{season}_{seasonType}_{week}/{poolType}`).
 *
 * Three things can go wrong here and only one of them is visible by eye:
 *
 *  1. The card reads the WRONG projection for the selected scope. A pool of one
 *     and a site of thousands look identical on a week where nobody has picked,
 *     so the split numbers are pinned against distinguishable fixtures.
 *  2. The site path claims "No picks yet" BEFORE its snapshot arrives. The
 *     pool path has a `loaded` discriminator and the site hook did not, which is
 *     why `useSiteConsensusState` exists — a card whose whole job is to state
 *     the split must never substitute a made-up 0 for data it does not have.
 *  3. The subscription unsubscribes on scope change. Both run at all times; a
 *     toggle must be instant, not a fresh round-trip showing "Loading picks…".
 */
// `@testing-library/jest-dom` is not installed in this repo (see
// overlayRoot.test.tsx), so attributes are read with `getAttribute` rather than
// `toHaveAttribute`.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

/** One row of either consensus projection (`projDoc`, functions/src/consensus.ts). */
type ProjectionRow = {
  gameId: string; away: number; home: number; total: number;
  awayPct: number | null; homePct: number | null;
};
type Projection = Record<string, ProjectionRow>;
type ConsensusCb = (byGame: Projection) => void;

// Hoisted so the dbService mock factory can reach them.
const h = vi.hoisted(() => ({
  poolCb: null as null | ((byGame: Record<string, unknown>) => void),
  siteCb: null as null | ((byGame: Record<string, unknown>) => void),
  siteArgs: [] as Array<[string, number, number, string]>,
  poolUnsub: vi.fn(),
  siteUnsub: vi.fn(),
}));

// `useSiteConsensus` reaches `utils/serverClock`, which pulls in src/firebase.ts
// and a live `getAuth()` — irrelevant to a display card, and it throws
// `auth/invalid-api-key` with no real config. Same stub as
// operationsPoolPasswordMigration.test.tsx.
vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));

vi.mock('../services/dbService', () => ({
  dbService: {
    subscribeToPoolConsensus: (_poolId: string, cb: (byGame: Record<string, unknown>) => void) => {
      h.poolCb = cb;
      return h.poolUnsub;
    },
    subscribeToSiteConsensus: (
      season: string, seasonType: number, week: number, poolType: string,
      cb: (byGame: Record<string, unknown>) => void,
    ) => {
      h.siteArgs.push([season, seasonType, week, poolType]);
      h.siteCb = cb;
      return h.siteUnsub;
    },
  },
}));

import { PickDistribution } from '../components/NFLPoolDashboard/PickDistribution';
import { stateForQuery } from '../components/NFLPoolDashboard/pickSheet/useSiteConsensus';

// Only the fields the card and the site hook actually read. Cast at the prop
// rather than typed `any`, so a future field the card starts depending on shows
// up here as a compile error instead of `undefined` at runtime.
const pool = { id: 'p1', type: 'NFL_PICKEM', season: '2026', seasonType: 2 };

const games = [{
  id: 'g1',
  week: 1,
  awayTeam: { abbreviation: 'NE', name: 'Patriots' },
  homeTeam: { abbreviation: 'SEA', name: 'Seahawks' },
}];

type CardProps = React.ComponentProps<typeof PickDistribution>;
const card = (week = 1) => (
  <PickDistribution
    pool={pool as unknown as CardProps['pool']}
    games={games as unknown as CardProps['games']}
    week={week}
  />
);

/** The projection shape both aggregates share (`projDoc`, functions/src/consensus.ts). */
const projection = (away: number, home: number): Projection => ({
  g1: { gameId: 'g1', away, home, total: away + home,
        awayPct: Math.round((away / (away + home)) * 100),
        homePct: 100 - Math.round((away / (away + home)) * 100) },
});

const deliverPool: ConsensusCb = (doc) => { act(() => { h.poolCb!(doc); }); };
const deliverSite: ConsensusCb = (doc) => { act(() => { h.siteCb!(doc); }); };

beforeEach(() => {
  h.poolCb = null; h.siteCb = null; h.siteArgs = [];
  h.poolUnsub.mockClear(); h.siteUnsub.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

describe('PickDistribution scope toggle', () => {
  it('defaults to the pool aggregate and shows the pool split', () => {
    render(card());
    // 3 away / 1 home = 75/25 in THIS pool.
    deliverPool(projection(3, 1));
    deliverSite(projection(1, 3));   // deliberately the mirror image

    expect(screen.getByRole('radio', { name: 'My Pool' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('4 picks')).toBeTruthy();
    expect(screen.getByText('NE 75%')).toBeTruthy();
  });

  it('switches to the site aggregate — a different projection, not the pool one', () => {
    render(card());
    deliverPool(projection(3, 1));
    deliverSite(projection(1, 3));

    fireEvent.click(screen.getByRole('radio', { name: 'Site' }));

    // 🛑 THE DEFECT THIS PINS. Reading the pool map under the site scope would
    // still render "NE 75%" here and look entirely correct.
    expect(screen.getByText('NE 25%')).toBeTruthy();
    expect(screen.queryByText('NE 75%')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Site' }).getAttribute('aria-checked')).toBe('true');
  });

  it('subscribes site-wide with the pool type, season and seasonType — never a bare week', () => {
    render(card(3));
    // A Pick'em pool must never be shown Survivor or Margin picks, and week 3 of
    // the PRESEASON is a different slate from week 3 of the regular season.
    expect(h.siteArgs[0]).toEqual(['2026', 2, 3, 'NFL_PICKEM']);
  });

  it('says "Loading picks…", NOT "No picks yet", before the site snapshot arrives', () => {
    render(card());
    deliverPool(projection(3, 1));   // pool loaded, site NOT

    fireEvent.click(screen.getByRole('radio', { name: 'Site' }));

    // 🛑 THE DEFECT THIS PINS. Before `useSiteConsensusState` carried `loaded`,
    // an un-delivered site snapshot was `{}` — indistinguishable from a week
    // nobody had picked — so this read "0 picks / No picks yet", which is a fact
    // the client does not have. Borrowing the POOL's `loaded` flag reintroduces
    // it exactly.
    expect(screen.getByText('Loading picks…')).toBeTruthy();
    expect(screen.queryByText('No picks yet')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('says "No picks yet" once the site snapshot arrives empty', () => {
    render(card());
    fireEvent.click(screen.getByRole('radio', { name: 'Site' }));
    deliverSite({});

    expect(screen.getByText('No picks yet')).toBeTruthy();
    expect(screen.getByText('0 picks')).toBeTruthy();
  });

  it('drops a site row with no picks rather than rendering it as 0%', () => {
    render(card());
    fireEvent.click(screen.getByRole('radio', { name: 'Site' }));
    // The recompute writes a row with `awayPct: null` when a game has no picks.
    deliverSite({ g1: { gameId: 'g1', away: 0, home: 0, total: 0, awayPct: null, homePct: null } });

    expect(screen.getByText('No picks yet')).toBeTruthy();
    expect(screen.queryByText(/NE 0%/)).toBeNull();
  });

  it('keeps both subscriptions live across a toggle — no re-subscribe, no flicker', () => {
    render(card());
    deliverPool(projection(3, 1));
    deliverSite(projection(1, 3));

    fireEvent.click(screen.getByRole('radio', { name: 'Site' }));
    fireEvent.click(screen.getByRole('radio', { name: 'My Pool' }));

    // One subscription each, and neither torn down: a toggle is a render, not a
    // round-trip. If the effects were scope-dependent this would be 2+ and the
    // reader would watch "Loading picks…" every time they switched.
    expect(h.siteArgs.length).toBe(1);
    expect(h.poolUnsub).not.toHaveBeenCalled();
    expect(h.siteUnsub).not.toHaveBeenCalled();
    expect(screen.getByText('NE 75%')).toBeTruthy();
  });

  it('remembers the scope across a remount, and tolerates unreadable storage', () => {
    const { unmount } = render(card());
    fireEvent.click(screen.getByRole('radio', { name: 'Site' }));
    unmount();

    render(card());
    expect(screen.getByRole('radio', { name: 'Site' }).getAttribute('aria-checked')).toBe('true');
    cleanup();

    // Private mode / blocked storage throws on read. The default is not a failure
    // state, so the card must still render rather than crash the dashboard.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    render(card());
    expect(screen.getByRole('radio', { name: 'My Pool' }).getAttribute('aria-checked')).toBe('true');
    getItem.mockRestore();
  });
});

describe('stateForQuery — the render-time invalidation', () => {
  const held = {
    key: '2026|2|1|NFL_PICKEM',
    byGame: { g1: { awayPct: 75, homePct: 25, total: 4 } },
    loaded: true,
  };

  it('returns the held state when it answers this exact query', () => {
    expect(stateForQuery(held, '2026|2|1|NFL_PICKEM')).toBe(held);
  });

  it('returns an EMPTY, UN-LOADED state the moment the week changes', () => {
    // 🛑 THE DEFECT THIS PINS (codex r2 P2). `useEffect` runs after paint, so
    // resetting `loaded` only inside the effect leaves one visible frame where
    // week 2's game ids are looked up in week 1's aggregate. Carrying `loaded:
    // true` into that frame turns "we have not asked yet" into "nobody picked" —
    // the exact substitute-for-unavailable-data the card exists to avoid.
    const next = stateForQuery(held, '2026|2|2|NFL_PICKEM');
    expect(next.loaded).toBe(false);
    expect(next.byGame).toEqual({});
    expect(next.key).toBe('2026|2|2|NFL_PICKEM');
  });

  it('invalidates on a season, seasonType or poolType change too, not only the week', () => {
    // Preseason week 1 and regular-season week 1 are different slates, and the
    // pool type selects a different projection entirely.
    expect(stateForQuery(held, '2026|1|1|NFL_PICKEM').loaded).toBe(false);
    expect(stateForQuery(held, '2025|2|1|NFL_PICKEM').loaded).toBe(false);
    expect(stateForQuery(held, '2026|2|1|NFL_SURVIVOR').loaded).toBe(false);
  });
});
