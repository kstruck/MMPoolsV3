import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sendEmailMock = vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'queued');
vi.mock('../reminders', () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));
const getUserMock = vi.fn();
vi.mock('firebase-admin', () => ({ auth: () => ({ getUser: getUserMock }) }));

import { buildPickConfirmationEmail, kickoffLabel, NFL_TEAM_NAMES, pickConfirmationRows, sendNFLPickConfirmation, type PickConfirmationInput } from '../nflPickConfirmation';

/**
 * NFL pick confirmation email (reported missing 2026-09-16: bracket and playoff
 * entries emailed on submit, NFL picks never did).
 */

const game = (id: string, away: string, home: string, startTime: number) => ({
    id, startTime,
    // The feed's `name` is the nickname only (measured on prod 2026-09-16).
    awayTeam: { id: away, name: `${away}-nick`, abbreviation: away },
    homeTeam: { id: home, name: `${home}-nick`, abbreviation: home },
});
// Thu Sep 17 2026 8:15 PM ET, Sun Sep 20 1:00 PM ET, Sun Sep 20 4:25 PM ET.
const THU = Date.UTC(2026, 8, 18, 0, 15);
const SUN1 = Date.UTC(2026, 8, 20, 17, 0);
const SUN4 = Date.UTC(2026, 8, 20, 20, 25);
const GAMES = [game('g2', 'BUF', 'MIA', SUN1), game('g1', 'KC', 'BAL', THU), game('g3', 'DAL', 'NYG', SUN4)];

const base = (over: Partial<PickConfirmationInput> = {}): PickConfirmationInput => ({
    poolType: 'NFL_PICKEM', poolName: 'Office Pool', poolId: 'p1', seasonType: 2, week: 3,
    recipientName: 'Sam', picks: {}, games: GAMES, ...over,
});

describe('kickoffLabel', () => {
    it('formats in Eastern time, DST-aware', () => {
        expect(kickoffLabel(THU)).toBe('Thu, Sep 17 · 8:15 PM ET');
        expect(kickoffLabel(SUN1)).toBe('Sun, Sep 20 · 1:00 PM ET');
        // November is EST (UTC-5), not EDT.
        expect(kickoffLabel(Date.UTC(2026, 10, 15, 18, 0))).toBe('Sun, Nov 15 · 1:00 PM ET');
    });

    it('is empty for a missing time', () => {
        expect(kickoffLabel(undefined)).toBe('');
        expect(kickoffLabel(NaN)).toBe('');
    });
});

describe('pickConfirmationRows', () => {
    it("pick'em lists this week's picked games in kickoff order, full names, which side, kickoff, points", () => {
        const rows = pickConfirmationRows(base({ picks: { g2: 'MIA', g1: 'KC', other: 'XX' }, confidence: { g1: 5, g2: 2 } }));
        expect(rows).toEqual([
            { pick: 'Kansas City Chiefs', away: 'Kansas City Chiefs', home: 'Baltimore Ravens', pickedSide: 'away', kickoff: 'Thu, Sep 17 · 8:15 PM ET', points: 5 },
            { pick: 'Miami Dolphins', away: 'Buffalo Bills', home: 'Miami Dolphins', pickedSide: 'home', kickoff: 'Sun, Sep 20 · 1:00 PM ET', points: 2 },
        ]);
    });

    it('survivor and margin show the single team keyed by week', () => {
        for (const poolType of ['NFL_SURVIVOR', 'NFL_MARGIN']) {
            expect(pickConfirmationRows(base({ poolType, picks: { '2': 'BUF', '3': 'DAL' } })))
                .toEqual([{ pick: 'Dallas Cowboys', away: 'Dallas Cowboys', home: 'New York Giants', pickedSide: 'away', kickoff: 'Sun, Sep 20 · 4:25 PM ET' }]);
        }
    });

    it('an unknown abbreviation falls back to the feed name', () => {
        const rows = pickConfirmationRows(base({ picks: { g9: 'XYZ' }, games: [game('g9', 'XYZ', 'BAL', SUN1)] }));
        expect(rows[0]).toMatchObject({ pick: 'XYZ-nick', away: 'XYZ-nick', home: 'Baltimore Ravens' });
    });

    it('survivor with no pick for the week yields no rows', () => {
        expect(pickConfirmationRows(base({ poolType: 'NFL_SURVIVOR', picks: { '2': 'BUF' } }))).toEqual([]);
    });

    it('the team map covers all 32 teams', () => {
        expect(Object.keys(NFL_TEAM_NAMES)).toHaveLength(32);
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

    it('lists every pick with full names, the pick highlighted, kickoff and points — and uses no table', () => {
        const { html } = buildPickConfirmationEmail(base({ picks: { g1: 'KC', g2: 'MIA' }, confidence: { g1: 5, g2: 1 } }));
        expect(html).not.toMatch(/<table[\s>][\s\S]*Kansas City Chiefs/);
        expect(html).toContain('Kansas City Chiefs <span style="font-weight: normal; color: #4f46e5;">· 5 points</span>');
        expect(html).toContain('Miami Dolphins <span style="font-weight: normal; color: #4f46e5;">· 1 point</span>');
        expect(html).toContain('<strong style="color: #4f46e5;">Kansas City Chiefs</strong> at Baltimore Ravens');
        expect(html).toContain('Buffalo Bills at <strong style="color: #4f46e5;">Miami Dolphins</strong>');
        expect(html).toContain('Thu, Sep 17 · 8:15 PM ET');
        expect(html).toContain('Your Week 3 picks');
        // Picks come before the pool/entry details box.
        expect(html.indexOf('Kansas City Chiefs')).toBeLessThan(html.indexOf("Pick&#039;em · Week 3"));
    });

    it('a single survivor pick reads as singular', () => {
        const { html } = buildPickConfirmationEmail(base({ poolType: 'NFL_SURVIVOR', picks: { '3': 'DAL' } }));
        expect(html).toContain('Here is your pick:');
        expect(html).toContain('Your Week 3 pick</h3>');
        expect(html).toContain('<strong style="color: #4f46e5;">Dallas Cowboys</strong> at New York Giants');
    });

    it('uses the preseason week label for seasonType 1', () => {
        expect(buildPickConfirmationEmail(base({ seasonType: 1, week: 2, picks: { g1: 'KC' } })).subject)
            .not.toBe('Picks saved: Office Pool — Week 2');
    });

    it('shows no points when no confidence is set', () => {
        expect(buildPickConfirmationEmail(base({ picks: { g1: 'KC' } })).html).not.toMatch(/\d+ points?</);
    });
});

/** pools/{id}, users/{id}, and an nfl_games query. No entry reads exist to fake. */
interface FakeQuery {
    where: () => FakeQuery;
    get: () => Promise<{ docs: { data: () => unknown }[] }>;
    doc: (id: string) => { get: () => Promise<{ data: () => unknown }>; collection: () => never };
}
function fakeDb(pool: Record<string, unknown> | undefined, games = GAMES): Parameters<typeof sendNFLPickConfirmation>[0] {
    const snap = (data: unknown) => ({ data: () => data });
    const db = {
        collection: (name: string) => {
            if (name === 'entries') throw new Error('the sender must not re-read the entry (codex r2)');
            const q: FakeQuery = {
                where: () => q,
                get: async () => ({ docs: games.map(g => snap(g)) }),
                doc: (id: string) => ({
                    get: async () => snap(name === 'pools' ? pool : name === 'users' ? { name: `user-${id}` } : undefined),
                    collection: () => { throw new Error('the sender must not re-read the entry (codex r2)'); },
                }),
            };
            return q;
        },
    };
    return db as unknown as Parameters<typeof sendNFLPickConfirmation>[0];
}

const POOL = { type: 'NFL_PICKEM', name: 'Office Pool', season: '2026', seasonType: 2 };

describe('sendNFLPickConfirmation', () => {
    beforeEach(() => { sendEmailMock.mockClear(); getUserMock.mockReset(); getUserMock.mockResolvedValue({ email: 'a@b.com' }); });

    const sent = () => sendEmailMock.mock.calls[0] as unknown as [unknown, string, string, string, Record<string, unknown>];

    it('builds the email from the committed save it is handed', async () => {
        const saved = { entryId: 'u1', entryName: 'Sam #2', picks: { g1: 'KC', g2: 'MIA' }, tiebreaker: 44 };
        await sendNFLPickConfirmation(fakeDb(POOL), { uid: 'u1', poolId: 'p1', week: 3, saved });
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        const [, to, subject, html, ctx] = sent();
        expect(to).toBe('a@b.com');
        expect(subject).toBe('Picks saved: Office Pool — Week 3');
        expect(html).toContain('Hi user-u1');
        expect(html).toContain('<strong style="color: #4f46e5;">Kansas City Chiefs</strong> at Baltimore Ravens');
        expect(html).toContain('Buffalo Bills at <strong style="color: #4f46e5;">Miami Dolphins</strong>');
        expect(html).toContain('Sam #2');
        expect(html).toContain('Tiebreaker: <strong>44</strong>');
        expect(ctx).toEqual({ type: 'nfl_picks_submitted', poolId: 'p1', uid: 'u1', week: 3 });
        expect(getUserMock).toHaveBeenCalledWith('u1');
    });

    it('shows no tiebreaker when the save wrote none for the week (server dropped it)', async () => {
        await sendNFLPickConfirmation(fakeDb(POOL), { uid: 'u1', poolId: 'p1', week: 3, saved: { entryId: 'u1', picks: { g1: 'KC' }, tiebreaker: null } });
        expect(sent()[3]).not.toContain('Tiebreaker');
    });

    it("sends to the CURRENT Auth record's email — no token email is accepted at all (qodo #3 on #697)", async () => {
        getUserMock.mockResolvedValue({ email: 'auth@b.com', displayName: 'Auth Name' });
        await sendNFLPickConfirmation(fakeDb({ ...POOL, type: 'NFL_SURVIVOR' }), {
            uid: 'u1', poolId: 'p1', week: 3, saved: { entryId: 'u1', picks: { '3': 'DAL' } },
        });
        expect(sent()[1]).toBe('auth@b.com');
        expect(sent()[3]).toContain('<strong style="color: #4f46e5;">Dallas Cowboys</strong> at New York Giants');
    });

    it('never throws — a lookup failure is swallowed and nothing is sent', async () => {
        getUserMock.mockRejectedValue(new Error('auth down'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(sendNFLPickConfirmation(fakeDb(POOL), { uid: 'u1', poolId: 'p1', week: 3, saved: { entryId: 'u1' } })).resolves.toBeUndefined();
        expect(sendEmailMock).not.toHaveBeenCalled();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it('sends nothing for a missing pool', async () => {
        await sendNFLPickConfirmation(fakeDb(undefined), { uid: 'u1', poolId: 'p1', week: 3, saved: { entryId: 'u1', picks: {} } });
        expect(sendEmailMock).not.toHaveBeenCalled();
    });
});

describe('wiring in nflPools.ts', () => {
    const src = readFileSync(join(__dirname, '..', 'nflPools.ts'), 'utf8');

    it('the submitNFLPicks callable sends the confirmation only when an entry was committed', () => {
        const wrapper = src.slice(src.indexOf('export const submitNFLPicks = validated('), src.indexOf('export async function executeSurvivorRebuyInternal'));
        expect(wrapper).toMatch(/if \(committed\.entryId\) \{\s*await sendNFLPickConfirmation\(db,/);
        expect(wrapper).toContain('saved: committed,');
    });

    it('the Internal (proxy picks, sim harness) never emails', () => {
        const internal = src.slice(src.indexOf('export async function submitNFLPicksInternal'), src.indexOf('export const submitNFLPicks = validated('));
        expect(internal).not.toContain('sendNFLPickConfirmation');
    });
});

describe('recipient source', () => {
    it('the callable passes no token email to the sender', () => {
        const src = readFileSync(join(__dirname, '..', 'nflPools.ts'), 'utf8');
        const call = src.slice(src.indexOf('await sendNFLPickConfirmation(db, {'), src.indexOf('saved: committed,'));
        expect(call).not.toMatch(/email/);
    });
});
