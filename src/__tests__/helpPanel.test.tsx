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
import { onCurrentRoute } from '../help/route-match';
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
    // A SYNTHETIC path, deliberately not a route this app has.
    //
    // This test stood on `/privacy` until T3 wrote that page, and then went red
    // without one thing about the empty state having changed. That is the tell
    // that it was measuring the wrong subject: the guard is for the PANEL's
    // no-page branch, and pointing it at whichever real screen currently lacks
    // help makes it a coverage assertion in disguise — one that fails, by
    // design, every time the content improves. Re-pointing it at another real
    // route (`/super-admin` is uncovered today, until T14) would buy one
    // ticket's grace and then break again for the same reason.
    //
    // The branch it guards stays reachable in the live app: any `App.tsx` route
    // the registry does not cover renders it, which is precisely what
    // `ROUTE_ALLOWLIST` exists to enumerate.
    const path = '/__a-screen-with-no-help-page__';

    // THE PREMISE, asserted rather than assumed. Without this the test would
    // still pass on the day some page started claiming this path — for the
    // wrong reason, and silently. `onCurrentRoute` is audience- and
    // pool-type-blind on purpose: no page may match this path for ANY reader.
    expect(helpRegistry.pages.filter((p) => onCurrentRoute(p, { pathname: path }))).toEqual([]);

    renderApp(<WizardHarness />, { path });
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(screen.getByText(/no guide for this screen yet/i)).toBeTruthy());
  });

  it('and does NOT say that on a screen that has one', async () => {
    // The discriminating half. The assertion above passes on a panel that
    // renders the empty state unconditionally; this is what stops it.
    renderApp(<WizardHarness />, { path: '/privacy' });
    fireEvent.keyDown(document, { key: '?' });
    const privacy = helpRegistry.getPage('site.privacy')!;
    await waitFor(() => expect(screen.getByRole('heading', { name: privacy.title })).toBeTruthy());
    expect(screen.queryByText(/no guide for this screen yet/i)).toBeNull();
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
    // LISTED, NOT LINKED (codex R7). The reader is standing in an NFL pool, so
    // there is nowhere to take them; forcing Bracket guidance onto an NFL screen
    // is worse than naming the page they could open from a Bracket pool.
    await waitFor(() => expect(screen.getByText(bracketPage.title)).toBeTruthy());
    expect(screen.queryByRole('button', { name: bracketPage.title })).toBeNull();
    // Discriminating half: a page for THIS pool type in the same list is a button.
    expect(screen.getByRole('button', { name: helpRegistry.getPage('pool.nfl.standings')!.title })).toBeTruthy();
  });
});

describe('a pool page listed from the create wizard (codex R12)', () => {
  it('is text, not a button — the wizard route cannot build a pool link', async () => {
    const picks = helpRegistry.getPage('pool.nfl.picks')!;
    renderApp(<WizardHarness />);
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));

    // Listed, because the wizard publishes NFL_PICKEM and the page is in scope…
    expect(screen.getByText(picks.title)).toBeTruthy();
    // …and not linked, because `/create/pickem?tab=picks` is not a pool.
    expect(screen.queryByRole('button', { name: picks.title })).toBeNull();
    // Discriminating: a page on THIS route is a button.
    expect(
      screen.getByRole('button', { name: helpRegistry.getPage('wizard.pickem.fee')!.title }),
    ).toBeTruthy();
  });
});

describe('a glossary search hit (codex R9)', () => {
  it('opens the definition it names, wherever the card lives', async () => {
    // A term NOT referenced by this page's topics, so its card sits inside the
    // collapsed "All terms" accordion — the case where clicking the result used
    // to clear the search and reveal nothing.
    const scope = { poolType: 'NFL_PICKEM', audience: 'commissioner' } as const;
    const onPage = new Set(
      helpRegistry
        .placementsForPage('wizard.pickem.rules', scope)
        .flatMap((s) => s.topics)
        .flatMap((t) => t.terms ?? []),
    );
    // Chosen so the query returns EXACTLY one hit, and that hit is this term:
    // searching a term's NAME can also match a topic ("User" matches the
    // manager-name topic), and clicking the wrong row would prove nothing.
    const picked = helpRegistry.glossary
      .filter((t) => !onPage.has(t.id) && t.long.length > 60)
      .map((t) => ({ term: t, query: t.long.slice(0, 45) }))
      .find(({ term, query }) => {
        const hits = helpRegistry.search(query, scope);
        return hits.length === 1 && hits[0].kind === 'glossary' && hits[0].id === term.id;
      });
    expect(picked).toBeDefined();
    const { term, query } = picked!;

    renderApp(<WizardHarness />);
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));

    // Collapsed to begin with — this term is not referenced by any topic on the
    // page, so its card sits inside the closed "All terms" accordion and its
    // long copy is not rendered at all.
    const longTail = (t: string) => t.slice(-45);
    expect(screen.queryByText(longTail(term.long), { exact: false })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search help'), { target: { value: query } });
    const hit = await waitFor(() => screen.getByText(term.term));
    fireEvent.click(hit.closest('button')!);

    // Matched on a TAIL of the long copy, not the whole string: only the long
    // form contains it (the card renders `short` above it either way), and
    // substring matching sidesteps whitespace normalisation in the fixture copy.
    await waitFor(() => expect(screen.getByText(longTail(term.long), { exact: false })).toBeTruthy());
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

describe('a tab this pool does not have (codex R3)', () => {
  // T10 deleted the Results page (its screen is a segment of Standings now), so
  // the conditional tab this exercises is the Current Picks grid, which a
  // signed-out reader does not get.
  it('is not listed in "All pages" without the tab, and is with it', async () => {
    const results = helpRegistry.getPage('pool.nfl.grid')!;

    render(
      <MemoryRouter initialEntries={['/pool/abc?tab=dashboard']}>
        <HelpProvider isAdmin={false}>
          <HelpScopeProvider poolType="NFL_SURVIVOR" audience="member">
            {/* What NFLPoolDashboard publishes for a signed-out reader. */}
            <HelpRoutePublisher
              tab="dashboard"
              offeredTabs={['dashboard', 'picks', 'standings', 'recaps', 'rules']}
            />
          </HelpScopeProvider>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(screen.queryByRole('button', { name: results.title })).toBeNull();
    cleanup();

    render(
      <MemoryRouter initialEntries={['/pool/abc?tab=dashboard']}>
        <HelpProvider isAdmin={false}>
          <HelpScopeProvider poolType="NFL_PICKEM" audience="member">
            <HelpRoutePublisher
              tab="dashboard"
              offeredTabs={['dashboard', 'picks', 'grid', 'standings', 'recaps', 'rules']}
            />
          </HelpScopeProvider>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(screen.getByRole('button', { name: results.title })).toBeTruthy());
  });
});

describe('search never offers a screen this pool has no tab for (codex R5)', () => {
  it('drops the All-picks page when the tab is absent, and keeps it when present', async () => {
    const results = helpRegistry.getPage('pool.nfl.grid')!;
    // A phrase from that page's own summary, so nothing else in the registry
    // matches it — which makes the negative half a clean "nothing found" rather
    // than an absence hidden among unrelated hits.
    const phrase = results.summary.split('.')[0];

    render(
      <MemoryRouter initialEntries={['/pool/abc?tab=dashboard']}>
        <HelpProvider isAdmin={false}>
          <HelpScopeProvider poolType="NFL_SURVIVOR" audience="member">
            <HelpRoutePublisher
              tab="dashboard"
              offeredTabs={['dashboard', 'picks', 'standings', 'recaps', 'rules']}
            />
          </HelpScopeProvider>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
    fireEvent.change(screen.getByPlaceholderText('Search help'), { target: { value: phrase } });
    await waitFor(() => expect(screen.getByText(/Nothing in Help matches/i)).toBeTruthy());
    expect(screen.queryByText(results.title)).toBeNull();
    cleanup();

    render(
      <MemoryRouter initialEntries={['/pool/abc?tab=dashboard']}>
        <HelpProvider isAdmin={false}>
          <HelpScopeProvider poolType="NFL_PICKEM" audience="member">
            <HelpRoutePublisher
              tab="dashboard"
              offeredTabs={['dashboard', 'picks', 'grid', 'standings', 'recaps', 'rules']}
            />
          </HelpScopeProvider>
        </HelpProvider>
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
    fireEvent.change(screen.getByPlaceholderText('Search help'), { target: { value: phrase } });
    await waitFor(() => expect(screen.getByText(results.title)).toBeTruthy());
  });
});

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

/**
 * Templated copy in the PANEL — the other half of `TopicScope.settings`.
 *
 * The tooltip and the panel read the same scope precisely so they cannot
 * disagree about one topic's copy. `helpTip.dom.test.tsx` proves the tooltip
 * half; without this one the panel could keep rendering the fallback beside a
 * tooltip rendering the branch, and the two would say different things about
 * the same setting on the same screen.
 */
describe('a template renders in the panel from the pool in scope', () => {
  const TOPIC = 'settings.weeklyTiebreaker';

  /** A Pick'em pool's rules tab, publishing the pool's settings like `PoolRoute`. */
  function PoolWithSettings({ settings }: { settings?: Record<string, unknown> }) {
    return (
      <HelpScopeProvider poolType="NFL_PICKEM" audience="member" settings={settings}>
        <HelpRoutePublisher tab="rules" />
        <HelpHeaderButton />
        <HelpTip helpId={TOPIC} />
      </HelpScopeProvider>
    );
  }

  const cardText = async () => {
    await waitFor(() => expect(document.getElementById(`help-topic-${TOPIC}`)).toBeTruthy());
    return document.getElementById(`help-topic-${TOPIC}`)!.textContent ?? '';
  };

  it('shows the pool’s own rule, not the four-rule fallback', async () => {
    renderApp(<PoolWithSettings settings={{ weeklyTiebreaker: 'NONE' }} />, { path: '/pool/abc?tab=rules' });
    fireEvent.click(screen.getByLabelText(`About ${helpRegistry.getTopic(TOPIC)!.title}`));
    await waitFor(() => expect(isOpen()).toBe(true));
    const text = await cardText();
    expect(text).toContain('shares that week outright');
    expect(text).not.toContain('A few older pools');
  });

  it('shows the four-rule fallback on the wizard, where no pool exists', async () => {
    renderApp(
      <WizardHarness>
        <HelpTip helpId={TOPIC} />
      </WizardHarness>,
    );
    fireEvent.click(screen.getByLabelText(`About ${helpRegistry.getTopic(TOPIC)!.title}`));
    await waitFor(() => expect(isOpen()).toBe(true));
    const text = await cardText();
    expect(text).toContain('A few older pools');
    expect(text).not.toContain('shares that week outright');
  });

  /**
   * THE DISCRIMINATING CASE. The tooltip and the panel are on screen at the
   * same time, reading one scope. If either stopped passing `settings` to
   * `resolveCopy`, one of them would show the fallback while the other showed
   * the branch — and the assertions above, taken one at a time, would not
   * notice.
   */
  it('the tooltip and the panel agree on which branch to show', async () => {
    renderApp(<PoolWithSettings settings={{ weeklyTiebreaker: 'MNF_FIRST_GAME' }} />, {
      path: '/pool/abc?tab=rules',
    });
    const trigger = screen.getByLabelText(`About ${helpRegistry.getTopic(TOPIC)!.title}`);
    fireEvent.focus(trigger);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('FIRST Monday game');

    fireEvent.click(trigger);
    await waitFor(() => expect(isOpen()).toBe(true));
    const text = await cardText();
    expect(text).toContain('first Monday game to kick off');
    expect(text).not.toContain('A few older pools');
  });
});
