// @vitest-environment jsdom
//
// A diverted Help target must be DROPPED, not remembered — qodo #1 on PR #477.
//
// `goToPage` stores a pending target before navigating, because the publishers
// under the new route settle in an effect and the first render after `navigate`
// still reports the old tab. Consuming it on the first miss was wrong (fixed on
// self-review) — but the version that replaced it never dropped a target that
// MISSED either: the release effect skipped its cleanup whenever a pending target
// existed, and nothing else cleared one. A target the reader had navigated away
// from therefore survived for the rest of the session and fired the next time
// that page happened to resolve.
//
// Latent rather than live in T2 — no pool page carries a topic yet, so the only
// pending targets today have no `topicId` — but this is exactly the state machine
// T9–T13's content will drive, and the fix is one line whose absence nothing else
// would notice.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useEffect } from 'react';
import { HelpRouteStoreProvider, HelpRoutePublisher } from '../help/publish';
import { HelpScopeProvider } from '../help/scope';
import { useHelpPanelState, type HelpPanelState } from '../components/help/useHelpPanel';

const TOPIC_ID = 'settings.weeklyTiebreaker';
/** A page with a real `href`, so `goToPage` navigates rather than forcing. */
const TARGET_PAGE = 'pool.nfl.standings';

let latest: HelpPanelState | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(() => {
  cleanup();
  latest = null;
});

/** Reports the panel state out of the tree from an effect, never during render. */
function Probe() {
  const state = useHelpPanelState({ isAdmin: false });
  useEffect(() => {
    latest = state;
  });
  return null;
}

/**
 * A pool surface that publishes the tab it is TOLD to, ignoring the URL.
 *
 * That is the case the pending target exists for and the case it can get stuck
 * on: a link whose tab the surface does not honour — a stale shared URL, or one
 * of the surfaces K13 deliberately left unlinked.
 */
function Harness({ tab }: { tab: string }) {
  return (
    <HelpRouteStoreProvider>
      <Probe />
      <HelpScopeProvider poolType="NFL_PICKEM" audience="commissioner">
        <HelpRoutePublisher tab={tab} />
      </HelpScopeProvider>
    </HelpRouteStoreProvider>
  );
}

function renderAt(tab: string) {
  return render(
    <MemoryRouter initialEntries={['/pool/abc']}>
      <Harness tab={tab} />
    </MemoryRouter>,
  );
}

function rerenderWith(rerender: (ui: React.ReactElement) => void, tab: string) {
  act(() => {
    rerender(
      <MemoryRouter initialEntries={['/pool/abc']}>
        <Harness tab={tab} />
      </MemoryRouter>,
    );
  });
}

describe('a pending Help target', () => {
  it('lands when the route reaches the page it was for', () => {
    const { rerender } = renderAt('dashboard');
    act(() => latest!.openTo({ topicId: TOPIC_ID, pageId: TARGET_PAGE }));
    // Held, not consumed: the surface still says `dashboard`.
    expect(latest!.activeTopicId).toBeUndefined();

    rerenderWith(rerender, 'standings');
    expect(latest!.page?.id).toBe(TARGET_PAGE);
    expect(latest!.activeTopicId).toBe(TOPIC_ID);
  });

  it('is dropped once the route resolves somewhere else, and does not fire later', () => {
    const { rerender } = renderAt('dashboard');
    act(() => latest!.openTo({ topicId: TOPIC_ID, pageId: TARGET_PAGE }));
    expect(latest!.activeTopicId).toBeUndefined();

    // The reader goes somewhere else entirely. The target is diverted.
    rerenderWith(rerender, 'picks');
    expect(latest!.page?.id).toBe('pool.nfl.picks');
    expect(latest!.activeTopicId).toBeUndefined();

    // …and arriving at the original target later must NOT resurrect it. This is
    // the assertion that fails without the one-line drop: the topic would open
    // itself on a screen the reader reached for their own reasons, possibly much
    // later in the session.
    rerenderWith(rerender, 'standings');
    expect(latest!.page?.id).toBe(TARGET_PAGE);
    expect(latest!.activeTopicId).toBeUndefined();
  });
});
