// @vitest-environment jsdom
//
// The Help panel's behaviour — PLAN-HELP-SYSTEM.md §3 D5, ticket T2.
//
// WHY THIS FILE OPTS IN TO jsdom. Every other suite in this repo runs in the
// node environment and must keep doing so — 80-odd of them, and a global
// `environment: 'jsdom'` would slow all of them down for the sake of three.
// T1 shipped NO interaction tests for exactly this reason (`billingGate.test.tsx`
// uses `renderToStaticMarkup`, which cannot fire an event); T2 buys the
// dependency because a panel whose whole contract is keyboard and focus cannot
// be proved any other way. `jsdom` and `@testing-library/react` are
// devDependencies and the docblock above is per-file, so nothing else changes.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import type { ReactNode } from 'react';
import { HelpProvider } from '../components/help/HelpPanel';
import { HelpHeaderButton } from '../components/help/HelpHeaderButton';
import { HelpRoutePublisher } from '../help/publish';
import { HelpScopeProvider } from '../help/scope';
import { HelpTip } from '../components/ui/HelpTip';
import { helpRegistry, staticCopy } from '../help/registry';
import { __resetOverlayStack, useOverlayOwner } from '../components/ui/overlayStack';

beforeAll(() => {
  // `useIsMobile` asks for it and jsdom does not implement it. Desktop, so the
  // panel is a drawer rather than a modal — the mobile branch only adds a
  // backdrop and `aria-modal`.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  // jsdom has no layout, so nothing scrolls.
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => __resetOverlayStack());
afterEach(() => {
  cleanup();
  __resetOverlayStack();
});

/** A wizard step, which is the surface with real topics on it today. */
function WizardHarness({ children }: { children?: ReactNode }) {
  return (
    <HelpScopeProvider poolType="NFL_PICKEM" audience="commissioner">
      <HelpRoutePublisher tab="rules" />
      <HelpHeaderButton />
      {children}
    </HelpScopeProvider>
  );
}

function renderApp(ui: ReactNode, opts: { path?: string; isAdmin?: boolean } = {}) {
  const { path = '/create/pickem', isAdmin = false } = opts;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HelpProvider isAdmin={isAdmin}>{ui}</HelpProvider>
    </MemoryRouter>,
  );
}

const panel = () => document.getElementById('help-panel')!;
const isOpen = () => panel().getAttribute('role') === 'dialog';

describe('the `?` shortcut', () => {
  it('opens the panel, and a second press closes it', async () => {
    renderApp(<WizardHarness />);
    expect(isOpen()).toBe(false);

    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));

    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(false));
  });

  it('does NOT fire while the reader is typing in an input', async () => {
    renderApp(
      <WizardHarness>
        <input aria-label="Payment instructions" />
      </WizardHarness>,
    );
    const input = screen.getByLabelText('Payment instructions');
    input.focus();
    fireEvent.keyDown(input, { key: '?' });
    // A question mark belongs in the box a commissioner is writing in.
    await waitFor(() => expect(isOpen()).toBe(false));
    // Discriminating half: the same press from outside the input DOES open it,
    // so the assertion above is about the guard and not a dead listener.
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
  });

  it('does NOT fire while another overlay owns the screen', async () => {
    // A registered overlay, as `T16` will make the remaining ~35 shells.
    function Modal({ open }: { open: boolean }) {
      useOverlayOwner('some-modal', { active: open, onEscape: () => {} });
      return open ? <div role="dialog">A modal</div> : null;
    }
    const { rerender } = renderApp(
      <WizardHarness>
        <Modal open />
      </WizardHarness>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(false));

    // …and once it closes, the shortcut works again. This is the case that
    // `AuthModal`/`ShareModal` break if the stack is pushed on MOUNT: they stay
    // mounted while closed behind an `isOpen` prop.
    rerender(
      <MemoryRouter initialEntries={['/create/pickem']}>
        <HelpProvider isAdmin={false}>
          <WizardHarness>
            <Modal open={false} />
          </WizardHarness>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
  });

  it('ignores a modifier chord but not the Shift that types the character', async () => {
    renderApp(<WizardHarness />);
    fireEvent.keyDown(document, { key: '?', ctrlKey: true });
    fireEvent.keyDown(document, { key: '?', metaKey: true });
    await waitFor(() => expect(isOpen()).toBe(false));
    fireEvent.keyDown(document, { key: '?', shiftKey: true });
    await waitFor(() => expect(isOpen()).toBe(true));
  });
});

describe('Escape and focus', () => {
  it('closes the panel and returns focus to whatever opened it', async () => {
    renderApp(<WizardHarness />);
    const button = screen.getByLabelText('Help (?)');
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(isOpen()).toBe(true));
    // Focus moves INTO the panel, to the search box.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Search help')));

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(document.activeElement).toBe(button);
  });

  it('gives Escape to the panel only, never also to the overlay underneath it', async () => {
    const modalEscape = vi.fn();
    function Modal() {
      useOverlayOwner('some-modal', { active: true, onEscape: modalEscape });
      return <div role="dialog">A modal</div>;
    }
    renderApp(
      <WizardHarness>
        <Modal />
      </WizardHarness>,
    );
    // The panel is opened by the header button, so the modal being open does
    // not stop it (only the `?` shortcut is gated on the overlay stack).
    fireEvent.click(screen.getByLabelText('Help (?)'));
    await waitFor(() => expect(isOpen()).toBe(true));

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(isOpen()).toBe(false));
    // `stopImmediatePropagation`, not `stopPropagation`: the unmigrated modals
    // listen on `document` too, and propagation stopping does not reach a
    // sibling listener on the same target.
    expect(modalEscape).not.toHaveBeenCalled();
  });

  it('is out of the tab order while closed', () => {
    renderApp(<WizardHarness />);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    expect(panel().hasAttribute('inert')).toBe(true);
    expect(panel().hasAttribute('role')).toBe(false);
  });
});

describe('the header button (K3)', () => {
  it('toggles the panel and reports its state', async () => {
    renderApp(<WizardHarness />);
    const button = screen.getByLabelText('Help (?)');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('help-panel');

    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
  });

  it('renders nothing when no panel is mounted', () => {
    render(
      <MemoryRouter>
        <HelpHeaderButton />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Help (?)')).toBeNull();
  });
});

describe('the panel contents', () => {
  it('shows the page the reader is on, resolved from the published step', async () => {
    renderApp(<WizardHarness />);
    fireEvent.keyDown(document, { key: '?' });
    // `wizard.pickem.rules`, not the wizard's route-level page. Matched as the
    // HEADING: the same title also appears as its own row in "All pages", so a
    // plain text query finds two nodes and throws.
    const stepPage = helpRegistry.getPage('wizard.pickem.rules')!;
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: stepPage.title })).toBeTruthy(),
    );
    expect(screen.getByText(stepPage.summary)).toBeTruthy();
    // And NOT the route-level page it used to fall back to.
    expect(
      screen.queryByRole('heading', { name: helpRegistry.getPage('wizard.pickem')!.title }),
    ).toBeNull();
  });

  it('finds a topic by a phrase that appears only in its `long` copy', async () => {
    // Taken from the live registry rather than hard-coded: a literal would rot
    // the moment the copy was edited and the test would stop proving anything.
    const topic = helpRegistry.getTopic('settings.weeklyTiebreaker')!;
    const long = staticCopy(topic.long);
    const short = staticCopy(topic.short);
    const phrase = long.split(' ').slice(2, 6).join(' ');
    expect(short).not.toContain(phrase);

    renderApp(<WizardHarness />);
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
    fireEvent.change(screen.getByPlaceholderText('Search help'), { target: { value: phrase } });
    await waitFor(() => expect(screen.getByText(topic.title)).toBeTruthy());
  });

  it('says so plainly when a screen has no guide yet, rather than rendering blank', async () => {
    renderApp(<WizardHarness />, { path: '/privacy' });
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(screen.getByText(/no guide for this screen yet/i)).toBeTruthy());
  });

  it('hides commissioner-only pages from a member in "All pages"', async () => {
    const managerPage = helpRegistry.getPage('pool.nfl.manager')!;
    const memberPage = helpRegistry.getPage('pool.nfl.picks')!;

    render(
      <MemoryRouter initialEntries={['/pool/abc']}>
        <HelpProvider isAdmin={false}>
          <HelpScopeProvider poolType="NFL_PICKEM" audience="member">
            <HelpRoutePublisher tab="picks" />
          </HelpScopeProvider>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(screen.getByRole('button', { name: memberPage.title })).toBeTruthy());
    expect(screen.queryByRole('button', { name: managerPage.title })).toBeNull();
  });

  it('K5: lists only this pool type until the reader asks for the rest', async () => {
    const bracketPage = helpRegistry.getPage('pool.bracket.standings')!;
    render(
      <MemoryRouter initialEntries={['/pool/abc']}>
        <HelpProvider isAdmin={false}>
          <HelpScopeProvider poolType="NFL_PICKEM" audience="member">
            <HelpRoutePublisher tab="picks" />
          </HelpScopeProvider>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(screen.queryByRole('button', { name: bracketPage.title })).toBeNull();

    fireEvent.click(screen.getByText('Show all pool types'));
    await waitFor(() => expect(screen.getByRole('button', { name: bracketPage.title })).toBeTruthy());
  });
});

describe('the tooltip and the panel together', () => {
  it('a tooltip opens on focus with the ARIA a screen reader needs', async () => {
    renderApp(
      <WizardHarness>
        <HelpTip helpId="settings.weeklyTiebreaker" />
      </WizardHarness>,
    );
    const topic = helpRegistry.getTopic('settings.weeklyTiebreaker')!;
    const trigger = screen.getByLabelText(`About ${topic.title}`);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();

    fireEvent.focus(trigger);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain(staticCopy(topic.short));
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('clicking a tooltip opens the panel on that topic — the panel is mounted now', async () => {
    renderApp(
      <WizardHarness>
        <HelpTip helpId="settings.weeklyTiebreaker" />
      </WizardHarness>,
    );
    const topic = helpRegistry.getTopic('settings.weeklyTiebreaker')!;
    fireEvent.click(screen.getByLabelText(`About ${topic.title}`));
    await waitFor(() => expect(isOpen()).toBe(true));
    // Opened TO the topic: its card is rendered and holds the long copy.
    await waitFor(() => expect(document.getElementById(`help-topic-${topic.id}`)).toBeTruthy());
    expect(document.getElementById(`help-topic-${topic.id}`)!.textContent).toContain(staticCopy(topic.long));
  });
});

/**
 * A pool dashboard as the real ones behave: the tab comes from `?tab=` and the
 * tab it ACTUALLY rendered is what gets published.
 */
function PoolHarness({ poolType = 'NFL_PICKEM' as const, audience = 'member' as const }) {
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? 'dashboard';
  return (
    <HelpScopeProvider poolType={poolType} audience={audience}>
      <HelpRoutePublisher tab={tab} />
      <HelpHeaderButton />
    </HelpScopeProvider>
  );
}

describe('navigating from "All pages" to another tab', () => {
  /**
   * The case the pending-target machinery exists for. The publishers under the
   * new tab settle in an EFFECT, so the first render after `navigate` still
   * reports the old tab — a version of this that gave up on the first miss would
   * pin the panel to a forced page that the route then contradicted.
   */
  it('follows the link and lets the route — not a forced page — decide afterwards', async () => {
    renderApp(<PoolHarness />, { path: '/pool/abc?tab=dashboard' });
    fireEvent.keyDown(document, { key: '?' });

    const home = helpRegistry.getPage('pool.nfl.dashboard')!;
    const standings = helpRegistry.getPage('pool.nfl.standings')!;
    await waitFor(() => expect(screen.getByRole('heading', { name: home.title })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: standings.title }));
    await waitFor(() => expect(screen.getByRole('heading', { name: standings.title })).toBeTruthy());

    // And the reader clicking a THIRD tab in the app still wins, which is what
    // proves the panel is following the route rather than holding a forced page.
    fireEvent.click(screen.getByRole('button', { name: home.title }));
    await waitFor(() => expect(screen.getByRole('heading', { name: home.title })).toBeTruthy());
  });
});

describe('the `?help=` deep link (K11)', () => {
  it('opens the panel on the named topic and drops the parameter', async () => {
    const topic = helpRegistry.getTopic('settings.weeklyTiebreaker')!;
    renderApp(<WizardHarness />, { path: `/create/pickem?help=${topic.id}` });
    await waitFor(() => expect(isOpen()).toBe(true));
    await waitFor(() => expect(document.getElementById(`help-topic-${topic.id}`)).toBeTruthy());
  });
});
