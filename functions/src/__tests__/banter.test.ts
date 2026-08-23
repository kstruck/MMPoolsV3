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

// ---------------------------------------------------------------------------
// codex r1 [P1] on T9: `ai_requests` create is participant-scoped — correctly,
// since a dispute is a member's to ask — but BANTER is different in kind: the
// result is posted POOL-WIDE under the AI Commissioner's identity. Without this
// predicate, any participant could bypass the manager-only card, spend the paid
// provider, and publish AI-authored posts to everyone.
// ---------------------------------------------------------------------------
describe('isPoolCommissionerUid', () => {
    const nfl = (over: Record<string, unknown> = {}) => ({
        type: 'NFL_PICKEM', ownerId: 'owner', managerUid: 'owner', coManagers: ['co'], ...over,
    });

    it('accepts the owner', async () => {
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl(), 'owner')).toBe(true);
    });

    it('accepts the legacy managerUid', async () => {
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl({ ownerId: 'someone', managerUid: 'mgr' }), 'mgr')).toBe(true);
    });

    it('does NOT admit a legacy createdByUid (codex r3 [P2])', async () => {
        // The feed's DELETE rule and the client's commissioner gate recognise
        // ownerId / managerUid / NFL co-manager / super admin and nothing else.
        // Admitting a legacy creator here would let them PUBLISH an AI post to
        // the whole pool that they can neither moderate nor delete.
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl({ ownerId: '', createdByUid: 'legacy', managerUid: '' }), 'legacy')).toBe(false);
    });

    it('accepts a named NFL co-commissioner', async () => {
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl(), 'co')).toBe(true);
    });

    it('REFUSES a co-manager on a non-NFL pool', async () => {
        // coManagers grants nothing outside NFL — same rule the firestore
        // helper and the functions gate enforce.
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl({ type: 'BRACKET' }), 'co')).toBe(false);
    });

    it('refuses an ordinary participant, a stranger and a missing uid', async () => {
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl(), 'alice')).toBe(false);
        expect(isPoolCommissionerUid(nfl(), undefined)).toBe(false);
        expect(isPoolCommissionerUid(null, 'owner')).toBe(false);
    });

    it('accepts a SUPER_ADMIN via the role argument (codex r2 [P2])', async () => {
        // The feed's delete rule admits super admins explicitly, and the
        // commissioner dashboard shows them the card. Without this the request
        // was accepted, then failed with BANTER_NOT_COMMISSIONER and no post —
        // three layers disagreeing about the same person.
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl(), 'admin', 'SUPER_ADMIN')).toBe(true);
        expect(isPoolCommissionerUid(nfl({ type: 'BRACKET' }), 'admin', 'SUPER_ADMIN')).toBe(true);
    });

    it('does not accept any other role', async () => {
        const { isPoolCommissionerUid } = await import('../lib/banter');
        for (const role of ['MODERATOR', 'MEMBER', 'PARTICIPANT', 'COMMISSIONER', '', undefined, null]) {
            expect(isPoolCommissionerUid(nfl(), 'alice', role), String(role)).toBe(false);
        }
    });

    it('tolerates a malformed coManagers value', async () => {
        const { isPoolCommissionerUid } = await import('../lib/banter');
        expect(isPoolCommissionerUid(nfl({ coManagers: 'co' }), 'co')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// codex r3 [P1] on T9: the first version of the fact builder mapped invented
// keys, so every standings value reached Gemini as null — and with the
// "no hallucinations" rule that leaves the model nothing to say. The
// projection's field names are TYPE-SPECIFIC and none is the obvious one.
// ---------------------------------------------------------------------------
describe('banterStandingsRow', () => {
    it("reads Pick'em's totalScore and userName", async () => {
        const { banterStandingsRow } = await import('../lib/banter');
        expect(banterStandingsRow({ rank: 1, userName: 'Alice', totalScore: 42 }, 'NFL_PICKEM')).toEqual({
            rank: 1, name: 'Alice', seasonPoints: 42,
        });
    });

    it("reads Margin's seasonTotal", async () => {
        const { banterStandingsRow } = await import('../lib/banter');
        expect(banterStandingsRow({ rank: 2, userName: 'Bob', seasonTotal: -14 }, 'NFL_MARGIN')).toEqual({
            rank: 2, name: 'Bob', seasonPoints: -14,
        });
    });

    it('carries Survivor status, which has no points column at all', async () => {
        // Without it the model gets a list of names and nothing to talk about.
        const { banterStandingsRow } = await import('../lib/banter');
        expect(banterStandingsRow({ rank: 3, userName: 'Cara', status: 'ELIMINATED', strikesUsed: 2 }, 'NFL_SURVIVOR')).toEqual({
            rank: 3, name: 'Cara', seasonPoints: null, status: 'ELIMINATED', strikesUsed: 2,
        });
    });

    it('does not leak survivor fields onto other pool types', async () => {
        const { banterStandingsRow } = await import('../lib/banter');
        const out = banterStandingsRow({ userName: 'Dee', totalScore: 1, status: 'ALIVE' }, 'NFL_PICKEM');
        expect(out.status).toBeUndefined();
    });

    it('nulls a missing or malformed name rather than printing undefined', async () => {
        const { banterStandingsRow } = await import('../lib/banter');
        expect(banterStandingsRow({}, 'NFL_PICKEM')).toEqual({ rank: null, name: null, seasonPoints: null });
        expect(banterStandingsRow({ userName: '   ' }, 'NFL_PICKEM').name).toBeNull();
        expect(banterStandingsRow({ totalScore: 'lots' }, 'NFL_PICKEM').seasonPoints).toBeNull();
    });

    it('a zero score is kept, not nulled', async () => {
        // `?? null` on a truthiness check would erase every unplayed pool's row.
        const { banterStandingsRow } = await import('../lib/banter');
        expect(banterStandingsRow({ userName: 'Eve', totalScore: 0 }, 'NFL_PICKEM').seasonPoints).toBe(0);
        expect(banterStandingsRow({ rank: 0, userName: 'Eve' }, 'NFL_PICKEM').rank).toBe(0);
    });
});
