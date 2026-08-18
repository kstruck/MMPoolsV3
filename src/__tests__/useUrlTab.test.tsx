// @vitest-environment jsdom
//
// `useUrlTab` — PLAN-HELP-SYSTEM.md §6 K13 (T2).
//
// THE SECURITY-SHAPED TEST IS THE POINT OF THIS FILE. K13 moves the Props,
// Playoff and Squares-manager tabs out of `useState` and into `?tab=` so that a
// help search result can link to them. Those tabs were previously unreachable to
// anyone the tab strip did not render a button for — and the render branches
// gate on the BUTTON, not on the permission. So the valid set a URL may name has
// to be the set the surface is currently offering, never the static list of tab
// ids. codex found this as two P1s on round 4; these are its guards.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { useUrlTab } from '../components/help/useUrlTab';

afterEach(cleanup);

const ALL = ['cards', 'leaderboard', 'stats', 'admin', 'grading', 'ai'] as const;
type Tab = (typeof ALL)[number];

function Harness({ valid, fallback = 'cards' as Tab }: { valid: readonly Tab[]; fallback?: Tab }) {
  const [tab, setTab] = useUrlTab('tab', valid, fallback);
  const location = useLocation();
  return (
    <div>
      <span data-testid="tab">{tab}</span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={() => setTab('leaderboard')}>go</button>
    </div>
  );
}

function renderAt(path: string, valid: readonly Tab[], fallback?: Tab) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness valid={valid} fallback={fallback} />
    </MemoryRouter>,
  );
}

const tab = () => screen.getByTestId('tab').textContent;
const search = () => screen.getByTestId('search').textContent;

describe('reading the tab out of the URL', () => {
  it('takes a value the surface offers', () => {
    renderAt('/pool/abc?tab=leaderboard', ALL);
    expect(tab()).toBe('leaderboard');
  });

  it('falls back when the URL names nothing', () => {
    renderAt('/pool/abc', ALL);
    expect(tab()).toBe('cards');
  });

  it('falls back on a stale or invented value rather than rendering an empty screen', () => {
    renderAt('/pool/abc?tab=not-a-tab', ALL);
    expect(tab()).toBe('cards');
  });

  it('honours an explicit fallback — the manage route opens on its own tab', () => {
    renderAt('/admin/abc', ALL, 'admin');
    expect(tab()).toBe('admin');
  });
});

describe('a tab the surface is not offering (codex R4, P1)', () => {
  /**
   * `admin` and `grading` render commissioner controls — pool locking, grading —
   * and their branches do not re-check the permission, because until T2 the tab
   * lived in memory and a hidden button was the gate. A URL must not be able to
   * name one.
   */
  it('refuses a restricted tab a member could otherwise type into the address bar', () => {
    const memberSees: Tab[] = ['cards', 'leaderboard'];
    renderAt('/pool/abc?tab=admin', memberSees);
    expect(tab()).toBe('cards');
    cleanup();
    renderAt('/pool/abc?tab=grading', memberSees);
    expect(tab()).toBe('cards');
  });

  it('refuses a feature-locked tab', () => {
    renderAt('/pool/abc?tab=ai', ['cards', 'leaderboard']);
    expect(tab()).toBe('cards');
  });

  /**
   * The discriminating half. Without it, every assertion above would also pass
   * on a hook that ignored the URL entirely and always returned the fallback.
   */
  it('accepts the SAME tab once the surface offers it', () => {
    renderAt('/pool/abc?tab=admin', ['cards', 'admin']);
    expect(tab()).toBe('admin');
    cleanup();
    renderAt('/pool/abc?tab=ai', ['cards', 'ai']);
    expect(tab()).toBe('ai');
  });
});

describe('writing the tab back', () => {
  it('preserves the other query parameters', () => {
    // `?action=create` is the bracket dashboard's own parameter and must survive
    // a tab click, as must a `section=` deep link into a manager sub-tab.
    renderAt('/pool/abc?tab=cards&action=create', ALL);
    fireEvent.click(screen.getByText('go'));
    expect(tab()).toBe('leaderboard');
    expect(search()).toContain('action=create');
    expect(search()).toContain('tab=leaderboard');
  });
});
