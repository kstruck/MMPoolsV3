// @vitest-environment jsdom
//
// (Opt-in, same convention as pickDistributionScope.test.tsx — the repo default is node.)
/**
 * CURRENT PICKS GRID — the W-L and Max columns (PLAN-SPLIT-POT-SETTLEMENT Part B).
 *
 * `picksGridMax.test.ts` pins the arithmetic. This pins the part a pure test
 * cannot: that the grid renders the two headers, puts each value under the right
 * one, and prints "?" — not a guess — where the answer is not known.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('../services/dbService', () => ({
  dbService: { subscribeToPoolConsensus: () => () => {} },
}));

import { NFLPicksGrid } from '../components/NFLPoolDashboard/NFLPicksGrid';

afterEach(cleanup);

const team = (abbreviation: string) => ({ id: abbreviation, name: abbreviation, abbreviation });
const GAMES = [
  // g1 is over: KC (away) 24, BAL (home) 20.
  { id: 'g1', week: 3, seasonType: 2, startTime: 1, status: 'FINAL', awayTeam: team('KC'), homeTeam: team('BAL'), scores: { home: 20, away: 24 } },
  { id: 'g2', week: 3, seasonType: 2, startTime: 2, status: 'SCHEDULED', awayTeam: team('BUF'), homeTeam: team('MIA') },
] as never[];
const POOL = { id: 'p1', type: 'NFL_PICKEM', seasonType: 2, settings: {} } as never;

const ENTRIES = [
  { id: 'me', ownerUid: 'me', userName: 'Me Myself', picks: { g1: 'KC', g2: 'MIA' } },
  { id: 'u2', ownerUid: 'u2', userName: 'Sam Sample', picks: { g1: 'BAL' } },
  { id: 'u3', ownerUid: 'u3', userName: 'Lee Longname', picks: {} },
];
// g1 is revealed to everyone; g2 has not kicked off. Sam saved 2 picks (one of
// them the hidden g2); nothing is known about Lee's count.
const REVEAL = { week: 3, mode: 'PER_GAME', revealedGameIds: ['g1'], counts: { u2: 2 }, progress: { complete: 1, total: 3 } } as never;

function renderGrid(over: { reveal?: unknown } = {}) {
  return render(
    <MemoryRouter>
      <NFLPicksGrid
        pool={POOL}
        entries={ENTRIES}
        games={GAMES}
        week={3}
        viewerUid="me"
        reveal={(over.reveal === undefined ? REVEAL : over.reveal) as never}
        ownEntryLoaded
      />
    </MemoryRouter>,
  );
}

const cellsOf = (container: HTMLElement, name: string): string[] => {
  const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(name));
  expect(row, `row for ${name}`).toBeTruthy();
  return [...row!.querySelectorAll('td')].map(td => td.textContent ?? '');
};

describe('NFLPicksGrid — W-L and Max', () => {
  it('has the two headers after Week Pts and before the games', () => {
    const { container } = renderGrid();
    const heads = [...container.querySelectorAll('thead th')].map(th => th.textContent);
    // Kevin, 2026-11-19: "Set" was replaced by "Pts Left".
    expect(heads.slice(0, 5)).toEqual(['Player', 'Pts Left', 'Week Pts', 'W-L', 'Max']);
    expect(heads.slice(5)).toEqual(['KC/BAL', 'BUF/MIA']);
  });

  it("the viewer's own row: 1-0 and Max 2 (one win banked, one game still to play)", () => {
    const { container } = renderGrid();
    const c = cellsOf(container, 'Me Myself');
    expect(c[3]).toBe('1-0');
    expect(c[4]).toBe('2');
  });

  it("another player's row: the revealed loss counts, and the unrevealed pick is priced from their Set count", () => {
    const { container } = renderGrid();
    const c = cellsOf(container, 'Sam Sample');
    expect(c[3]).toBe('0-1');
    expect(c[4]).toBe('1');                        // 0 earned + (2 saved - 1 revealed)
  });

  it('a player whose Set count is unknown reads "?" under Max, with the reason in the tooltip', () => {
    const { container } = renderGrid();
    expect(cellsOf(container, 'Lee Longname')[4]).toBe('?');
    const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes('Lee Longname'))!;
    const maxCell = row.querySelectorAll('td')[4];
    expect(maxCell.getAttribute('title')).toBe('Not known yet');
  });

  it('before the reveal arrives every other row is "?" and the viewer still has their own numbers', () => {
    const { container } = renderGrid({ reveal: null });
    expect(cellsOf(container, 'Sam Sample')[4]).toBe('?');
    expect(cellsOf(container, 'Me Myself')[4]).toBe('2');
  });

  // PTS LEFT = points on games not yet decided, from the same tally as Max (Kevin, 2026-11-19).
  it("Pts Left: the viewer's own row has 1 left — the won game is banked, one game still to play", () => {
    const { container } = renderGrid();
    expect(cellsOf(container, 'Me Myself')[1]).toBe('1');
  });

  it("Pts Left: another player's unrevealed pick still counts as 1 point left (standard scoring)", () => {
    const { container } = renderGrid();
    expect(cellsOf(container, 'Sam Sample')[1]).toBe('1');
  });

  it('Pts Left reads "?" — never a guess — when the count is unknown, with the reason in the tooltip', () => {
    const { container } = renderGrid();
    expect(cellsOf(container, 'Lee Longname')[1]).toBe('?');
    const row = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes('Lee Longname'))!;
    expect(row.querySelectorAll('td')[1].getAttribute('title')).toBe('Not known yet');
  });

  it('Pts Left in a confidence pool is the sum of the weights still in play (5 + 6 = 11)', () => {
    const games = [
      { id: 'c1', week: 3, seasonType: 2, startTime: 1, status: 'FINAL', awayTeam: team('KC'), homeTeam: team('BAL'), scores: { home: 20, away: 24 } },
      { id: 'c2', week: 3, seasonType: 2, startTime: 2, status: 'IN_PROGRESS', awayTeam: team('BUF'), homeTeam: team('MIA') },
      { id: 'c3', week: 3, seasonType: 2, startTime: 3, status: 'SCHEDULED', awayTeam: team('SF'), homeTeam: team('DAL') },
    ] as never[];
    const { container } = render(
      <MemoryRouter>
        <NFLPicksGrid
          pool={{ id: 'p1', type: 'NFL_PICKEM', seasonType: 2, settings: { confidenceMode: true } } as never}
          entries={[{ id: 'me', ownerUid: 'me', userName: 'Me Myself', picks: { c1: 'KC', c2: 'BUF', c3: 'SF' }, confidence: { c1: 9, c2: 5, c3: 6 } }]}
          games={games}
          week={3}
          viewerUid="me"
          reveal={null}
          ownEntryLoaded
        />
      </MemoryRouter>,
    );
    const c = cellsOf(container, 'Me Myself');
    expect(c[1]).toBe('11');   // c2 (5) + c3 (6) still in play; c1's 9 is already won
    expect(c[4]).toBe('20');   // Max = 9 earned + 11 left
  });

  it('the Majority row keeps a placeholder under each new column, so the game cells do not shift', () => {
    const { container } = renderGrid();
    const rows = [...container.querySelectorAll('tbody tr')];
    const majority = rows[rows.length - 1].querySelectorAll('td');
    expect(rows[rows.length - 1].textContent).toContain('Majority');
    expect(majority.length).toBe(5 + GAMES.length);
  });
});
