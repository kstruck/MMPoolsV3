// @vitest-environment jsdom
/**
 * WEEK RESULTS when the server's hidden-points total is older than the game
 * statuses on screen. See `picksGridMaxStaleTotal.test.ts` for the rule; this
 * pins that the table actually passes the stamp through and prints "?", and
 * that the dashboard is the one that stamps it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));

import { NFLResults } from '../components/NFLPoolDashboard/NFLResults';
// `?raw`: the grid and the dashboard render through heavier harnesses.
import gridSource from '../components/NFLPoolDashboard/NFLPicksGrid.tsx?raw';
import resultsSource from '../components/NFLPoolDashboard/NFLResults.tsx?raw';
import dashboardSource from '../components/NFLPoolDashboard/NFLPoolDashboard.tsx?raw';

afterEach(cleanup);

const team = (abbreviation: string) => ({ id: abbreviation, name: abbreviation, abbreviation });
const slate = (c3Status: string) => [
  { id: 'c1', week: 3, seasonType: 2, startTime: 1, status: 'FINAL', awayTeam: team('KC'), homeTeam: team('BAL'), scores: { home: 20, away: 24 } },
  { id: 'c2', week: 3, seasonType: 2, startTime: 2, status: 'IN_PROGRESS', awayTeam: team('BUF'), homeTeam: team('MIA') },
  { id: 'c3', week: 3, seasonType: 2, startTime: 3, status: c3Status, awayTeam: team('SF'), homeTeam: team('DAL') },
] as never[];

const ENTRIES = [
  { id: 'me', ownerUid: 'me', userName: 'Me Myself', picks: { c1: 'KC', c2: 'BUF', c3: 'SF' }, confidence: { c1: 9, c2: 5, c3: 6 },
    weeklyPoints: { 3: 9 }, weeklyResults: { 3: { correct: 1, total: 1 } } },
  // Another player. The entry carries the picks, as the real pool document does;
  // the reveal decides which of them this viewer may see.
  { id: 'u2', ownerUid: 'u2', userName: 'Sam Sample', picks: { c1: 'BAL', c2: 'MIA', c3: 'DAL' }, confidence: { c1: 4, c2: 3, c3: 2 },
    weeklyPoints: { 3: 0 }, weeklyResults: { 3: { correct: 0, total: 1 } } },
];

/** A PER_GAME Sunday: c3 has not kicked off, so Sam's pick on it is hidden. Sam's hidden total is 2. */
const SUNDAY = {
  week: 3, mode: 'PER_GAME', revealedGameIds: ['c1', 'c2'],
  picks: { u2: { c1: 'BAL', c2: 'MIA' } }, confidence: { u2: { c1: 4, c2: 3 } },
  counts: { u2: 3 }, hiddenLeft: { u2: 2 },
};

function renderResults(games: never[], reveal: unknown) {
  return render(
    <MemoryRouter>
      <NFLResults
        pool={{ id: 'p1', type: 'NFL_PICKEM', seasonType: 2, settings: { confidenceMode: true } } as never}
        entries={ENTRIES} games={games} week={3} viewerUid="me"
        reveal={reveal as never} ownEntryLoaded view="WEEKLY"
      />
    </MemoryRouter>,
  );
}
const cellsOf = (container: HTMLElement, name: string): string[] => {
  const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(name));
  expect(row, `row for ${name}`).toBeTruthy();
  return [...row!.querySelectorAll('td')].map(td => td.textContent ?? '');
};

describe('NFLResults — a hidden game is decided after the total was fetched', () => {
  it('control: nothing has changed since the fetch, so the total is shown', () => {
    // c2 and c3 were open at fetch and still are. 3 (c2, live) + 2 (hidden) = 5.
    const { container } = renderResults(slate('SCHEDULED'), { ...SUNDAY, hiddenLeftOpenGameIds: ['c2', 'c3'] });
    expect(cellsOf(container, 'Sam Sample')[3]).toBe('5');
  });

  it('c3 is cancelled while the old total is still in hand: Pts Left reads "?"', () => {
    // The total (2) was computed when c3 was open, so it may be Sam's c3 weight.
    const { container } = renderResults(slate('CANCELLED'), { ...SUNDAY, hiddenLeftOpenGameIds: ['c2', 'c3'] });
    const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes('Sam Sample'))!;
    expect(cellsOf(container, 'Sam Sample')[3]).toBe('?');
    expect(row.querySelectorAll('td')[3].getAttribute('title')).toMatch(/since these points were last checked/);
    // The viewer's own row is unaffected: c2 only (the cancelled c3 is not left).
    expect(cellsOf(container, 'Me Myself')[3]).toBe('5');
  });

  it('an UNSTAMPED total is withheld: the row is worked out as if no total had been sent', () => {
    // The first request of a page load can leave before the schedule has
    // loaded, so its total has no stamp (qodo on #805). With nothing to check
    // it against, the total is not used at all, and the dashboard fetches again
    // for a stamped one (`needsStampedRefetch`).
    //
    // c3 still open: Sam has one unrevealed pick that may sit on it, with a
    // weight nobody can see → "?". The withheld total (2) would have given 5.
    const open = renderResults(slate('SCHEDULED'), SUNDAY);
    expect(cellsOf(open.container, 'Sam Sample')[3]).toBe('?');
    cleanup();
    // c3 cancelled: no hidden game is open, so nothing hidden can be points
    // left and the page knows the exact answer WITHOUT the total — 3, c2 only.
    // The withheld total still counted c3 and would have printed 5: the wrong
    // number this whole change is about.
    const cancelled = renderResults(slate('CANCELLED'), SUNDAY);
    expect(cellsOf(cancelled.container, 'Sam Sample')[3]).toBe('3');
  });

  it('the next poll clears it: a total fetched after the cancel is shown again', () => {
    const { container } = renderResults(slate('CANCELLED'), { ...SUNDAY, hiddenLeft: { u2: 0 }, hiddenLeftOpenGameIds: ['c2'] });
    expect(cellsOf(container, 'Sam Sample')[3]).toBe('3');
  });
});

describe('the stamp is wired end to end', () => {
  it('both tables pass it to the tally', () => {
    for (const source of [resultsSource, gridSource]) {
      expect(source).toContain('const openAtFetch = wk?.hiddenLeftOpenGameIds ? new Set(wk.hiddenLeftOpenGameIds) : undefined;');
      expect(source).toContain('hiddenLeftOpenAtFetch: openAtFetch,');
      // No stamp, no total.
      expect(source).toContain('hiddenLeft: shareLeft && openAtFetch ? wk?.hiddenLeft?.[row.id] : undefined,');
    }
  });

  it('the dashboard fetches every reveal through fetchStampedReveal, from the latest schedule', () => {
    // A WIRING pin on source, and only that: the dashboard needs a harness this
    // repo does not have. What the stamp does, and that it is taken before the
    // request, is tested for real in `picksGridMaxStaleTotal.test.ts`.
    //
    // Line comments are dropped first, so prose that happens to contain these
    // strings cannot satisfy the pin.
    const code = dashboardSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(code).toContain('fetchStampedReveal<PoolPicksReveal>(() => dbService.getPoolPicks(pool.id, w), gamesRef.current)');
    // The ref follows `games`; a ref that is never written would stamp the
    // empty first-render schedule forever, i.e. never stamp at all.
    expect(code).toContain('useEffect(() => { gamesRef.current = games; }, [games]);');
    // No path fetches a reveal without the stamp, and the stamped object is
    // what is stored, in both branches of the update.
    expect(code.match(/dbService\.getPoolPicks\(/g) ?? []).toHaveLength(1);
    expect(code.match(/\[w\]: stamped/g) ?? []).toHaveLength(2);
    // And it fetches again when the first response beat the schedule.
    expect(code).toContain('if (needsStampedRefetch(selectedWeekReveal, scheduleLoaded)) loadWeek(selectedWeek);');
    expect(code).toContain('const scheduleLoaded = games.length > 0;');
  });
});
