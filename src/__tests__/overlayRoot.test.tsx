// @vitest-environment jsdom
//
// `OverlayRoot` — PLAN-HELP-SYSTEM.md §3 D3, ticket T16.
//
// The invariant suite (`tests/overlay-stack-invariants.test.ts`) proves every
// shell USES this component. This file proves the component does the thing the
// shells are using it for: own the screen while open, hand Escape to the top
// overlay only, and refuse the dialog role to an overlay that has not earned it.
//
// jsdom is opted into per file, same as `helpPanel.test.tsx` — the other 80-odd
// suites stay on the node environment.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { OverlayRoot } from '../components/ui/OverlayRoot';
import { __resetOverlayStack, isForeignOverlayOpen, overlayStackTop } from '../components/ui/overlayStack';

beforeEach(() => __resetOverlayStack());
afterEach(() => {
  cleanup();
  __resetOverlayStack();
});

describe('OverlayRoot', () => {
  it('owns the screen while mounted and lets go when it unmounts', () => {
    const { unmount } = render(
      <OverlayRoot id="test-modal" label="Test modal" className="fixed inset-0">
        <p>body</p>
      </OverlayRoot>,
    );
    expect(overlayStackTop()).toBe('test-modal');
    expect(isForeignOverlayOpen('help-panel')).toBe(true);

    unmount();
    expect(overlayStackTop()).toBeNull();
    // Nothing left in the DOM for the class fallback to find either.
    expect(isForeignOverlayOpen('help-panel')).toBe(false);
  });

  it('carries the marker and a named dialog role', () => {
    render(
      <OverlayRoot id="test-modal" label="Test modal" className="fixed inset-0">
        <p>body</p>
      </OverlayRoot>,
    );
    // `@testing-library/jest-dom` is not installed here, so attributes are read
    // rather than matched.
    const shell = screen.getByRole('dialog', { name: 'Test modal' });
    expect(shell.hasAttribute('data-overlay-root')).toBe(true);
    expect(shell.getAttribute('aria-modal')).toBe('true');
  });

  it('gives a scrim the marker but NOT the dialog role', () => {
    // The point of `dialog={false}`: a loading scrim traps nothing and
    // dismisses nothing, so telling a screen reader it is a dialog is a lie.
    render(<OverlayRoot id="test-scrim" dialog={false} className="fixed inset-0">wait</OverlayRoot>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-overlay-root]')).not.toBeNull();
    expect(overlayStackTop()).toBe('test-scrim');
  });

  it('is inert while `active` is false', () => {
    // The SuperAdmin seed editor keeps the element mounted and only swaps its
    // classes. Registering it on mount would let it own the stack forever.
    render(<OverlayRoot id="test-inline" label="Inline form" active={false} className="">form</OverlayRoot>);
    expect(overlayStackTop()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-overlay-root]')).toBeNull();
  });

  it('Escape reaches only the innermost overlay', () => {
    const seen: string[] = [];
    render(
      <>
        <OverlayRoot id="outer" label="Outer" className="fixed inset-0" onEscape={() => seen.push('outer')}>
          outer
        </OverlayRoot>
        <OverlayRoot id="inner" label="Inner" className="fixed inset-0" onEscape={() => seen.push('inner')}>
          inner
        </OverlayRoot>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(seen).toEqual(['inner']);
  });

  it('returns focus to whatever opened it', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <OverlayRoot id="focus-modal" label="Focus modal" className="fixed inset-0">
              <button onClick={() => setOpen(false)}>Close</button>
            </OverlayRoot>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(opener);
  });
});
