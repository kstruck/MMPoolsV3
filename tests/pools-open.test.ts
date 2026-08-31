import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { POOLS_OPEN } from '../src/config/season';
import { canAccessPoolCreation, POOL_CREATION_ENABLED } from '../src/utils/auth';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES G1 / D6 — the launch flip.
 *
 * `POOLS_OPEN` is a BUILD-TIME constant, so opening pool creation is a code
 * change plus a Coolify `www` rebuild, not a config save. This suite exists so
 * the flip is a decision with consequences someone can read, rather than a
 * one-character diff nobody can review.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

describe('with pool creation OPEN', () => {
    it('the flag is on', () => {
        expect(POOLS_OPEN).toBe(true);
        expect(POOL_CREATION_ENABLED).toBe(true);
    });

    it('a logged-OUT visitor may reach the creation flows', () => {
        // This is the whole point of the flip, and it is also what makes G2 a
        // hard prerequisite: until T6a, this returning true meant an anonymous
        // click was bounced to `/` with no modal and no message.
        expect(canAccessPoolCreation(null)).toBe(true);
        expect(canAccessPoolCreation(undefined)).toBe(true);
    });

    it('an ordinary signed-in member may too', () => {
        expect(canAccessPoolCreation({ id: 'u1', role: 'PARTICIPANT' } as never)).toBe(true);
    });
});

describe('the front door does not contradict the flip', () => {
    it('the landing hero badge follows POOL_CREATION_ENABLED (codex [P2])', () => {
        // It was the one unconditional launch-status line, and it sat directly
        // above an enabled "Create an NFL Pool" button — on the page Monday's
        // invite traffic lands on.
        const landing = read('src/components/LandingPage.tsx');
        expect(landing).not.toMatch(/>2026 NFL Season Pools Coming Soon</);
        expect(landing).toContain("POOL_CREATION_ENABLED ? '2026 NFL Season Pools Are Open'");
    });

    it('every other launch CTA was already gated on the same flag', () => {
        // Not a text scan of the whole file — one that greps for "Coming Soon"
        // trips on prose about the fix. These are the concrete CTAs, and each
        // reads canCreate / canAccessPoolCreation, which follow POOLS_OPEN.
        for (const file of [
            'src/components/FeaturesPage.tsx',
            'src/components/HowItWorksPage.tsx',
            'src/components/CreatePoolSelection.tsx',
            'src/components/Header.tsx',
        ]) {
            const src = read(file);
            expect(/canCreate|canAccessPoolCreation/.test(src), file).toBe(true);
        }
    });

    /**
     * `GamedaySquaresLanding` LEFT THE LIST ABOVE ON PURPOSE (2026-08-28).
     *
     * Every CTA on it creates a SQUARES pool, and squares creation is closed on
     * its own switch while the `maxSquaresPerPlayer: 0` defect is fixed
     * (`SQUARES-BACKLOG.md`). Gating that page on the master flag would reopen
     * it the moment POOLS_OPEN is true, which is now — so the assertion is
     * inverted for this one file rather than dropped.
     */
    it('the squares landing follows the SQUARES switch, never the master one', () => {
        const src = read('src/components/GamedaySquaresLanding.tsx');
        expect(src).toContain('canAccessSquaresCreation');
        expect(/canAccessPoolCreation/.test(src)).toBe(false);
    });
});

describe('the G2 prerequisite is actually in place', () => {
    // 🛑 If these fail, DO NOT MERGE THE FLIP. An anonymous visitor clicking a
    // now-enabled "Build Your Pool — Free to Start" button would be redirected
    // to `/` with no explanation — a silent dead end on the launch-day CTA.
    it('the global create entry opens auth instead of navigating', () => {
        const app = read('src/App.tsx');
        expect(app).not.toContain("const handleCreatePoolClick = () => navigate('/create-pool');");
        expect(app).toContain('if (!checkAccess()) return;');
    });

    it('/pricing create CTAs open auth and remember the intent', () => {
        const pricing = read('src/components/PricingPage.tsx');
        expect(pricing).toContain("setPostAuthIntent('/create-pool')");
        expect(pricing).not.toContain("onClick={canCreate ? () => navigate('/create-pool') : undefined}");
    });
});
