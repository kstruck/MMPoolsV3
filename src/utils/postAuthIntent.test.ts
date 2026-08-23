import { describe, it, expect, beforeEach } from 'vitest';
import { setPostAuthIntent, takePostAuthIntent, clearPostAuthIntent } from './postAuthIntent';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES G2 (codex r2) — continuing to the wizard after an
 * anonymous create CTA opened the auth modal.
 */

beforeEach(() => clearPostAuthIntent());

describe('postAuthIntent', () => {
    it('is empty until something sets it', () => {
        expect(takePostAuthIntent()).toBeNull();
    });

    it('hands the path back once, then forgets it', () => {
        // ONE-SHOT is the whole point (r2 [P2]): a leftover intent would fire on
        // a later, unrelated sign-in from the header.
        setPostAuthIntent('/create-pool');
        expect(takePostAuthIntent()).toBe('/create-pool');
        expect(takePostAuthIntent()).toBeNull();
    });

    it('clears on a cancelled auth', () => {
        setPostAuthIntent('/create-pool');
        clearPostAuthIntent();
        expect(takePostAuthIntent()).toBeNull();
    });

    it('the newest intent replaces an older one', () => {
        setPostAuthIntent('/create-pool');
        setPostAuthIntent('/pricing');
        expect(takePostAuthIntent()).toBe('/pricing');
    });
});
