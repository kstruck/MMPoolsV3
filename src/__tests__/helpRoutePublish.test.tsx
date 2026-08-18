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
