import { describe, it, expect } from 'vitest';
import { normalizeBanterMood, banterTextFromAI } from '../lib/banter';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T9 — the pure halves of AI banter generation.
 *
 * Everything else in `generateBanter` is Firestore and the provider; these two
 * decide what actually reaches a feed every member of the pool reads.
 */

describe('normalizeBanterMood', () => {
    it.each(['savage', 'professional', 'analyst'])('accepts %s', (mood) => {
        expect(normalizeBanterMood(mood)).toBe(mood);
    });

    it.each([
        ['an unknown mood', 'unhinged'],
        ['an empty string', ''],
        ['undefined', undefined],
        ['null', null],
        ['a number', 3],
        ['an object', {}],
    ])('falls back to professional for %s', (_label, raw) => {
        // Deliberately NOT 'savage'. The mood arrives on a client-written
        // `ai_requests` doc, and the fallback is what an unrecognised value
        // gets posted as under the commissioner's name, to the whole pool.
        // 'professional' is the one tone that is safe unreviewed.
        expect(normalizeBanterMood(raw)).toBe('professional');
    });
});

describe('banterTextFromAI', () => {
    it('joins the headline and the bullets into one post', () => {
        expect(
            banterTextFromAI({ headline: 'Week 3 is a bloodbath.', summaryBullets: ['Alice leads by 4.', 'Bob picked the Jets.'] }),
        ).toBe('Week 3 is a bloodbath. Alice leads by 4. Bob picked the Jets.');
    });

    it('drops explanationSteps — a feed post is not a court filing', () => {
        // The output schema is shared with dispute resolution, which wants
        // step-by-step reasoning. On trash talk that reads like a filing.
        const text = banterTextFromAI({
            headline: 'Ouch.',
            summaryBullets: ['Bob is last.'],
            explanationSteps: ['Step 1: compare the seasonPoints column.'],
        });
        expect(text).toBe('Ouch. Bob is last.');
        expect(text).not.toContain('Step 1');
    });

    it('survives a headline with no bullets', () => {
        expect(banterTextFromAI({ headline: 'Quiet week.' })).toBe('Quiet week.');
    });

    it('survives bullets with no headline', () => {
        expect(banterTextFromAI({ summaryBullets: ['Alice leads.'] })).toBe('Alice leads.');
    });

    it('ignores non-string bullets rather than printing [object Object]', () => {
        expect(
            banterTextFromAI({ headline: 'Hi.', summaryBullets: ['ok', 42, null, { a: 1 }, '  '] }),
        ).toBe('Hi. ok');
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'not an object'],
        ['an empty object', {}],
        ['blank fields', { headline: '   ', summaryBullets: [] }],
    ])('returns empty for %s', (_label, ai) => {
        // The caller treats empty as a FAILURE and marks the request ERROR
        // rather than posting a blank message into the feed.
        expect(banterTextFromAI(ai)).toBe('');
    });

    it('trims each part so the join does not double-space', () => {
        expect(banterTextFromAI({ headline: '  Hi.  ', summaryBullets: ['  there.  '] })).toBe('Hi. there.');
    });
});
