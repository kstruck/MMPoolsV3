import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sendEmailMock = vi.fn(async () => 'queued');
vi.mock('../reminders', () => ({ sendEmail: (...a: unknown[]) => (sendEmailMock as any)(...a) }));
const getUserMock = vi.fn();
vi.mock('firebase-admin', () => ({ auth: () => ({ getUser: getUserMock }) }));

import { buildPickConfirmationEmail, pickConfirmationRows, sendNFLPickConfirmation, type PickConfirmationInput } from '../nflPickConfirmation';

/**
 * NFL pick confirmation email (reported missing 2026-09-16: bracket and playoff
 * entries emailed on submit, NFL picks never did).
 */

const game = (id: string, away: string, home: string, startTime: number) => ({
    id, startTime,
    awayTeam: { id: away, name: away, abbreviation: away },
    homeTeam: { id: home, name: home, abbreviation: home },
});
const GAMES = [game('g2', 'BUF', 'MIA', 2000), game('g1', 'KC', 'BAL', 1000), game('g3', 'DAL', 'NYG', 3000)];

const base = (over: Partial<PickConfirmationInput> = {}): PickConfirmationInput => ({
    poolType: 'NFL_PICKEM', poolName: 'Office Pool', poolId: 'p1', seasonType: 2, week: 3,
    recipientName: 'Sam', picks: {}, games: GAMES, ...over,
});

describe('pickConfirmationRows', () => {
    it("pick'em lists this week's picked games in kickoff order, with confidence points", () => {
        const rows = pickConfirmationRows(base({ picks: { g2: 'MIA', g1: 'KC', other: 'XX' }, confidence: { g1: 5, g2: 2 } }));
        expect(rows).toEqual([
            { pick: 'KC', matchup: 'KC @ BAL', points: 5 },
            { pick: 'MIA', matchup: 'BUF @ MIA', points: 2 },
        ]);
    });

    it('survivor and margin show the single team keyed by week', () => {
        for (const poolType of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
            expect(pickConfirmationRows(base({ poolType, picks: { '2': 'BUF', '3': 'DAL' } })))
                .toEqual([{ pick: 'DAL', matchup: 'DAL @ NYG' }]);
        }
    });

    it('survivor with no pick for the week yields no rows', () => {
        expect(pickConfirmationRows(base({ poolType: 'NFL_SURVIVOR', picks: { '2': 'BUF' } }))).toEqual([]);
    });
});

describe('buildPickConfirmationEmail', () => {
    it('names the pool and week in the subject and escapes user-supplied text in the body', () => {
        const { subject, html } = buildPickConfirmationEmail(base({
            poolName: '<b>Evil</b>', entryName: '"><script>x</script>', recipientName: '<img>',
            picks: { g1: 'KC' }, tiebreakerPrediction: 44,
        }));
        expect(subject).toBe('Picks saved: <b>Evil</b> — Week 3');
        expect(html).not.toContain('<script>x</script>');
        expect(html).not.toContain('<b>Evil</b>');
        expect(html).not.toContain('<img>');
        expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
        expect(html).toContain('Tiebreaker: <strong>44</strong>');
        expect(html).toContain('https://www.marchmeleepools.com/pool/p1');
    });

    it('uses the preseason week label for seasonType 1', () => {
        expect(buildPickConfirmationEmail(base({ seasonType: 1, week: 2, picks: { g1: 'KC' } })).subject)
            .not.toBe('Picks saved: Office Pool — Week 2');
    });

    it('omits the points column when no confidence is set', () => {
        expect(buildPickConfirmationEmail(base({ picks: { g1: 'KC' } })).html).not.toContain('Points');
    });
});

function fakeDb(pool: Record<string, unknown> | undefined, games = GAMES) {
    return {
        collection: (name: string) => {
            const q: any = {
                where: () => q,
                get: async () => ({ docs: games.map(g => ({ data: () => g })) }),
                doc: (id: string) => ({
                    get: async () => ({ data: () => (name === 'pools' ? pool : name === 'users' ? { name: `user-${id}` } : undefined) }),
                }),
            };
            return q;
        },
    } as any;
}

describe('sendNFLPickConfirmation', () => {
    beforeEach(() => { sendEmailMock.mockClear(); getUserMock.mockReset(); });

    it('queues one email to the token address with the pool context', async () => {
        await sendNFLPickConfirmation(fakeDb({ type: 'NFL_PICKEM', name: 'Office Pool', season: '2026', seasonType: 2 }), {
            uid: 'u1', email: 'a@b.com', poolId: 'p1', week: 3, picks: { g1: 'KC' },
        });
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        const [, to, subject, html, ctx] = sendEmailMock.mock.calls[0] as unknown as [unknown, string, string, string, Record<string, unknown>];
        expect(to).toBe('a@b.com');
        expect(subject).toBe('Picks saved: Office Pool — Week 3');
        expect(html).toContain('Hi user-u1');
        expect(ctx).toEqual({ type: 'nfl_picks_submitted', poolId: 'p1', uid: 'u1', week: 3 });
        expect(getUserMock).not.toHaveBeenCalled();
    });

    it('falls back to the Auth record when the token has no email', async () => {
        getUserMock.mockResolvedValue({ email: 'auth@b.com', displayName: 'Auth Name' });
        await sendNFLPickConfirmation(fakeDb({ type: 'NFL_SURVIVOR', name: 'S', season: '2026' }), {
            uid: 'u1', poolId: 'p1', week: 3, picks: { '3': 'DAL' },
        });
        expect(sendEmailMock.mock.calls[0]?.[1 as never]).toBe('auth@b.com');
    });

    it('never throws — a lookup failure is swallowed and nothing is sent', async () => {
        getUserMock.mockRejectedValue(new Error('auth down'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(sendNFLPickConfirmation(fakeDb({}), { uid: 'u1', poolId: 'p1', week: 3, picks: {} })).resolves.toBeUndefined();
        expect(sendEmailMock).not.toHaveBeenCalled();
        err.mockRestore();
    });

    it('sends nothing for a missing pool', async () => {
        await sendNFLPickConfirmation(fakeDb(undefined), { uid: 'u1', email: 'a@b.com', poolId: 'p1', week: 3, picks: {} });
        expect(sendEmailMock).not.toHaveBeenCalled();
    });
});

describe('wiring in nflPools.ts', () => {
    const src = readFileSync(join(__dirname, '..', 'nflPools.ts'), 'utf8');

    it('the submitNFLPicks callable sends the confirmation, skipping a replay', () => {
        const wrapper = src.slice(src.indexOf('export const submitNFLPicks = validated('), src.indexOf('export async function executeSurvivorRebuyInternal'));
        expect(wrapper).toContain('sendNFLPickConfirmation(db,');
        expect(wrapper).toMatch(/if \(!result\.replayed\)/);
    });

    it('the Internal (proxy picks, sim harness) never emails, and flags a requestId replay', () => {
        const internal = src.slice(src.indexOf('export async function submitNFLPicksInternal'), src.indexOf('export const submitNFLPicks = validated('));
        expect(internal).not.toContain('sendNFLPickConfirmation');
        expect(internal).toMatch(/lastRequestId === requestId\) \{\s*replayed = true;/);
        expect(internal).toContain('return replayed ? { success: true, replayed: true } : { success: true };');
    });
});
