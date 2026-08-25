import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES G2, second pass (codex [P1] on the POOLS_OPEN flip).
 *
 * T6a fixed the two entry points I had found. The flip review found the rest:
 * once `POOLS_OPEN` is true, every previously-disabled public "create a pool"
 * button becomes clickable by an anonymous visitor, and they took three
 * different broken shapes —
 *
 *   1. `navigate('/create-pool')` directly → the route requires `user &&`, so
 *      a silent bounce to `/` with no modal and no message;
 *   2. `isLoggedIn ? onCreatePool : onSignup` → auth opens with NO intent
 *      recorded, so a new account finishes on /participant instead of the
 *      wizard they asked for;
 *   3. `user ? onCreatePool : onOpenAuth` → same as (2).
 *
 * All of them now call `onCreatePool` unconditionally. That IS
 * `handleCreatePoolClick`, which records the intent, opens auth for an
 * anonymous visitor, and navigates for a signed-in one.
 *
 * 🛑 These are LAUNCH-DAY paths: they are what Monday's invite traffic clicks.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const PUBLIC_PAGES = [
    'src/components/LandingPage.tsx',
    'src/components/FeaturesPage.tsx',
    'src/components/GamedaySquaresLanding.tsx',
    'src/components/HowItWorksPage.tsx',
];

describe('every public create CTA routes through the shared handler', () => {
    it.each(PUBLIC_PAGES)('%s never navigates to /create-pool itself', (file) => {
        expect(read(file)).not.toContain("navigate('/create-pool')");
    });

    it.each(PUBLIC_PAGES)('%s never swaps the create handler out for a bare auth opener', (file) => {
        const src = read(file);
        // The two shapes that dropped the post-auth intent.
        expect(src).not.toMatch(/isLoggedIn \? onCreatePool : onSignup/);
        expect(src).not.toMatch(/user \? onCreatePool : onOpenAuth/);
    });
});

describe('the shared handler still does the two things that matter', () => {
    const app = read('src/App.tsx');

    it('records the intent before opening auth', () => {
        expect(app).toMatch(/handleCreatePoolClick = \(\) => \{[\s\S]{0,400}?setPostAuthIntent\('\/create-pool'\);/);
    });

    it('and gates on access, so this is not a way past POOLS_OPEN', () => {
        expect(app).toMatch(/handleCreatePoolClick = \(\) => \{[\s\S]{0,600}?if \(!checkAccess\(\)\) return;/);
    });
});

describe('signed-in-only surfaces are deliberately left alone', () => {
    it('PoolTypeGate and ParticipantDashboard may navigate directly', () => {
        // Both render only behind a `user &&` route, so there is no anonymous
        // visitor to bounce. Listing them stops a future sweep "fixing" them.
        expect(read('src/components/PoolTypeGate.tsx')).toContain("navigate('/create-pool')");
        expect(read('src/components/ParticipantDashboard.tsx')).toContain("navigate('/create-pool')");
    });
});
