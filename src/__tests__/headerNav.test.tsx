// @vitest-environment jsdom
//
// (Opt-in, same convention as helpPanel.test.tsx — the repo default is node.)
/**
 * The 2026-08-27 grouped-nav redesign.
 *
 * The complaint was density: a signed-in commissioner saw thirteen equally
 * weighted top-level controls. The fix groups destinations behind two
 * disclosures and an account menu — and every plausible way to get that wrong
 * is worse than the busy bar it replaces, so each one is pinned here:
 *
 *   1. A destination that used to be one click away is now unreachable
 *      (grouped into a menu that never opens, or dropped outright).
 *   2. A label changed. `src/help/glossary.ts` tells readers a page is
 *      "Reached from Manage My Pools in the header"; renaming the control
 *      falsifies shipped help copy with no compile error.
 *   3. The primary action got tidied behind a disclosure.
 *   4. The disclosure is a `role="menu"` — which strips the link semantics
 *      that tests/a11y-invariants.test.ts exists to protect.
 *   5. Keyboard users get stuck in an open menu with no Escape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../contexts/ThemeContext';
import { Header } from '../components/Header';
import type { User } from '../types';

// The header imports authService for the "resend verification" strip, which
// pulls in src/firebase.ts and a live getAuth() — irrelevant to navigation.
vi.mock('../services/authService', () => ({
  authService: { resendVerification: vi.fn().mockResolvedValue(undefined) },
}));

const navigateSpy = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateSpy };
});

const member: User = {
  id: 'u1', name: 'Kevin Struck', email: 'k@example.com', role: 'USER',
  emailVerified: true, provider: 'password',
} as unknown as User;

const superAdmin = { ...member, role: 'SUPER_ADMIN' } as unknown as User;

const renderHeader = (user: User | null, isManager = false) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider>
        <Header
          user={user}
          isManager={isManager}
          onOpenAuth={() => {}}
          onLogout={() => {}}
          onCreatePool={() => {}}
        />
      </ThemeProvider>
    </MemoryRouter>,
  );

/** Open the disclosure whose trigger carries this accessible name. */
const openMenu = (name: RegExp) => {
  const trigger = screen.getByRole('button', { name });
  fireEvent.click(trigger);
  return trigger;
};

beforeEach(() => {
  navigateSpy.mockClear();
  // jsdom ships no matchMedia; ThemeProvider reads it for the OS preference.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('grouped header nav — nothing became unreachable', () => {
  it('a commissioner still reaches BOTH participant tabs, under their shipped labels', () => {
    renderHeader(member, /* isManager */ true);

    // Collapsed by default: the point of the redesign.
    expect(screen.queryByText('Manage My Pools')).toBeNull();

    openMenu(/^My Pools$/);

    // The labels are the assertion. src/help/glossary.ts documents these exact
    // strings as header controls — grouping them was allowed, renaming was not.
    const entries = screen.getByRole('link', { name: /My Entries/ });
    const manage = screen.getByRole('link', { name: /Manage My Pools/ });
    expect(entries.getAttribute('href')).toBe('/participant?tab=entries');
    expect(manage.getAttribute('href')).toBe('/participant?tab=commissioner');

    fireEvent.click(manage);
    expect(navigateSpy).toHaveBeenCalledWith('/participant?tab=commissioner');
  });

  it('a member who only PLAYS gets a flat link, not a one-item menu', () => {
    // A disclosure holding a single destination costs a click and buys nothing.
    renderHeader(member, /* isManager */ false);
    expect(screen.queryByRole('button', { name: /^My Pools$/ })).toBeNull();
    const entries = screen.getByRole('link', { name: /My Entries/ });
    expect(entries.getAttribute('href')).toBe('/participant?tab=entries');
  });

  it('Explore holds the three marketing pages and each one navigates', () => {
    renderHeader(member);
    openMenu(/^Explore$/);
    for (const [name, href] of [
      [/Public Pools/, '/browse'],
      [/How it Works/, '/how-it-works'],
      [/Pricing/, '/pricing'],
    ] as const) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
  });

  it('the account menu carries stats, profile, theme and log out', () => {
    renderHeader(member);
    expect(screen.queryByRole('link', { name: /My Stats/ })).toBeNull();
    openMenu(/Account menu/);
    expect(screen.getByRole('link', { name: /My Stats/ }).getAttribute('href')).toBe('/profile/u1');
    expect(screen.getByRole('link', { name: /My Profile/ }).getAttribute('href')).toBe('/profile');
    expect(screen.getByRole('button', { name: /Theme/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log Out/ })).toBeTruthy();
  });

  it('SuperAdmin lives in the account menu for an admin, and nowhere for a member', () => {
    renderHeader(superAdmin);
    openMenu(/Account menu/);
    expect(screen.getByRole('link', { name: /SuperAdmin/ }).getAttribute('href')).toBe('/super-admin');
    cleanup();

    renderHeader(member);
    openMenu(/Account menu/);
    expect(screen.queryByRole('link', { name: /SuperAdmin/ })).toBeNull();
  });

  it('signed-out keeps every page it had, with Features grouped under How it Works', () => {
    renderHeader(null);
    expect(screen.getByRole('link', { name: /Public Pools/ }).getAttribute('href')).toBe('/browse');
    expect(screen.getByRole('link', { name: /Pricing/ }).getAttribute('href')).toBe('/pricing');
    expect(screen.getByRole('link', { name: /Live Scores/ }).getAttribute('href')).toBe('/scoreboard');
    openMenu(/^How it Works$/);
    expect(screen.getByRole('link', { name: /Features/ }).getAttribute('href')).toBe('/features');
    expect(screen.getByRole('link', { name: /^How it Works/ }).getAttribute('href')).toBe('/how-it-works');
  });
});

describe('grouped header nav — the primary action stays out front', () => {
  it('Create a New Pool is visible without opening anything', () => {
    // Hiding the one revenue action to win a nav slot is the classic way a
    // "cleanup" costs conversions. It is never behind a disclosure.
    renderHeader(member);
    const create = screen.getByRole('button', { name: /Create a New Pool|Pool Creation Coming Soon/ });
    expect(create).toBeTruthy();
    // ...and it is not inside a collapsed panel.
    expect(create.closest('[id]')?.getAttribute('role')).not.toBe('menu');
  });

  it('Live Scores stays a flat, top-level link — it is time-critical', () => {
    renderHeader(member);
    expect(screen.getByRole('link', { name: /Live Scores/ }).getAttribute('href')).toBe('/scoreboard');
  });
});

describe('grouped header nav — disclosure semantics and keyboard', () => {
  it('is a disclosure over real links, NOT role="menu"', () => {
    // The APG reserves role="menu" for command menus. Applied to site nav it
    // strips link semantics — no "link" announcement, no open-in-new-tab — and
    // would hollow out tests/a11y-invariants.test.ts's <a href> guarantee.
    const { container } = renderHeader(member, true);
    openMenu(/^My Pools$/);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="menuitem"]')).toBeNull();
    expect(screen.getByRole('link', { name: /My Entries/ }).tagName).toBe('A');
  });

  it('the trigger reports its state and owns the panel it opens', () => {
    renderHeader(member, true);
    const trigger = screen.getByRole('button', { name: /^My Pools$/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panelId = trigger.getAttribute('aria-controls')!;
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId)!;
    expect(within(panel).getByRole('link', { name: /Manage My Pools/ })).toBeTruthy();
  });

  it('ArrowDown opens the menu and lands on the first destination', () => {
    renderHeader(member, true);
    const trigger = screen.getByRole('button', { name: /^My Pools$/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /My Entries/ }));
  });

  it('Escape closes the menu and hands focus back to the trigger', () => {
    // Without this a keyboard user is stranded in an open panel.
    renderHeader(member, true);
    const trigger = screen.getByRole('button', { name: /^My Pools$/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Manage My Pools/ })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a pointer press outside closes the menu', () => {
    renderHeader(member, true);
    const trigger = screen.getByRole('button', { name: /^My Pools$/ });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('only one disclosure is open at a time', () => {
    // Two panels overlapping is the "three stacked menus" complaint again.
    renderHeader(member, true);
    const pools = screen.getByRole('button', { name: /^My Pools$/ });
    fireEvent.click(pools);
    const explore = screen.getByRole('button', { name: /^Explore$/ });
    fireEvent.pointerDown(explore);
    fireEvent.click(explore);
    expect(pools.getAttribute('aria-expanded')).toBe('false');
    expect(explore.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('grouped header nav — mobile drawer', () => {
  it('one hamburger reveals every destination, in labelled sections and flat', () => {
    // Flat on purpose: an IA this shallow does not justify making a phone user
    // open a drawer AND then an accordion to reach one page.
    const { container } = renderHeader(superAdmin, true);
    const burger = screen.getByRole('button', { name: /Open menu/ });
    fireEvent.click(burger);

    const drawer = container.querySelector('.md\\:hidden.absolute')!;
    expect(drawer).toBeTruthy();
    const hrefs = Array.from(drawer.querySelectorAll('a')).map(a => a.getAttribute('href'));
    for (const href of [
      '/participant?tab=entries', '/participant?tab=commissioner', '/scoreboard',
      '/browse', '/how-it-works', '/pricing', '/profile/u1', '/profile', '/super-admin',
    ]) {
      expect(hrefs, `mobile drawer lost ${href}`).toContain(href);
    }
    expect(within(drawer as HTMLElement).getByRole('button', { name: /Log Out/ })).toBeTruthy();
  });
});
