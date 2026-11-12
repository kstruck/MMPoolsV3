// @vitest-environment jsdom
//
// WHY jsdom: what is under test is which answer a hook keeps when two searches
// overlap — state across renders, which only a rendered hook can show.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { ScheduleGame, ScheduleLeague } from '../services/espnSchedule';

const fetchGamesOn = vi.fn<(league: ScheduleLeague, date: string) => Promise<ScheduleGame[]>>();
// Only the network call is replaced; `hasStarted` is the real one.
vi.mock('../services/espnSchedule', async (original) => ({
  ...(await original<typeof import('../services/espnSchedule')>()),
  fetchGamesOn: (league: ScheduleLeague, date: string) => fetchGamesOn(league, date),
}));
// The server-corrected clock, which would otherwise reach for Firebase.
const serverNow = vi.fn<() => number>();
vi.mock('../utils/serverClock', () => ({ now: () => serverNow() }));

import { useScheduleSearch } from './useScheduleSearch';

afterEach(cleanup);
// Braces matter: a function RETURNED from beforeEach is run as its cleanup,
// and mockReset() returns the mock.
beforeEach(() => { fetchGamesOn.mockReset(); });

const game = (id: string, league: ScheduleLeague): ScheduleGame => ({
  id, league, kickoff: Date.UTC(2026, 10, 26, 18), homeTeam: 'Home', awayTeam: 'Away',
  homeAbbr: 'H', awayAbbr: 'A', homeLogo: '', awayLogo: '', state: 'pre',
});

/** A search whose answer the test releases when it chooses. */
function deferred() {
  let resolve!: (games: ScheduleGame[]) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ScheduleGame[]>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * THE LIST ON SCREEN IS ALWAYS THE ANSWER TO THE QUESTION ON SCREEN (qodo, PR
 * #760). If it is not, a commissioner clicks a game from one league while the
 * controls show another, and the pool is linked to a game the score feed
 * cannot find.
 */
describe('useScheduleSearch', () => {
  it('a search fills the list with what the feed returned for that league and day', async () => {
    fetchGamesOn.mockResolvedValue([game('1', 'nfl')]);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    act(() => result.current.setDate('2026-11-26'));
    await act(() => result.current.find());
    expect(fetchGamesOn).toHaveBeenCalledWith('nfl', '2026-11-26');
    expect(result.current.games?.map((g) => g.id)).toEqual(['1']);
    expect(result.current.loading).toBe(false);
  });

  it('changing the LEAGUE clears the list — NFL results are not left showing under "College"', async () => {
    fetchGamesOn.mockResolvedValue([game('1', 'nfl')]);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    await act(() => result.current.find());
    expect(result.current.games).toHaveLength(1);
    act(() => result.current.setLeague('college'));
    expect(result.current.games).toBeNull();
    expect(result.current.league).toBe('college');
  });

  it('changing the DATE clears the list too', async () => {
    fetchGamesOn.mockResolvedValue([game('1', 'nfl')]);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    await act(() => result.current.find());
    act(() => result.current.setDate('2026-12-25'));
    expect(result.current.games).toBeNull();
  });

  it('an answer that arrives after the league was changed is dropped', async () => {
    const slow = deferred();
    fetchGamesOn.mockReturnValueOnce(slow.promise);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    let pending!: Promise<void>;
    act(() => { pending = result.current.find(); });
    expect(result.current.loading).toBe(true);

    act(() => result.current.setLeague('college'));
    expect(result.current.loading).toBe(false);
    await act(async () => { slow.resolve([game('nfl-game', 'nfl')]); await pending; });

    expect(result.current.games).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('an OLDER search that finishes last does not replace the newer one\'s results', async () => {
    const first = deferred();
    const second = deferred();
    fetchGamesOn.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useScheduleSearch('nfl'));

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = result.current.find(); });
    act(() => result.current.setLeague('college'));
    act(() => { b = result.current.find(); });

    await act(async () => { second.resolve([game('college-game', 'college')]); await b; });
    expect(result.current.games?.map((g) => g.id)).toEqual(['college-game']);

    await act(async () => { first.resolve([game('nfl-game', 'nfl')]); await a; });
    expect(result.current.games?.map((g) => g.id)).toEqual(['college-game']);
    expect(result.current.games?.every((g) => g.league === 'college')).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('an old search FAILING late does not put an error over the newer results', async () => {
    const first = deferred();
    fetchGamesOn.mockReturnValueOnce(first.promise).mockResolvedValueOnce([game('2', 'nfl')]);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    let a!: Promise<void>;
    act(() => { a = result.current.find(); });
    act(() => result.current.setDate('2026-12-25'));
    await act(() => result.current.find());
    await act(async () => { first.reject(new Error('boom')); await a; });
    expect(result.current.error).toBeNull();
    expect(result.current.games?.map((g) => g.id)).toEqual(['2']);
  });

  it('a failed search says so, and shows no list', async () => {
    fetchGamesOn.mockRejectedValue(new Error('The schedule could not be loaded.'));
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    await act(() => result.current.find());
    expect(result.current.error).toBe('The schedule could not be loaded.');
    expect(result.current.games).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clear() forgets the list and any search still on its way', async () => {
    const slow = deferred();
    fetchGamesOn.mockReturnValueOnce(slow.promise);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    let pending!: Promise<void>;
    act(() => { pending = result.current.find(); });
    act(() => result.current.clear());
    await act(async () => { slow.resolve([game('1', 'nfl')]); await pending; });
    expect(result.current.games).toBeNull();
  });
});

describe('useScheduleSearch — "has it kicked off?" is asked of the server\'s clock', () => {
  const KICKOFF = Date.UTC(2026, 10, 26, 18);
  const pre = { state: 'pre' as const, kickoff: KICKOFF };

  it('a device clock that runs FAST does not grey out a game that has not started', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(KICKOFF + 10 * 60_000);      // the device says ten minutes past
      serverNow.mockReturnValue(KICKOFF - 60_000);   // the server says a minute to go
      const { result } = renderHook(() => useScheduleSearch('nfl'));
      expect(result.current.hasStarted(pre)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a device clock that runs SLOW does not offer a game that has', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(KICKOFF - 10 * 60_000);
      serverNow.mockReturnValue(KICKOFF + 1);
      const { result } = renderHook(() => useScheduleSearch('nfl'));
      expect(result.current.hasStarted(pre)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the feed saying the game is under way is enough, whatever any clock says', () => {
    serverNow.mockReturnValue(KICKOFF - 60 * 60_000);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    expect(result.current.hasStarted({ state: 'in', kickoff: KICKOFF })).toBe(true);
  });

  it('the clock is read each time it is asked, not once', () => {
    serverNow.mockReturnValue(KICKOFF - 1);
    const { result } = renderHook(() => useScheduleSearch('nfl'));
    expect(result.current.hasStarted(pre)).toBe(false);
    serverNow.mockReturnValue(KICKOFF);
    expect(result.current.hasStarted(pre)).toBe(true);
  });

  it('a clock handed in is the one used', () => {
    serverNow.mockReturnValue(0);
    const { result } = renderHook(() => useScheduleSearch('nfl', () => KICKOFF + 5));
    expect(result.current.hasStarted(pre)).toBe(true);
  });
});

