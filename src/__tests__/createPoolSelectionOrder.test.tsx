// @vitest-environment jsdom
//
// (Opt-in, same convention as helpPanel.test.tsx and headerNav.test.tsx — the
// repo default is the node environment and must stay that way.)
/**
 * "Choose Your Game" — the order of the four active-pool cards (UI-1).
 *
 * Kevin's ruling: the NFL season-long games come first and Gameday Squares
 * moves last, so the desktop `md:grid-cols-2` grid reads
 *
 *     Weekly Pick'em   |  Survivor Pool
 *     Margin Pool      |  Gameday Squares
 *
 * WHY A RENDER TEST AND NOT A SOURCE SCAN. The thing Kevin sees is document
 * order in the browser, and a source-level `indexOf` check would pass on a
 * file where the cards were reordered in the source but re-sorted by CSS
 * (`order:`, `flex-direction: row-reverse`, a `.sort()` over a card array).
 * It would also pass on a card that renders to nothing. Reading the headings
 * back out of the rendered DOM is the only form of this assertion that is
 * about what actually paints.
 *
 * The four names are read from ONE query over the rendered container, so the
 * assertion is about their relative position in the document — not four
 * independent "is it present" checks that would hold in any order.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../contexts/ThemeContext';
import { CreatePoolSelection } from '../components/CreatePoolSelection';

// CreatePoolSelection renders the real <Header>, which imports authService for
// the "resend verification" strip — that pulls in src/firebase.ts and a live
// getAuth(). Irrelevant to card order; same mock headerNav.test.tsx uses.
vi.mock('../services/authService', () => ({
  authService: { resendVerification: vi.fn().mockResolvedValue(undefined) },
}));

/** Kevin's order, top-to-bottom in the DOM. */
const EXPECTED = ['Weekly Pick\'em', 'Survivor Pool', 'Margin Pool', 'Gameday Squares'];

const noop = () => {};

const renderSelection = () =>
  render(
    <MemoryRouter initialEntries={['/create']}>
      <ThemeProvider>
        <CreatePoolSelection
          onSelectSquares={noop}
          onSelectBracket={noop}
          onSelectPlayoff={noop}
          onSelectProps={noop}
          user={null}
          isManager={false}
          onOpenAuth={noop}
          onLogout={noop}
          onCreatePool={noop}
        />
      </ThemeProvider>
    </MemoryRouter>,
  );

/**
 * Every card heading in the "Active NFL & Gameday Pools" grid, in DOM order.
 *
 * One `querySelectorAll` over the whole rendered tree — `querySelectorAll`
 * returns document order, so the array IS the reading order. Filtered to the
 * four names because the page also renders h3s for Side Hustle and the two
 * offseason cards, which this ticket does not move.
 */
const cardHeadingsInDomOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('h3'))
    .map((h) => (h.textContent ?? '').trim())
    .filter((text) => EXPECTED.includes(text));

beforeAll(() => {
  // jsdom ships no matchMedia; ThemeProvider reads it for the OS preference.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('CreatePoolSelection — active pool card order', () => {
  it('finds all four cards — the filter is not silently dropping one', () => {
    // Without this, renaming a card heading would shrink the list and the
    // order assertion below would pass vacuously on three names, or two.
    const { container } = renderSelection();
    const found = cardHeadingsInDomOrder(container);
    expect(
      found.length,
      `expected the four active-pool headings ${JSON.stringify(EXPECTED)}, found ${JSON.stringify(found)}`,
    ).toBe(4);
  });

  it('renders Pick\'em, Survivor, Margin, then Gameday Squares — in that DOM order', () => {
    const { container } = renderSelection();
    expect(cardHeadingsInDomOrder(container)).toEqual(EXPECTED);
  });

  it('puts the two season-long NFL games on the desktop first row', () => {
    // Restates the ticket's *reason* in grid terms so the guard survives a
    // future card being inserted: the grid is `md:grid-cols-2`, so "first row"
    // means the first two cards. Squares must not climb back into it.
    const { container } = renderSelection();
    const [first, second] = cardHeadingsInDomOrder(container);
    expect([first, second]).toEqual(['Weekly Pick\'em', 'Survivor Pool']);
    expect(cardHeadingsInDomOrder(container).at(-1)).toBe('Gameday Squares');
  });
});
