import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { proxyPick } from '../../poolExceptions';

/**
 * A proxy pick must advance the Member Record's playable-entry latch.
 *
 * `proxyPick` writes `entries/{uid}` directly and, before 2026-07-31, never
 * touched the Member Record at all. When `hasPlayableEntry` became a persisted
 * field, that made this path able to produce a member with a committed entry
 * whose record still said they had never entered — and, for a MANAGER, dues
 * frozen at 0 forever, because `feeOwed` is stamped from the same fact.
 *
 * Found by cross-model review of the change that introduced the field, not by
 * writing it. Covered here rather than in the pure plan test because the defect
 * was a MISSING CALL in a transaction — nothing about `planMembershipWrite` was
 * wrong, so no unit test of it could have caught this.
 */
const test = ftest();
const db = admin.firestore();
const wProxy = test.wrap(proxyPick);

const COMMISH = { uid: 'commish-1', token: { role: 'SUPER_ADMIN' } } as any;
const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;

const POOL = 'pool-proxy-latch';
const TARGET = 'member-no-entry';
const SEASON = 'proxy-latch-season';
const GAME = 'proxy-latch-g1';

describe('proxyPick advances the playable-entry latch', () => {
    beforeAll(async () => {
        await db.collection('nfl_games').doc(GAME).set({
            id: GAME, season: SEASON, seasonType: 1, week: 1,
            startTime: Date.now() + 4 * HOUR, status: 'SCHEDULED', isMonday: false,
            homeTeam: T('ARI'), awayTeam: T('CAR'),
            scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
        });
        await db.collection('pools').doc(POOL).set({
            name: 'Proxy latch', type: 'NFL_PICKEM', league: 'NFL',
            season: SEASON, seasonType: 1,
            ownerId: 'commish-1', participantIds: ['commish-1', TARGET],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
        });
        // The member JOINED but never submitted: record present, latch false, no entry.
        await db.collection('pools').doc(POOL).collection('members').doc(TARGET).set({
            uid: TARGET, poolId: POOL, userName: 'Dana',
            role: 'PARTICIPANT', paidStatus: 'UNPAID',
            feeOwed: 25, feeOwedSource: 'LIVE', hasPlayableEntry: false,
        });
        await db.collection('users').doc(TARGET).set({ name: 'Dana' });
    }, 30000);

    it('starts from a member with an entry-less record and a FALSE latch', async () => {
        const m = (await db.collection('pools').doc(POOL).collection('members').doc(TARGET).get()).data()!;
        expect(m.hasPlayableEntry).toBe(false);
        expect((await db.collection('pools').doc(POOL).collection('entries').doc(TARGET).get()).exists).toBe(false);
    }, 30000);

    it('flips the latch to TRUE when the commissioner picks on their behalf', async () => {
        await wProxy({
            data: { poolId: POOL, targetUid: TARGET, week: 1, picks: { [GAME]: 'CAR' }, reason: 'Member texted their picks in' },
            auth: COMMISH,
        } as never);

        const entry = (await db.collection('pools').doc(POOL).collection('entries').doc(TARGET).get()).data();
        expect(entry?.picks?.[GAME]).toBe('CAR');

        const member = (await db.collection('pools').doc(POOL).collection('members').doc(TARGET).get()).data()!;
        // The assertion that fails without the ensureMemberRecord call.
        expect(member.hasPlayableEntry).toBe(true);
        // And the record is otherwise undisturbed — a proxy pick is not a payment.
        expect(member.paidStatus).toBe('UNPAID');
        expect(member.userName).toBe('Dana');
    }, 30000);
});

/**
 * A proxy pick must never MINT a Member Record.
 *
 * codex r3 on this change. `planMembershipWrite`'s create branch seeds
 * `paidStatus: 'UNPAID'`, and `proxyPick` has no payment context to seed it
 * correctly. On a legacy member with a PAID entry and no Member Record, the
 * first version of the latch fix minted an UNPAID record — and `buildPoolRoster`
 * PREFERS the Member Record over the entry, so the commissioner's next dashboard
 * snapshot marked a paid member unpaid and added their fee back to outstanding
 * dues.
 *
 * Advancing a latch must not be able to move money.
 */
describe('proxyPick never mints a Member Record', () => {
    const POOL2 = 'pool-proxy-legacy';
    const LEGACY = 'legacy-entry-only';

    beforeAll(async () => {
        await db.collection('pools').doc(POOL2).set({
            name: 'Legacy proxy', type: 'NFL_PICKEM', league: 'NFL',
            season: SEASON, seasonType: 1,
            ownerId: 'commish-1', participantIds: ['commish-1', LEGACY],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
        });
        // Legacy shape: a PAID entry and NO Member Record.
        await db.collection('pools').doc(POOL2).collection('entries').doc(LEGACY).set({
            id: LEGACY, poolId: POOL2, ownerUid: LEGACY, userName: 'Pat',
            picks: {}, totalScore: 0, paidStatus: 'PAID',
        });
        await db.collection('users').doc(LEGACY).set({ name: 'Pat' });
    }, 30000);

    it('leaves the paid legacy member with NO Member Record rather than an UNPAID one', async () => {
        await wProxy({
            data: { poolId: POOL2, targetUid: LEGACY, week: 1, picks: { [GAME]: 'ARI' }, reason: 'Called their pick in over the phone' },
            auth: COMMISH,
        } as never);

        // The pick landed...
        const entry = (await db.collection('pools').doc(POOL2).collection('entries').doc(LEGACY).get()).data()!;
        expect(entry.picks?.[GAME]).toBe('ARI');
        // ...and the entry's PAID status is untouched.
        expect(entry.paidStatus).toBe('PAID');

        // ...and no UNPAID record was minted over the top of it. This is the
        // assertion that fails if the `if (existingMember)` guard is removed.
        const member = await db.collection('pools').doc(POOL2).collection('members').doc(LEGACY).get();
        expect(member.exists).toBe(false);
    }, 30000);
});

/**
 * An EMPTY proxy payload must not latch play, and must not charge the manager.
 *
 * codex r4. `proxyPickSchema.picks` is a bare `z.record()` with only a max-50
 * refinement, so `picks: {}` is accepted and the Pick'em validation loop
 * iterates nothing. The latch fix would then mark the target as having a
 * playable entry for a call that committed no selection — and because
 * `planMembershipWrite` derives `feeOwed` from that same fact, a SEEDED MANAGER
 * would be upgraded from owing 0 to owing the full entry fee for a pick nobody
 * made.
 */
describe('an empty proxy payload does not latch play or move dues', () => {
    const POOL3 = 'pool-proxy-empty';
    const HOST = 'commish-1';

    beforeAll(async () => {
        await db.collection('pools').doc(POOL3).set({
            name: 'Empty proxy', type: 'NFL_PICKEM', league: 'NFL',
            season: SEASON, seasonType: 1,
            ownerId: HOST, participantIds: [HOST],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
        });
        // The seeded host: hosting is not playing, so dues start at 0.
        await db.collection('pools').doc(POOL3).collection('members').doc(HOST).set({
            uid: HOST, poolId: POOL3, userName: 'Commish', role: 'MANAGER',
            paidStatus: 'UNPAID', feeOwed: 0, feeOwedSource: 'LIVE', hasPlayableEntry: false,
        });
        await db.collection('users').doc(HOST).set({ name: 'Commish' });
    }, 30000);

    it('leaves the latch FALSE and dues at 0 after a proxy call with no picks', async () => {
        await wProxy({
            data: { poolId: POOL3, targetUid: HOST, week: 1, picks: {}, reason: 'Empty payload should be inert' },
            auth: COMMISH,
        } as never);

        const member = (await db.collection('pools').doc(POOL3).collection('members').doc(HOST).get()).data()!;
        expect(member.hasPlayableEntry).toBe(false);
        // The money assertion: hosting is still not playing.
        expect(member.feeOwed).toBe(0);
    }, 30000);

    it('still latches and charges once a REAL pick is proxied in', async () => {
        await wProxy({
            data: { poolId: POOL3, targetUid: HOST, week: 1, picks: { [GAME]: 'CAR' }, reason: 'Host phoned their pick in' },
            auth: COMMISH,
        } as never);

        const member = (await db.collection('pools').doc(POOL3).collection('members').doc(HOST).get()).data()!;
        expect(member.hasPlayableEntry).toBe(true);
        // Now they ARE playing, so the seeded 0 upgrades to the entry fee.
        expect(member.feeOwed).toBe(25);
    }, 30000);
});

/**
 * THE PAYLOAD SHAPE CONTRACT — the reason the Pick'em proxy pick never worked.
 *
 * `proxyPick` takes one `picks` record and the three NFL types key it two
 * different ways: Pick'em by GAME ID (the loop above), Survivor and Margin by
 * WEEK. `NFLManagerView` sent the week-keyed shape for all three, so on a
 * Pick'em pool every call died with `Game 3 not found in week 3` — a message
 * that reads like a schedule problem rather than a payload one.
 *
 * The client fix is a per-type switch (`src/utils/proxyPickPayload.ts`) and its
 * unit tests replay this validation loop. This is the same claim against the
 * REAL callable, so the two cannot drift: if the server ever accepted a
 * week-keyed Pick'em payload, the client's switch would be unnecessary and this
 * test would say so.
 */
describe('proxyPick — the picks map is keyed by pool type', () => {
    const POOL3 = 'pool-proxy-shape';
    const MEMBER = 'shape-member';

    beforeAll(async () => {
        await db.collection('pools').doc(POOL3).set({
            name: 'Proxy shape', type: 'NFL_PICKEM', league: 'NFL',
            season: SEASON, seasonType: 1,
            ownerId: 'commish-1', participantIds: ['commish-1', MEMBER],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 0, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
        });
        await db.collection('users').doc(MEMBER).set({ name: 'Sam' });
    }, 30000);

    it('REJECTS the week-keyed payload the manager used to send', async () => {
        // Reproduced against the live callable, not a replica. Week 1, so the
        // key is "1" — which is not a game id, and the message says so.
        await expect(wProxy({
            data: { poolId: POOL3, targetUid: MEMBER, week: 1, picks: { 1: 'CAR' }, reason: 'The payload as it shipped' },
            auth: COMMISH,
        } as never)).rejects.toThrow(/Game 1 not found in week 1/);

        // …and nothing was written, so the failure is total rather than partial.
        expect((await db.collection('pools').doc(POOL3).collection('entries').doc(MEMBER).get()).exists).toBe(false);
    }, 30000);

    it('ACCEPTS the game-keyed payload the fix sends', async () => {
        await wProxy({
            data: { poolId: POOL3, targetUid: MEMBER, week: 1, picks: { [GAME]: 'CAR' }, reason: 'The payload after the fix' },
            auth: COMMISH,
        } as never);
        const entry = (await db.collection('pools').doc(POOL3).collection('entries').doc(MEMBER).get()).data();
        expect(entry?.picks?.[GAME]).toBe('CAR');
    }, 30000);

    it('still refuses a team that is not playing in the game named', async () => {
        // The second half of the server's shape check, and the reason the client
        // resolves the team through the week's own slate rather than trusting a
        // dropdown that may be stale.
        await expect(wProxy({
            data: { poolId: POOL3, targetUid: MEMBER, week: 1, picks: { [GAME]: 'GB' }, reason: 'Team not in this game' },
            auth: COMMISH,
        } as never)).rejects.toThrow(/GB is not playing in game/);
    }, 30000);
});

/**
 * The other branch, which must NOT move. Survivor reads `picks[weekNum]`, so
 * "fixing" it to game ids would break the path that has always worked — this is
 * why the client's switch is per pool type rather than global.
 */
describe('proxyPick — Survivor still keys by week', () => {
    const POOL4 = 'pool-proxy-survivor-shape';
    const SURV = 'shape-survivor-member';

    beforeAll(async () => {
        await db.collection('pools').doc(POOL4).set({
            name: 'Proxy survivor shape', type: 'NFL_SURVIVOR', league: 'NFL',
            season: SEASON, seasonType: 1,
            ownerId: 'commish-1', participantIds: ['commish-1', SURV],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 0, maxStrikes: 1 },
        });
        await db.collection('users').doc(SURV).set({ name: 'Robin' });
    }, 30000);

    it('accepts the week-keyed payload and refuses a game-keyed one', async () => {
        await wProxy({
            data: { poolId: POOL4, targetUid: SURV, week: 1, picks: { 1: 'CAR' }, reason: 'Week-keyed, as Survivor requires' },
            auth: COMMISH,
        } as never);
        const entry = (await db.collection('pools').doc(POOL4).collection('entries').doc(SURV).get()).data();
        expect(entry?.picks?.['1']).toBe('CAR');

        await expect(wProxy({
            data: { poolId: POOL4, targetUid: SURV, week: 1, picks: { [GAME]: 'ARI' }, reason: 'Game-keyed, which Survivor cannot read' },
            auth: COMMISH,
        } as never)).rejects.toThrow(/Missing team selection for week 1/);
    }, 30000);
});
