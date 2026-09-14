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
import { flushSync } from 'react-dom';
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

// 'MEMBER' is the canonical non-elevated role (src/utils/roles.ts) — it cannot
// create pools, so `canManage` is driven purely by the isManager prop here.
const member: User = {
  id: 'u1', name: 'Kevin Struck', email: 'k@example.com', role: 'MEMBER',
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

  it('Explore holds every marketing page, signed in as well as signed out', () => {
    // Parity, not just presence. `/features` used to be a signed-out-only door
    // — a signed-in member had NO header path to it at any width. Codex read
    // that asymmetry as this redesign dropping the route (it did not; see
    // `git show HEAD~2:src/components/Header.tsx`), and the honest answer to a
    // reviewer tripping over it twice is to remove the asymmetry.
    renderHeader(member);
    openMenu(/^Explore$/);
    for (const [name, href] of [
      [/Public Pools/, '/browse'],
      [/How it Works/, '/how-it-works'],
      [/Features/, '/features'],
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

  it('an ELEVATED role is still legible without opening anything; an ordinary one is not', () => {
    // 🛑 THE DEFECT THIS PINS. The first cut folded the whole "(ROLE)" suffix
    // into the account panel, and tests/e2e/admin-claims.spec.ts caught it by
    // timing out: it waits for the client to reflect SUPER_ADMIN before it
    // touches a claim-gated route, and there was no longer anything to wait
    // for. The e2e failure was the symptom; the real cost is that an admin
    // would have had to open a menu to learn they are holding elevated rights.
    // Dropping "(MEMBER)" was right — it told nobody anything. Dropping the
    // admin signal was not.
    renderHeader(superAdmin);
    expect(screen.getByText('SUPER_ADMIN')).toBeTruthy();
    cleanup();

    renderHeader(member); // MEMBER — no chip; the bar shows the name alone
    expect(screen.queryByText(/^(SUPER_ADMIN|MODERATOR)$/)).toBeNull();
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeTruthy();
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

describe('grouped header nav — the desktop row hands off to the drawer at lg, not md', () => {
  // 🛑 THE DEFECT THIS PINS (codex round 1, P1). The first cut handed off at
  // `md` (768px). Grouping shortened the row but did not shorten it THAT much:
  // logo + the signed-in action cluster leave under ~200px for three nav
  // items, and nothing in the new row wraps, so at 768–1023px the controls ran
  // off the side of the viewport — unreachable, with no hamburger to fall back
  // to. Handing off at `lg` is the whole fix, and it is invisible in jsdom
  // (no layout), so it is asserted as the class contract it actually is.
  it('exactly one of the two layouts is live at any width', () => {
    const { container } = renderHeader(superAdmin, true);
    const nav = container.querySelector('nav[aria-label="Main"]')!;
    const burger = screen.getByRole('button', { name: /Open menu/ });
    // Both halves of the desktop layout: the destinations (nav) AND the
    // action cluster that sits beside it. They must appear together.
    const actions = burger.closest('header')!.querySelector('div.hidden.items-center')!;
    expect(actions, 'desktop action cluster not found').toBeTruthy();
    expect(actions).not.toBe(nav);

    for (const el of [nav, actions]) {
      expect(el.className, 'desktop cluster must be hidden below lg').toContain('hidden');
      expect(el.className, 'desktop cluster must appear at lg, not md').toContain('lg:flex');
      expect(el.className).not.toContain('md:flex');
    }
    expect(burger.className, 'hamburger must survive until lg').toContain('lg:hidden');
    expect(burger.className).not.toContain('md:hidden');

    fireEvent.click(burger);
    const drawer = document.getElementById(burger.getAttribute('aria-controls')!)!;
    expect(drawer.className).toContain('lg:hidden');
    expect(drawer.className).not.toContain('md:hidden');
  });
});

describe('grouped header nav — mobile drawer', () => {
  it('one hamburger reveals every destination, in labelled sections and flat', () => {
    // Flat on purpose: an IA this shallow does not justify making a phone user
    // open a drawer AND then an accordion to reach one page.
    renderHeader(superAdmin, true);
    const burger = screen.getByRole('button', { name: /Open menu/ });
    fireEvent.click(burger);

    // The hamburger names the panel it controls, so the test addresses the
    // drawer the way a screen reader does rather than by a Tailwind class.
    const drawer = document.getElementById(burger.getAttribute('aria-controls')!)!;
    expect(drawer).toBeTruthy();
    const hrefs = Array.from(drawer.querySelectorAll('a')).map(a => a.getAttribute('href'));
    for (const href of [
      '/participant?tab=entries', '/participant?tab=commissioner', '/scoreboard',
      '/browse', '/how-it-works', '/features', '/pricing', '/profile/u1', '/profile', '/super-admin',
    ]) {
      expect(hrefs, `mobile drawer lost ${href}`).toContain(href);
    }
    expect(within(drawer as HTMLElement).getByRole('button', { name: /Log Out/ })).toBeTruthy();
  });
});

describe('menu ACTIONS fire even though the menu closes on the same click', () => {
  // 🛑 THE DEFECT THIS PINS (2026-09-14, multiple member reports: "Log In does
  // nothing on my phone", "Log Out does nothing" — desktop too). Both panels
  // closed themselves with an `onClickCapture` on the container. React flushes
  // that state update before the click reaches the item — measured in Chrome
  // against the dev server: by the time a native capture listener on the
  // drawer ITSELF ran, `document.body.contains(drawer)` was already false — so
  // the item's `onClick` was dispatched against an unmounted button and never
  // ran. Links survived because the browser still followed their `href` (as a
  // full page load, which is why nobody noticed for weeks); the BUTTONS — Log
  // In, Get Started, Log Out, theme — were dead.
  //
  // jsdom dispatches every listener back-to-back with no microtask checkpoint
  // between them, so `fireEvent.click` alone cannot reproduce the browser's
  // ordering and the tests above stayed green through the outage. The native
  // bubble listener below sits on the panel — between React's capture and
  // bubble listeners on the root — and flushes pending React work at that
  // point, which is exactly where the browser flushed it.
  const flushBetweenPhases = (panel: Element) =>
    panel.addEventListener('click', () => flushSync(() => {}));

  const renderWith = (user: User | null, handlers: { onOpenAuth?: (mode?: 'login' | 'register') => void; onLogout?: () => void }) =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <Header
            user={user}
            onOpenAuth={handlers.onOpenAuth ?? (() => {})}
            onLogout={handlers.onLogout ?? (() => {})}
            onCreatePool={() => {}}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

  const openDrawer = () => {
    const burger = screen.getByRole('button', { name: /Open menu/ });
    fireEvent.click(burger);
    const drawer = document.getElementById(burger.getAttribute('aria-controls')!)!;
    flushBetweenPhases(drawer);
    return { burger, drawer };
  };

  it('mobile drawer: Log In opens the auth modal in login mode, and the drawer closes', () => {
    const onOpenAuth = vi.fn();
    renderWith(null, { onOpenAuth });
    const { burger, drawer } = openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: /^Log In$/ }));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
    // `onClick={onOpenAuth}` handed the click EVENT to a `(mode) => void`, so
    // App stored a SyntheticEvent as the auth mode. Pass the mode explicitly.
    expect(onOpenAuth).toHaveBeenCalledWith('login');
    expect(burger.getAttribute('aria-expanded')).toBe('false');
  });

  it('mobile drawer: Get Started opens the auth modal in REGISTER mode', () => {
    const onOpenAuth = vi.fn();
    renderWith(null, { onOpenAuth });
    const { drawer } = openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: /Get Started/ }));
    expect(onOpenAuth).toHaveBeenCalledWith('register');
  });

  it('mobile drawer: Log Out signs the member out, and the drawer closes', () => {
    const onLogout = vi.fn();
    renderWith(member, { onLogout });
    const { burger, drawer } = openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: /Log Out/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(burger.getAttribute('aria-expanded')).toBe('false');
  });

  it('desktop account menu: Log Out signs the member out, and the menu closes', () => {
    const onLogout = vi.fn();
    renderWith(member, { onLogout });
    const trigger = openMenu(/Account menu/);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    flushBetweenPhases(panel);
    fireEvent.click(within(panel).getByRole('button', { name: /Log Out/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('desktop signed-out row: Log In is login, Get Started is register', () => {
    const onOpenAuth = vi.fn();
    renderWith(null, { onOpenAuth });
    const row = document.querySelector('header div.hidden.items-center')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^Log In$/ }));
    expect(onOpenAuth).toHaveBeenLastCalledWith('login');
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Get Started/ }));
    expect(onOpenAuth).toHaveBeenLastCalledWith('register');
  });
});
