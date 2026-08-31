// @vitest-environment jsdom
//
// 2026-08-23 a11y audit: AuthModal claimed aria-modal="true" and let Tab walk
// out onto the page behind it (12 Tabs landed on the header nav, measured
// live). useFocusTrap is the fix; this exercises the wrap-around behavior.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React, { useRef } from 'react';
import { useFocusTrap } from '../components/ui/useFocusTrap';

afterEach(cleanup);

const TrapActive: React.FC<{ active?: boolean }> = ({ active = true }) => {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref, active);
    return (
        <div>
            <button data-testid="outside">outside</button>
            <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true">
                <button data-testid="first">first</button>
                <button data-testid="second">second</button>
                <button data-testid="last">last</button>
            </div>
        </div>
    );
};

describe('useFocusTrap', () => {
    it('Tab on the last focusable wraps to the first', () => {
        const { getByTestId } = render(<TrapActive />);
        getByTestId('last').focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(getByTestId('first'));
    });

    it('Shift+Tab on the first focusable wraps to the last', () => {
        const { getByTestId } = render(<TrapActive />);
        getByTestId('first').focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(getByTestId('last'));
    });

    it('focus that escaped the dialog is pulled back in', () => {
        const { getByTestId } = render(<TrapActive />);
        getByTestId('outside').focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(getByTestId('first'));
    });

    it('inactive trap does nothing', () => {
        const { getByTestId } = render(<TrapActive active={false} />);
        getByTestId('outside').focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(getByTestId('outside'));
    });
});
