// @vitest-environment jsdom
//
// The squares admin page must not be torn down when the app's pool list changes.
//
// Kevin, 2026-11-17: on the squares setup wizard, step 2 ("Basics") threw him
// back to step 1 a few seconds after he got there. `AdminRoute` subscribed to
// the pool in an effect keyed on `[id, pools]`. `pools` is the app-wide list,
// and it gets a new identity whenever any pool the user can see changes —
// including this one, each time the commissioner's own edit saves. Every change
// re-ran the effect, the route rendered "Loading Pool...", the admin panel
// unmounted, and it came back at step 1.
//
// These tests stand in a counting stub for the admin panel and give the route a
// new pool list, as the app does after a save.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mounts: string[] = [];
const subscribe = vi.fn();
let emit: (pool: unknown) => void = () => {};

vi.mock('../services/dbService', () => ({
  dbService: {
    subscribeToPool: (id: string, cb: (pool: unknown) => void) => {
      subscribe(id);
      emit = cb;
      return () => {};
    },
    lockPool: vi.fn(),
  },
}));

vi.mock('../components/AdminPanel', () => ({
  AdminPanel: ({ gameState }: { gameState: { name?: string } }) => {
    useEffect(() => {
      mounts.push('mount');
    }, []);
    return <div data-testid="admin-panel">{gameState.name}</div>;
  },
}));
vi.mock('../components/Header', () => ({ Header: () => null }));
vi.mock('../components/Footer', () => ({ Footer: () => null }));
vi.mock('../components/modals', () => ({ ShareModal: () => null }));
vi.mock('../components/PropsPoolDashboard/PropsPoolDashboard', () => ({ PropsPoolDashboard: () => null }));
vi.mock('../components/PlayoffPool/PlayoffDashboard', () => ({ PlayoffDashboard: () => null }));
vi.mock('../components/BracketPoolDashboard/BracketPoolDashboard', () => ({ BracketPoolDashboard: () => null }));
vi.mock('../components/ui/Toast', () => ({ useToast: () => ({ info: vi.fn() }) }));

import { AdminRoute } from '../components/routes/AdminRoute';
import type { Pool, User } from '../types';

const OWNER = { id: 'owner-1' } as User;
const squaresPool = (name: string) =>
  ({ id: 'pool-1', type: 'SQUARES', name, ownerId: OWNER.id }) as unknown as Pool;

const route = (pools: Pool[]) => (
  <MemoryRouter initialEntries={['/admin/pool-1']}>
    <Routes>
      <Route
        path="/admin/:id"
        element={
          <AdminRoute
            user={OWNER}
            pools={pools}
            isSuperAdmin={false}
            onOpenAuth={() => {}}
            onLogout={() => {}}
            onCreatePool={() => {}}
            updatePool={async () => {}}
          />
        }
      />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  mounts.length = 0;
  subscribe.mockClear();
});
afterEach(cleanup);

describe('AdminRoute — a change to the pool list does not remount the admin panel', () => {
  it('keeps one subscription and one mounted panel across new pool lists', () => {
    const { rerender, getByTestId } = render(route([squaresPool('Before')]));
    act(() => emit(squaresPool('Before')));
    expect(getByTestId('admin-panel').textContent).toBe('Before');
    expect(mounts).toHaveLength(1);
    expect(subscribe).toHaveBeenCalledTimes(1);

    // The commissioner's edit saves: the subscription delivers it, and the
    // app-wide list arrives as a NEW array with the edited pool in it.
    act(() => emit(squaresPool('After')));
    rerender(route([squaresPool('After')]));
    // Any other pool the user can see changing does the same.
    rerender(route([squaresPool('After'), { id: 'other', type: 'NFL_PICKEM' } as unknown as Pool]));

    expect(getByTestId('admin-panel').textContent).toBe('After');
    expect(mounts).toHaveLength(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
