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
