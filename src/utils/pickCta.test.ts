import { describe, it, expect } from 'vitest';
import { pickCtaFor } from './pickCta';

describe('pickCtaFor — one label rule for every pool-home picks button', () => {
    it('open week, nothing picked → Make Picks', () => {
        expect(pickCtaFor({ locked: false, complete: false, hasAnyPick: false }))
            .toEqual({ label: 'Make Picks', disabled: false });
    });
    it('open week, half-filled Pick\'em sheet → still Make Picks (not Edit)', () => {
        expect(pickCtaFor({ locked: false, complete: false, hasAnyPick: true }).label).toBe('Make Picks');
    });
    it('open week, all picks in → Edit My Picks', () => {
        expect(pickCtaFor({ locked: false, complete: true, hasAnyPick: true }))
            .toEqual({ label: 'Edit My Picks', disabled: false });
    });
    it('locked week with picks → View My Picks, never Edit', () => {
        const cta = pickCtaFor({ locked: true, complete: true, hasAnyPick: true });
        expect(cta.label).toBe('View My Picks');
        expect(cta.disabled).toBe(false);
    });
    it('locked week, nothing picked → Picks Locked, disabled', () => {
        expect(pickCtaFor({ locked: true, complete: false, hasAnyPick: false }))
            .toEqual({ label: 'Picks Locked', disabled: true });
    });
    it('the two live labels are exactly Kevin\'s words', () => {
        const labels = new Set(
            [
                { locked: false, complete: false, hasAnyPick: false },
                { locked: false, complete: true, hasAnyPick: true },
            ].map(i => pickCtaFor(i).label),
        );
        expect(labels).toEqual(new Set(['Make Picks', 'Edit My Picks']));
    });
});
