// @vitest-environment jsdom
//
// The publish store — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// The panel is mounted above the router and every surface that knows where the
// reader is sits below it, so this store is the ONLY path by which an in-memory
// tab reaches the panel. Three things have to hold, and each is a real bug if
// it does not:
//
//   1. Fields MERGE across nested publishers — a dashboard publishes `tab` and
//      the manager view nested inside it publishes `subTab`. If one overwrote
//      the other, the panel would resolve to the wrong page.
//   2. An entry RETRACTS on unmount — leaving a pool must take its pool type
//      with it, or the panel keeps describing a screen nobody is on.
//   3. Publishing does not loop. Every caller passes an object literal, so a
//      store that compared by identity would set state on every render for ever.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { HelpRoutePublisher, HelpRouteStoreProvider, usePublishedRoute } from '../help/publish';
import { HelpScopeProvider } from '../help/scope';

afterEach(cleanup);

/**
 * Commits, appended from an effect.
 *
 * A counter incremented DURING render is the obvious way to write this and is
 * exactly what React's lint rule refuses — a render must not touch anything
 * outside itself, and neither may it read a ref. An effect with no dependency
 * array runs once per committed render, which is the number this file is
 * actually asking about, and an effect may write to the outside.
 */
const commits: string[] = [];

function Readout() {
  const published = usePublishedRoute();
  const json = JSON.stringify(published);
  useEffect(() => {
    commits.push(json);
  });
  return <pre data-testid="readout">{json}</pre>;
}

const readout = () => JSON.parse(screen.getByTestId('readout').textContent || '{}');

describe('merging', () => {
  it('combines the fields of nested publishers instead of overwriting them', () => {
    render(
      <HelpRouteStoreProvider>
        <Readout />
        <HelpScopeProvider poolType="NFL_PICKEM" audience="commissioner">
          {/* the dashboard */}
          <HelpRoutePublisher tab="manager" isManager />
          {/* the manager view nested inside it */}
          <HelpRoutePublisher subTab="members" />
        </HelpScopeProvider>
      </HelpRouteStoreProvider>,
    );
    expect(readout()).toEqual({
      poolType: 'NFL_PICKEM',
      audience: 'commissioner',
      tab: 'manager',
      subTab: 'members',
      isManager: true,
    });
  });

  it('a publisher omitting a field does not erase another publisher’s value', () => {
    render(
      <HelpRouteStoreProvider>
        <Readout />
        <HelpRoutePublisher tab="picks" />
        <HelpRoutePublisher subTab="anything" />
      </HelpRouteStoreProvider>,
    );
    // `undefined` fields are skipped, not written — otherwise the second
    // publisher's absent `tab` would blank the first one's.
    expect(readout().tab).toBe('picks');
    expect(readout().subTab).toBe('anything');
  });
});

describe('retraction', () => {
  it('drops a publisher’s facts when its branch unmounts', () => {
    function Harness() {
      const [inPool, setInPool] = useState(true);
      return (
        <HelpRouteStoreProvider>
          <Readout />
          <button type="button" onClick={() => setInPool(false)}>leave</button>
          {inPool ? (
            <HelpScopeProvider poolType="BRACKET" audience="member">
              <HelpRoutePublisher tab="standings" />
            </HelpScopeProvider>
          ) : null}
        </HelpRouteStoreProvider>
      );
    }
    render(<Harness />);
    expect(readout().poolType).toBe('BRACKET');
    expect(readout().tab).toBe('standings');

    fireEvent.click(screen.getByText('leave'));
    expect(readout().poolType).toBeUndefined();
    expect(readout().tab).toBeUndefined();
  });
});

describe('stability', () => {
  it('settles rather than re-rendering for ever on object-literal props', () => {
    commits.length = 0;
    const { rerender } = render(
      <HelpRouteStoreProvider>
        <Readout />
        <HelpRoutePublisher tab="picks" isManager={false} />
      </HelpRouteStoreProvider>,
    );
    const afterMount = commits.length;
    // A parent re-render hands the publisher a NEW object with the same values.
    rerender(
      <HelpRouteStoreProvider>
        <Readout />
        <HelpRoutePublisher tab="picks" isManager={false} />
      </HelpRouteStoreProvider>,
    );
    // One render for the rerender itself and no state update behind it: the
    // store compares by value, so an unchanged entry is not re-published.
    expect(commits.length - afterMount).toBeLessThanOrEqual(1);
    // And the counter is live, not stuck at zero — otherwise the assertion above
    // would hold for a component that never rendered at all.
    expect(afterMount).toBeGreaterThan(0);
  });
});

/**
 * The pool's settings ride the same channel, so a `HelpCopy.template` renders
 * the same branch in the panel that the tooltip renders inline.
 *
 * It is the ONE non-primitive a surface publishes, which makes it the one that
 * can restart the loop test 3 above exists to prevent.
 */
describe('settings', () => {
  it('a pool route publishes its settings; the wizard publishes none', () => {
    const settings = { weeklyTiebreaker: 'NONE' };
    render(
      <HelpRouteStoreProvider>
        <Readout />
        <HelpScopeProvider poolType="NFL_PICKEM" audience="member" settings={settings}>
          <HelpRoutePublisher tab="rules" />
        </HelpScopeProvider>
      </HelpRouteStoreProvider>,
    );
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'NONE' });

    cleanup();

    // The wizard's provider omits the prop — and that omission IS the contract
    // that keeps a template rendering its static fallback there.
    render(
      <HelpRouteStoreProvider>
        <Readout />
        <HelpScopeProvider poolType="NFL_PICKEM" audience="commissioner">
          <HelpRoutePublisher tab="rules" />
        </HelpScopeProvider>
      </HelpRouteStoreProvider>,
    );
    expect(readout().settings).toBeUndefined();
  });

  it('leaving the pool takes its settings with it', () => {
    // Otherwise the panel keeps rendering one pool's rule on the next screen.
    function Harness() {
      const [inPool, setInPool] = useState(true);
      return (
        <HelpRouteStoreProvider>
          <Readout />
          <button onClick={() => setInPool(false)}>leave</button>
          {inPool ? (
            <HelpScopeProvider poolType="NFL_PICKEM" audience="member" settings={{ weeklyTiebreaker: 'NONE' }}>
              <span />
            </HelpScopeProvider>
          ) : null}
        </HelpRouteStoreProvider>
      );
    }
    render(<Harness />);
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'NONE' });
    fireEvent.click(screen.getByText('leave'));
    expect(readout().settings).toBeUndefined();
  });

  /**
   * THE LOOP THIS COULD HAVE REINTRODUCED, as a test rather than as a comment.
   *
   * `useHelpRoute` depends on `settings` by identity, so a caller that rebuilds
   * the object each render re-runs the effect each render. That is harmless
   * ONLY because `shallowEqual` compares the map by value and the store bails
   * out. If it compared by identity instead, this render would set state,
   * re-render, rebuild, publish, and never stop.
   *
   * `PoolRoute` passes the pool document's own object, so this is defence, not
   * the live path — which is why it needs a test of its own to stay true.
   */
  it('settles when a caller rebuilds an equal settings object every render', () => {
    commits.length = 0;
    const tree = () => (
      <HelpRouteStoreProvider>
        <Readout />
        {/* A NEW object literal on every render, with identical contents. */}
        <HelpRoutePublisher tab="rules" settings={{ weeklyTiebreaker: 'NONE', entryFee: 10 }} />
      </HelpRouteStoreProvider>
    );
    const { rerender } = render(tree());
    const afterMount = commits.length;
    expect(afterMount).toBeGreaterThan(0);
    rerender(tree());
    expect(commits.length - afterMount).toBeLessThanOrEqual(1);
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'NONE', entryFee: 10 });
  });

  it('a CHANGED settings value still republishes — the guard is equality, not a mute', () => {
    // The failure mode on the other side: a comparison that said "equal" too
    // eagerly would freeze the copy at whatever the pool held on first render,
    // and a commissioner who changed the rule would keep reading the old one.
    const tree = (rule: string) => (
      <HelpRouteStoreProvider>
        <Readout />
        <HelpRoutePublisher tab="rules" settings={{ weeklyTiebreaker: rule }} />
      </HelpRouteStoreProvider>
    );
    const { rerender } = render(tree('NONE'));
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'NONE' });
    rerender(tree('MNF_LAST_GAME'));
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'MNF_LAST_GAME' });
  });

  it('a key ADDED to an otherwise equal map republishes', () => {
    // One-level equality has to see a new key, not only a changed one.
    const tree = (extra: Record<string, unknown>) => (
      <HelpRouteStoreProvider>
        <Readout />
        <HelpRoutePublisher tab="rules" settings={{ weeklyTiebreaker: 'NONE', ...extra }} />
      </HelpRouteStoreProvider>
    );
    const { rerender } = render(tree({}));
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'NONE' });
    rerender(tree({ confidenceMode: true }));
    expect(readout().settings).toEqual({ weeklyTiebreaker: 'NONE', confidenceMode: true });
  });
});

describe('outside the provider', () => {
  it('publishes into nothing instead of throwing — the T1 state, and any unit test', () => {
    // `HelpScopeProvider` publishes, and T1 shipped it on three routes with no
    // store above them at all. It must keep working.
    expect(() =>
      render(
        <HelpScopeProvider poolType="SQUARES" audience="commissioner">
          <HelpRoutePublisher tab="settings" />
        </HelpScopeProvider>,
      ),
    ).not.toThrow();
  });
});
