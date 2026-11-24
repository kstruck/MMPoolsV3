// @vitest-environment jsdom
/**
 * "Show Everyone's Pts Left" (PLAN-PTS-LEFT-HIDDEN-TOTAL, Kevin 2026-11-23).
 *
 * The switch is ON by default, saves only `settings.shareHiddenPointsLeft`,
 * and lives OUTSIDE the in-season settings lock: it only matters while hidden
 * picks exist, which is during the season (codex r1 on the PR).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
// `?raw`, not node:fs — the frontend typecheck has no Node types (the #782 trap).
import view from '../components/NFLPoolDashboard/NFLManagerView.tsx?raw';

vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));
const updatePoolSettings = vi.fn(async () => ({}));
vi.mock('../services/dbService', () => ({ dbService: { updatePoolSettings: (...a: unknown[]) => updatePoolSettings(...(a as [])) } }));
// Stable spies, not a fresh `vi.fn()` per `useToast()` call: a spy made inside
// the hook cannot be asserted on, so "an error toast was shown" was untestable.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) }),
}));

import { NFLPointsLeftSharingSetting } from '../components/NFLPoolDashboard/NFLPointsLeftSharingSetting';

beforeEach(() => { updatePoolSettings.mockClear(); toastSuccess.mockClear(); toastError.mockClear(); });
afterEach(cleanup);

const pool = (settings: Record<string, unknown> = {}) => ({ id: 'p1', type: 'NFL_PICKEM', settings }) as never;
const box = (c: HTMLElement) => c.querySelector('#share-points-left') as HTMLInputElement;

describe("Show Everyone's Pts Left", () => {
  it('is ON for a pool that never set it', () => {
    const { container } = render(<NFLPointsLeftSharingSetting pool={pool()} />);
    expect(box(container).checked).toBe(true);
  });

  it('shows OFF when the pool stored false', () => {
    const { container } = render(<NFLPointsLeftSharingSetting pool={pool({ shareHiddenPointsLeft: false })} />);
    expect(box(container).checked).toBe(false);
  });

  it('turning it off saves exactly that one setting', async () => {
    const { container } = render(<NFLPointsLeftSharingSetting pool={pool()} />);
    fireEvent.click(box(container));
    await waitFor(() => expect(updatePoolSettings).toHaveBeenCalledTimes(1));
    expect(updatePoolSettings).toHaveBeenCalledWith('p1', { settings: { shareHiddenPointsLeft: false } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a REJECTED save shows an error and the switch goes back to the stored value', async () => {
    // The Claude pre-review of #801: no test covered the failure path. The
    // switch is optimistic, so a save that fails must not leave it showing a
    // setting the server never stored.
    updatePoolSettings.mockRejectedValueOnce(new Error('permission-denied'));
    const { container } = render(<NFLPointsLeftSharingSetting pool={pool()} />);
    expect(box(container).checked).toBe(true);
    fireEvent.click(box(container));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    // Stored value is ON (never set); the failed "turn off" must not stick.
    await waitFor(() => expect(box(container).checked).toBe(true));
    expect(updatePoolSettings).toHaveBeenCalledTimes(1);
  });
});

describe('it is not inside the in-season settings lock', () => {
  it('is rendered as its own card beside branding, for Pick\'em only', () => {
    expect(view).toContain("{commishTab === 'settings' && type === 'NFL_PICKEM' && <NFLPointsLeftSharingSetting pool={pool} />}");
  });

  it('and not from inside the canEditSettings-gated form', () => {
    const gateStart = view.indexOf("<div className={`p-6 space-y-6 ${!canEditSettings ? 'opacity-40 pointer-events-none select-none' : ''}`}>");
    const card = view.indexOf('<NFLPointsLeftSharingSetting');
    const branding = view.indexOf('<NFLBrandingSettings pool={pool} />');
    expect(gateStart).toBeGreaterThan(0);
    // After branding, which is itself documented as outside the gate.
    expect(card).toBeGreaterThan(branding);
    expect(view).not.toContain('shareHiddenPointsLeft');
  });
});
