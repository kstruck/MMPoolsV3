// @vitest-environment jsdom
//
// Audit item 15a: HelpPanel declared `aria-modal` on mobile and then let Tab
// walk onto the page behind it. `useFocusTrap` is now wired — but ONLY on the
// mobile branch, because the desktop panel is a non-modal side drawer and
// trapping Tab there would strand a keyboard reader in a panel the page never
// claimed to own.
//
// Both halves are asserted here on purpose: a test that only proved the mobile
// trap would pass just as happily if the trap were unconditional, which is the
// exact defect this file exists to catch.
//
// Lives in its own file rather than helpPanel.test.tsx because that suite pins
// `matchMedia` to desktop for every test in it (see its `beforeAll`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HelpProvider } from '../components/help/HelpPanel';
import { HelpHeaderButton } from '../components/help/HelpHeaderButton';
import { HelpRoutePublisher } from '../help/publish';
import { HelpScopeProvider } from '../help/scope';
import { __resetOverlayStack } from '../components/ui/overlayStack';

function setViewport(isMobile: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
            matches: isMobile,
            media: query,
            addEventListener: () => { },
            removeEventListener: () => { },
        }),
    });
}

beforeEach(() => {
    __resetOverlayStack();
    Element.prototype.scrollIntoView = () => { };
});
afterEach(() => {
    cleanup();
    __resetOverlayStack();
    vi.restoreAllMocks();
});

function renderPanel() {
    return render(
        <MemoryRouter initialEntries={['/create/pickem']}>
            <HelpProvider isAdmin={false}>
                <HelpScopeProvider poolType="NFL_PICKEM" audience="commissioner">
                    <HelpRoutePublisher tab="rules" />
                    <HelpHeaderButton />
                    <button data-testid="outside">a control on the page behind</button>
                </HelpScopeProvider>
            </HelpProvider>
        </MemoryRouter>,
    );
}

const panel = () => document.getElementById('help-panel')!;
const isOpen = () => panel().getAttribute('role') === 'dialog';

/**
 * Open the panel AND wait for its own open-effect to finish moving focus into
 * the search input (a `setTimeout(…, 0)` in HelpPanel). Without this wait both
 * tests race that timer: the desktop one could see focus stolen after it parks
 * focus outside, and — worse — the mobile one would pass for the wrong reason,
 * reporting "focus is inside the panel" when the autofocus put it there and the
 * trap did nothing.
 */
async function openPanel() {
    fireEvent.keyDown(document, { key: '?' });
    await waitFor(() => expect(isOpen()).toBe(true));
    await waitFor(() => expect(panel().contains(document.activeElement)).toBe(true));
}

describe('HelpPanel focus containment', () => {
    it('mobile (aria-modal): Tab from outside is pulled back into the panel', async () => {
        setViewport(true);
        const { getByTestId } = renderPanel();
        await openPanel();
        expect(panel().getAttribute('aria-modal')).toBe('true');

        // Park focus behind the panel — the exact state the audit measured.
        const outside = getByTestId('outside');
        outside.focus();
        expect(document.activeElement, 'focus starts OUTSIDE the panel').toBe(outside);

        fireEvent.keyDown(document, { key: 'Tab' });
        // The trap pulled it back to the panel's first focusable.
        expect(document.activeElement).not.toBe(outside);
        expect(panel().contains(document.activeElement)).toBe(true);
    });

    it('desktop (non-modal drawer): Tab is NOT trapped', async () => {
        setViewport(false);
        const { getByTestId } = renderPanel();
        await openPanel();
        // The desktop drawer must not claim modality...
        expect(panel().getAttribute('aria-modal')).toBeNull();

        const outside = getByTestId('outside');
        outside.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        // ...and the trap must leave the browser's own Tab order alone.
        expect(document.activeElement).toBe(outside);
    });
});
