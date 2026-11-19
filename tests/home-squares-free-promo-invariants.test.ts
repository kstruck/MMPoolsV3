/**
 * Homepage: squares pools are FREE for a limited time (Kevin, 2026-11-19).
 *
 * Kevin asked for three things on the hero: remove the countdown, turn
 * "Create an NFL Pool" into a squares CTA, and add a FREE tag. Read from the
 * source because `LandingPage` mounts the shared Header (auth, Firebase); the
 * promo card itself is rendered in `src/__tests__/SquaresFreePromo.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SQUARES_FREE_PROMO, SQUARES_CREATION_OPEN } from '../src/config/season';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const landing = read('src/components/LandingPage.tsx');
const app = read('src/App.tsx');

describe('homepage hero — free squares promo', () => {
    it('the countdown is gone from the homepage', () => {
        expect(landing).not.toMatch(/<Countdown\b/);
        expect(landing).not.toMatch(/import \{ Countdown \}/);
    });

    it('the promo shows only while BOTH the promo flag and squares creation are on', () => {
        expect(landing).toContain('const squaresPromo = SQUARES_FREE_PROMO && SQUARES_CREATION_OPEN;');
        expect(landing).toMatch(/\{squaresPromo && \([\s\S]{0,200}?<SquaresFreePromo \/>/);
    });

    it('the flags are on today (squares is $0 until after Thanksgiving, plan K10)', () => {
        expect(SQUARES_FREE_PROMO).toBe(true);
        expect(SQUARES_CREATION_OPEN).toBe(true);
    });

    it('while it runs, the primary CTA hosts a SQUARES pool and wears the FREE tag', () => {
        const cta = landing.slice(landing.indexOf('{squaresPromo ? ('), landing.indexOf(') : (', landing.indexOf('{squaresPromo ? (')));
        expect(cta).toContain('onClick={canCreateSquares ? onCreateSquaresPool : undefined}');
        expect(cta).toContain("'Host a Squares Pool'");
        expect(cta).toMatch(/canCreateSquares && <FreeTag/);
        // Gated on the SQUARES switch, never the master one.
        expect(landing).toContain('const canCreateSquares = canAccessSquaresCreation(user);');
    });

    it('with the promo off, the hero falls back to the NFL button', () => {
        const fallback = landing.slice(landing.indexOf(') : (', landing.indexOf('{squaresPromo ? (')));
        expect(fallback.slice(0, 900)).toContain("'Create an NFL Pool'");
        expect(fallback.slice(0, 900)).toContain('onClick={canCreate ? onCreatePool : undefined}');
    });
});

describe('the squares CTA reaches the squares wizard, signed in or not', () => {
    it('App wires the homepage to the squares handler', () => {
        const el = app.slice(app.indexOf('<LandingPage'), app.indexOf('/>', app.indexOf('<LandingPage')));
        expect(el).toContain('onCreateSquaresPool={handleSquaresPoolCreate}');
    });

    it('an anonymous visitor keeps the intent through sign-up (G2), set BEFORE the auth check', () => {
        const fn = app.slice(app.indexOf('const handleSquaresPoolCreate'), app.indexOf('};', app.indexOf('const handleSquaresPoolCreate')));
        const intent = fn.indexOf("if (!user) setPostAuthIntent('/create/squares');");
        expect(intent).toBeGreaterThan(0);
        expect(intent).toBeLessThan(fn.indexOf('if (!checkAccess()) return;'));
        expect(fn).toContain("navigate('/create/squares');");
    });
});
