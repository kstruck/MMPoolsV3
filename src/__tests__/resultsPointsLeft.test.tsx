// @vitest-environment jsdom
//
// (Opt-in, same convention as picksGridWlMax.test.tsx — the repo default is node.)
/**
 * WEEK RESULTS — the Pts Left and Games Wrong columns (Kevin, 2026-11-19).
 *
 * Members asked for the points each player can still win this week, and found
 * "No Points" unclear next to "Correct". Pts Left is the Current Picks grid's
 * own number (same cells, same tally), so this pins that the table shows it,
 * prints "?" rather than a guess, and carries the renamed header.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));

import { NFLResults } from '../components/NFLPoolDashboard/NFLResults';
// `?raw` — the grid renders through a heavier harness; its gate is pinned by source.
import gridSource from '../components/NFLPoolDashboard/NFLPicksGrid.tsx?raw';

afterEach(cleanup);

const team = (abbreviation: string) => ({ id: abbreviation, name: abbreviation, abbreviation });
const GAMES = [
  { id: 'c1', week: 3, seasonType: 2, startTime: 1, status: 'FINAL', awayTeam: team('KC'), homeTeam: team('BAL'), scores: { home: 20, away: 24 } },
  { id: 'c2', week: 3, seasonType: 2, startTime: 2, status: 'IN_PROGRESS', awayTeam: team('BUF'), homeTeam: team('MIA') },
  { id: 'c3', week: 3, seasonType: 2, startTime: 3, status: 'SCHEDULED', awayTeam: team('SF'), homeTeam: team('DAL') },
] as never[];

const ENTRIES = [
  // The viewer: c1 won at 9, c2 and c3 still in play at 5 and 6 → 11 left.
  { id: 'me', ownerUid: 'me', userName: 'Me Myself', picks: { c1: 'KC', c2: 'BUF', c3: 'SF' }, confidence: { c1: 9, c2: 5, c3: 6 },
    weeklyPoints: { 3: 9 }, weeklyResults: { 3: { correct: 1, total: 1 } } },
  // Another player, every pick revealed (a WEEK-mode reveal after the deadline).
  { id: 'u2', ownerUid: 'u2', userName: 'Sam Sample', picks: { c1: 'BAL', c2: 'MIA', c3: 'DAL' }, confidence: { c1: 4, c2: 3, c3: 2 },
    weeklyPoints: { 3: 0 }, weeklyResults: { 3: { correct: 0, total: 1 } } },
  // No reveal entry and no count: unknowable.
  { id: 'u3', ownerUid: 'u3', userName: 'Lee Longname', weeklyPoints: { 3: 0 }, weeklyResults: { 3: { correct: 0, total: 1 } } },
];

const REVEAL = {
  week: 3, mode: 'WEEK', revealedGameIds: ['c1', 'c2', 'c3'],
  picks: { u2: { c1: 'BAL', c2: 'MIA', c3: 'DAL' } }, confidence: { u2: { c1: 4, c2: 3, c3: 2 } },
  counts: { u2: 3 },
} as never;

function renderResults(confidenceMode = true, reveal: unknown = REVEAL) {
  return render(
    <MemoryRouter>
      <NFLResults
        pool={{ id: 'p1', type: 'NFL_PICKEM', seasonType: 2, settings: { confidenceMode } } as never}
        entries={ENTRIES}
        games={GAMES}
        week={3}
        viewerUid="me"
        reveal={reveal as never}
        ownEntryLoaded
        view="WEEKLY"
      />
    </MemoryRouter>,
  );
}

const cellsOf = (container: HTMLElement, name: string): string[] => {
  const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(name));
  expect(row, `row for ${name}`).toBeTruthy();
  return [...row!.querySelectorAll('td')].map(td => td.textContent ?? '');
};

describe('NFLResults — Week Results: Pts Left and Games Wrong', () => {
  it('headers: Pts Left after Points, and "Games Wrong" in place of "No Points"', () => {
    const { container } = renderResults();
    const heads = [...container.querySelectorAll('thead th')].map(th => th.textContent);
    expect(heads).toEqual(['Place', 'Player', 'Points', 'Pts Left', 'Max', 'Correct', 'Games Wrong']);
    expect(container.textContent).not.toContain('No Points');
  });

  it("the viewer's own row: 11 left (5 + 6 still in play), and Games Wrong is graded − correct", () => {
    const { container } = renderResults();
    const c = cellsOf(container, 'Me Myself');
    expect(c[3]).toBe('11');
    expect(c[6]).toBe('0');
  });

  it('a revealed player whose remaining picks are 3 and 2 has 5 left', () => {
    const { container } = renderResults();
    const c = cellsOf(container, 'Sam Sample');
    expect(c[3]).toBe('5');
    expect(c[6]).toBe('1');
  });

  it('every game revealed and no picks made: exactly 0 left, not a "?"', () => {
    const { container } = renderResults();
    expect(cellsOf(container, 'Lee Longname')[3]).toBe('0');
  });

  it('a game not revealed yet and no saved-pick count: "?" — never a guess', () => {
    const perGame = { week: 3, mode: 'PER_GAME', revealedGameIds: ['c1', 'c2'], picks: {}, confidence: {}, counts: {} };
    const { container } = renderResults(true, perGame);
    const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes('Lee Longname'))!;
    expect(cellsOf(container, 'Lee Longname')[3]).toBe('?');
    expect(row.querySelectorAll('td')[3].getAttribute('title')).toBe('Not known yet');
    // ...while the viewer still sees their own number.
    expect(cellsOf(container, 'Me Myself')[3]).toBe('11');
  });

  it('a reveal for a different week is ignored, never applied to this slate', () => {
    const { container } = renderResults(true, { ...(REVEAL as object), week: 2 });
    expect(cellsOf(container, 'Sam Sample')[3]).toBe('?');
    expect(cellsOf(container, 'Me Myself')[3]).toBe('11');
  });

  it('standard scoring: one point per pick still in play', () => {
    const { container } = renderResults(false);
    expect(cellsOf(container, 'Me Myself')[3]).toBe('2');
  });
});

describe('NFLResults — Max is per player, and the server total fills hidden picks (Kevin, 2026-11-23)', () => {
  // A PER_GAME week on Sunday: c1 final, c2 live, c3 not kicked off — so c3 is
  // hidden from the viewer on every other row.
  const SUNDAY = {
    week: 3, mode: 'PER_GAME', revealedGameIds: ['c1', 'c2'],
    picks: { u2: { c1: 'BAL', c2: 'MIA' } }, confidence: { u2: { c1: 4, c2: 3 } },
    counts: { u2: 3 },
  };

  it("Max is that player's own points plus Pts Left, not the week's ceiling", () => {
    const { container } = renderResults();
    // Me: won 9, 11 left → 20. Sam: won 0 (c1 lost), 5 left → 5. Lee: nothing → 0.
    expect(cellsOf(container, 'Me Myself')[4]).toBe('20');
    expect(cellsOf(container, 'Sam Sample')[4]).toBe('5');
    expect(cellsOf(container, 'Lee Longname')[4]).toBe('0');
  });

  it('before the server total exists, a hidden open pick reads "?" in Pts Left and Max', () => {
    const { container } = renderResults(true, SUNDAY);
    const c = cellsOf(container, 'Sam Sample');
    expect(c[3]).toBe('?');
    expect(c[4]).toBe('?');
  });

  it("with the server's total for the hidden picks, other players show real numbers", () => {
    // Sam's hidden c3 pick carries 2: 3 (c2, live) + 2 = 5 left; won 0 → Max 5.
    const { container } = renderResults(true, { ...SUNDAY, hiddenLeft: { u2: 2 }, hiddenLeftOpenGameIds: ['c2', 'c3'] });
    const c = cellsOf(container, 'Sam Sample');
    expect(c[3]).toBe('5');
    expect(c[4]).toBe('5');
    // The viewer's own row never needed it.
    expect(cellsOf(container, 'Me Myself')[3]).toBe('11');
    expect(cellsOf(container, 'Me Myself')[4]).toBe('20');
  });

  it("the commissioner's switch OFF hides the totals at once — the live pool setting wins over a cached reveal", () => {
    const { container } = render(
      <MemoryRouter>
        <NFLResults
          pool={{ id: 'p1', type: 'NFL_PICKEM', seasonType: 2, settings: { confidenceMode: true, shareHiddenPointsLeft: false } } as never}
          entries={ENTRIES} games={GAMES} week={3} viewerUid="me"
          reveal={{ ...SUNDAY, hiddenLeft: { u2: 2 }, hiddenLeftOpenGameIds: ['c2', 'c3'] } as never} ownEntryLoaded view="WEEKLY"
        />
      </MemoryRouter>,
    );
    expect(cellsOf(container, 'Sam Sample')[3]).toBe('?');
    expect(cellsOf(container, 'Me Myself')[3]).toBe('11');
  });

  it('the Current Picks grid applies the same live gate', () => {
    expect(gridSource).toContain('hiddenLeft: shareLeft && openAtFetch ? wk?.hiddenLeft?.[row.id] : undefined');
    expect(gridSource).toContain('const shareLeft = sharesHiddenPointsLeft(');
  });

  it('no games loaded for the week: a dash, never a Max of 0', () => {
    const { container } = render(
      <MemoryRouter>
        <NFLResults
          pool={{ id: 'p1', type: 'NFL_PICKEM', seasonType: 2, settings: { confidenceMode: true } } as never}
          entries={ENTRIES} games={[]} week={3} viewerUid="me"
          reveal={REVEAL} ownEntryLoaded view="WEEKLY"
        />
      </MemoryRouter>,
    );
    const c = cellsOf(container, 'Me Myself');
    expect(c[3]).toBe('—');
    expect(c[4]).toBe('—');
  });

  it('a row the server sent no total for still reads "?", never a guess', () => {
    const { container } = renderResults(true, { ...SUNDAY, hiddenLeft: {}, hiddenLeftOpenGameIds: ['c2', 'c3'] });
    expect(cellsOf(container, 'Sam Sample')[3]).toBe('?');
  });
});
