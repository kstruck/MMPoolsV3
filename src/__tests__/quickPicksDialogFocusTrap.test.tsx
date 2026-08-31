// @vitest-environment jsdom
//
// Audit item 15a, the LAST of the three residual `aria-modal` surfaces.
//
// `QuickPicksDialog` declared `aria-modal="true"` — which tells a screen reader
// the rest of the page is inert — and then let Tab walk straight out onto the
// pick sheet behind it. PRs #555 and #571 wired the other five surfaces to the
// shared `useFocusTrap`; this one was deferred because the file belonged to
// another workstream. It is wired the same way now, and this is the behavioural
// proof (the source pin lives in `tests/a11y-invariants.test.ts`).
//
// Modelled on `helpPanelFocusTrap.test.tsx`, with one difference worth naming:
// the Help panel has BOTH a modal and a non-modal branch, so that file has to
// prove the trap is conditional. This dialog is mounted only while open, so the
// trap is unconditional and there is no second branch to guard — the equivalent
// negative assertion here is that unmounting removes the listener, which is
// what stops a closed dialog owning the keyboard for the life of the app.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QuickPicksDialog } from '../components/NFLPoolDashboard/pickSheet/QuickPicksDialog';
import { __resetOverlayStack } from '../components/ui/overlayStack';
import type { NFLGame } from '../types';

const team = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

// A real line on every game, so all four strategy rows render ENABLED. A
// disabled button is not focusable and the trap skips it, which would leave the
// dialog with a single focusable and make a wrap-around assertion vacuous.
const games = [
    {
        id: 'g1', espnGameId: 'g1', season: '2026', seasonType: 1, week: 1,
        startTime: 0, status: 'SCHEDULED', isMonday: false,
        homeTeam: team('ARI'), awayTeam: team('CAR'),
        spread: { value: -3, locked: true },
    },
    {
        id: 'g2', espnGameId: 'g2', season: '2026', seasonType: 1, week: 1,
        startTime: 0, status: 'SCHEDULED', isMonday: false,
        homeTeam: team('BUF'), awayTeam: team('NYJ'),
        spread: { value: 6.5, locked: true },
    },
] as unknown as NFLGame[];

function renderDialog() {
    return render(
        <div>
            <button data-testid="outside">a control on the pick sheet behind</button>
            <QuickPicksDialog
                games={games}
                picks={{}}
                eligible={() => true}
                onApply={() => { }}
                onClose={() => { }}
            />
        </div>,
    );
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const focusables = () =>
    Array.from(dialog().querySelectorAll<HTMLElement>('button:not([disabled])'));

beforeEach(() => __resetOverlayStack());
afterEach(() => {
    cleanup();
    __resetOverlayStack();
});

describe('QuickPicksDialog focus containment', () => {
    it('declares aria-modal, so it owes containment', () => {
        renderDialog();
        expect(dialog().getAttribute('aria-modal')).toBe('true');
        // Guard the guard: if every option rendered disabled there would be one
        // focusable and the wrap tests below would prove nothing.
        expect(focusables().length).toBeGreaterThan(2);
    });

    it('Tab from the page behind is pulled back into the dialog', () => {
        const { getByTestId } = renderDialog();
        const outside = getByTestId('outside');
        outside.focus();
        expect(document.activeElement, 'focus starts OUTSIDE the dialog').toBe(outside);

        fireEvent.keyDown(document, { key: 'Tab' });

        expect(document.activeElement).not.toBe(outside);
        expect(dialog().contains(document.activeElement)).toBe(true);
    });

    it('Tab on the last control wraps to the first instead of escaping', () => {
        renderDialog();
        const f = focusables();
        f[f.length - 1].focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(f[0]);
    });

    it('Shift+Tab on the first control wraps to the last', () => {
        renderDialog();
        const f = focusables();
        f[0].focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(f[f.length - 1]);
    });

    it('leaves the page alone once the dialog unmounts', () => {
        // The caller mounts this component only while the dialog is open, so
        // the unmount IS the close. If the listener outlived it, every Tab on
        // the pick sheet afterwards would be yanked to a dialog that is gone.
        const { getByTestId, unmount } = renderDialog();
        const outside = getByTestId('outside');
        unmount();
        // Re-attached because `unmount` detached it with the tree; focus() on a
        // detached node is a no-op and the assertion would pass vacuously.
        document.body.appendChild(outside);
        try {
            outside.focus();
            expect(document.activeElement, 'focus really is on the node').toBe(outside);
            fireEvent.keyDown(document, { key: 'Tab' });
            expect(document.activeElement).toBe(outside);
        } finally {
            // `cleanup()` cannot remove a node this test attached by hand, and a
            // stray `data-testid="outside"` in the body would make `getByTestId`
            // ambiguous for any test added after this one.
            outside.remove();
        }
    });
});
