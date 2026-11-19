// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SquaresFreePromo, FreeTag } from '../components/landing/SquaresFreePromo';

afterEach(cleanup);

describe('SquaresFreePromo (homepage, 2026-11-19)', () => {
    it('says squares pools are free, as a labelled region', () => {
        render(<SquaresFreePromo />);
        const region = screen.getByRole('region', { name: /squares pools are free/i });
        expect(region).toBeTruthy();
        expect(region.textContent).toMatch(/limited time/i);
        expect(region.textContent).toMatch(/\$0 to host/);
    });

    it('carries the FREE stamp', () => {
        render(<SquaresFreePromo />);
        expect(screen.getAllByText(/^free$/i).length).toBeGreaterThan(0);
    });

    it('hides the decorative board from screen readers', () => {
        const { container } = render(<SquaresFreePromo />);
        const board = container.querySelector('.grid.grid-cols-5');
        expect(board?.getAttribute('aria-hidden')).toBe('true');
    });

    it('the FREE tag sweep runs only for people who did not ask for reduced motion', () => {
        const { container } = render(<FreeTag />);
        const sweep = container.querySelector('[aria-hidden="true"]');
        expect(sweep?.className).toContain('motion-safe:animate-sheen');
        expect(sweep?.className).not.toMatch(/(^|\s)animate-sheen/);
    });
});
