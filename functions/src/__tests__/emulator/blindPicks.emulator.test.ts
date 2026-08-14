import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import './setup';
import { submitNFLPicksInternal } from '../../nflPools';
import { proxyPick } from '../../poolExceptions';
import { getPoolPicks } from '../../nflPickReveal';

/**
 * PLAN-COMMISSIONER-BLIND-PICKS, the two halves that only a write path can prove.
 *
 * T1 — the `pickedWeeks` marker on the Member Record. It rides the write the
 * submit transaction already makes, so a unit test of `planMembershipWrite`
 * proves the DECISION and nothing about whether the decision is reached. The
 * marker's whole job is to make the standings cell honest, so "the field is on
 * the document afterwards" is the assertion that matters.
 *
 * T2 — `getPoolPicks`' authorization. It is the one genuinely dangerous artifact
 * in the plan: it is the door that replaces the owner/manager entry read that
 * firestore.rules no longer serves. Its NEGATIVE cases are the point — a manager
 * before the boundary, a MIXED-LOCKED week, a non-manager, a non-member.
 */
const test = ftest();
const db = admin.firestore();
const wProxy = test.wrap(proxyPick);
const wGetPicks = test.wrap(getPoolPicks);

const HOUR = 60 * 60 * 1000;
const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

/**
 * ⚠️ ONE SEASON PER SUITE. `getPoolPicks` resolves a week's slate by
 * (season, seasonType, week) — exactly as the submit path and the scorer do — so
 * two pools sharing a season also share every week's games. An earlier revision
 * of this file used one season throughout and the mixed-lock suite's week 1
 * silently picked up the marker suite's games.
 */
const OWNER = 'blind-owner';
const ALICE = 'blind-alice';
const BOB = 'blind-bob';
const OUTSIDER = 'blind-outsider';

const asOwner = { uid: OWNER, token: {} } as any;
const asAlice = { uid: ALICE, token: {} } as any;
const asOutsider = { uid: OUTSIDER, token: {} } as any;
const ADMIN = 'blind-admin';
const asSuperAdmin = { uid: ADMIN, token: { role: 'SUPER_ADMIN' } } as any;
/**
 * A token that CLAIMS SUPER_ADMIN with no matching `users/{uid}.role` — the
 * demoted-but-not-yet-refreshed shape. `assertCallerRole` requires both to
 * agree, so this principal must NOT get the elevated read. (qodo #6.)
 */
const STALE_ADMIN = 'blind-stale-admin';
const asStaleAdmin = { uid: STALE_ADMIN, token: { role: 'SUPER_ADMIN' } } as any;

/** A commissioner with no SUPER_ADMIN claim — the principal this plan blinds. */
const asProxyCommish = { uid: OWNER, token: {} } as any;

async function seedGame(season: string, id: string, week: number, startTime: number) {
    await db.collection('nfl_games').doc(id).set({
        id, espnGameId: id, season, seasonType: 1, week,
        startTime, status: 'SCHEDULED', isMonday: false,
        homeTeam: T('KC'), awayTeam: T('BUF'),
        scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    });
}

async function seedPool(season: string, poolId: string, type: string, extra: Record<string, unknown> = {}) {
    await db.collection('pools').doc(poolId).set({
        name: poolId, type, league: 'NFL', season, seasonType: 1,
        ownerId: OWNER, participantIds: [OWNER, ALICE, BOB],
        status: 'OPEN', billing: { status: 'free' },
        settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
        ...extra,
    });
}

async function seedMember(poolId: string, uid: string, over: Record<string, unknown> = {}) {
    await db.collection('pools').doc(poolId).collection('members').doc(uid).set({
        uid, poolId, userName: uid, role: uid === OWNER ? 'MANAGER' : 'PARTICIPANT',
        paidStatus: 'UNPAID', joinedAt: Date.now(), feeOwed: 25, feeOwedSource: 'LIVE',
        // NOTE: no `pickedWeeks`. That is the real shape a joined-but-not-yet-
        // submitted member has — the join path deliberately does not seed the
        // field, because it is also the backfill path for a legacy participant
        // whose pick history is unknown (codex r3). So these suites exercise the
        // heal-from-absent path rather than a pre-seeded array.
        hasPlayableEntry: false,
        ...over,
    });
}

const memberDoc = (poolId: string, uid: string) =>
    db.collection('pools').doc(poolId).collection('members').doc(uid).get().then(s => s.data());

/**
 * TEARDOWN. Without it this suite's pools, games and users stay in the emulator
 * for the rest of the run, and every OTHER emulator suite that wipes by scanning
 * whole collections pays for them — which is how these suites become
 * order-dependent and slow (qodo #7 on this PR; the same fix invitePath took).
 *
 * `recursiveDelete` on the pool so `members` and `entries` go with it. Every
 * delete is best-effort: a suite that failed partway through must still clean
 * what it did create rather than throwing in teardown and hiding the real
 * failure.
 */
const CREATED_POOLS = [
    'blind-submit-pool', 'blind-submit-weekly-pool', 'blind-proxy-pool',
    'blind-reveal-pickem', 'blind-reveal-survivor-open', 'blind-reveal-survivor-locked',
    'blind-bracket-pool', 'blind-plain-commish',
];
const CREATED_GAMES = [
    'blind-submit-g1', 'blind-submit-g2', 'blind-weekly-w1-g', 'blind-weekly-w2-g',
    'blind-proxy-g1', 'blind-reveal-locked', 'blind-reveal-open',
    'blind-surv-future-1', 'blind-surv-future-2', 'blind-surv-past-1', 'blind-surv-past-2',
    'blind-plain-future-g',
];
const CREATED_USERS = [ALICE, BOB, OWNER, ADMIN, STALE_ADMIN, 'blind-legacy-no-record'];

afterAll(async () => {
    for (const id of CREATED_POOLS) {
        await db.recursiveDelete(db.collection('pools').doc(id)).catch(() => undefined);
    }
    for (const id of CREATED_GAMES) {
        await db.collection('nfl_games').doc(id).delete().catch(() => undefined);
    }
    for (const uid of CREATED_USERS) {
        await db.recursiveDelete(db.collection('users').doc(uid)).catch(() => undefined);
    }
    await test.cleanup();
});

// ---------------------------------------------------------------------------
// T1 — the marker
// ---------------------------------------------------------------------------

describe('T1 — submitNFLPicks writes the pickedWeeks marker', () => {
    const SEASON = 'blind-submit-season';
    const POOL = 'blind-submit-pool';
    const GAME = 'blind-submit-g1';

    beforeAll(async () => {
        await seedGame(SEASON, GAME, 1, Date.now() + 4 * HOUR);
        await seedPool(SEASON, POOL, 'NFL_PICKEM');
        await seedMember(POOL, ALICE);
        await db.collection('users').doc(ALICE).set({ name: 'Alice' });
        // The SUPER_ADMIN's PROFILE role, not just their token claim. Required
        // as of qodo #6: `assertCallerRole` demands both agree.
        await db.collection('users').doc(ADMIN).set({ name: 'Admin', role: 'SUPER_ADMIN' });
    }, 30000);

    it('marks the week on the Member Record, and only that week', async () => {
        await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE }, {
            poolId: POOL, week: 1, picks: { [GAME]: 'KC' },
        } as never);

        const m = await memberDoc(POOL, ALICE);
        expect(m?.pickedWeeks).toEqual([1]);
        // The marker says THAT a pick exists — never how many, never which.
        // Anything resembling a count or a team here is a leak: this document is
        // readable by every participant in the pool.
        expect(Object.keys(m || {}).some(k => /pick/i.test(k) && k !== 'pickedWeeks')).toBe(false);
    }, 30000);

    it('is idempotent across a re-submit of the same week', async () => {
        await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE }, {
            poolId: POOL, week: 1, picks: { [GAME]: 'BUF' },
        } as never);
        expect((await memberDoc(POOL, ALICE))?.pickedWeeks).toEqual([1]);
    }, 30000);

    /**
     * ⚠️ AN EMPTY SUBMISSION IS NOT A PICK. `submitNFLPicksSchema` permits
     * `picks: {}` for pick'em and the handler does not require a selection, so
     * without the `committedPickForWeek` gate the entry write would still mark
     * the week — and the standings cell would read "Hidden" for a pick nobody
     * made, which is a worse lie than the one the marker exists to fix.
     * (codex r2 on this PR. Survivor and Margin throw on a missing team, so this
     * is a pick'em-only hazard.)
     */
    it('an EMPTY pickem submission does not mark the week', async () => {
        await seedMember(POOL, BOB);
        await db.collection('users').doc(BOB).set({ name: 'Bob' });
        await submitNFLPicksInternal(db, { actorUid: BOB, subjectUid: BOB }, {
            poolId: POOL, week: 1, picks: {},
        } as never);
        // Absent, not `[]`: nothing was reported, so nothing is claimed.
        expect((await memberDoc(POOL, BOB))?.pickedWeeks).toBeUndefined();
    }, 30000);

    /**
     * A WEEKLY-lock pick'em pool has no per-game validation loop, so a gameId
     * belonging to another week reaches the entry write. Deriving the marker
     * from THIS week's slate is what stops it marking the wrong week.
     */
    it('picks whose games belong to another week do not mark this week', async () => {
        const OTHER_POOL = 'blind-submit-weekly-pool';
        const OTHER_SEASON = 'blind-submit-weekly-season';
        const W1 = 'blind-weekly-w1-g';
        const W2 = 'blind-weekly-w2-g';
        await seedGame(OTHER_SEASON, W1, 1, Date.now() + 4 * HOUR);
        await seedGame(OTHER_SEASON, W2, 2, Date.now() + 30 * HOUR);
        await seedPool(OTHER_SEASON, OTHER_POOL, 'NFL_PICKEM', {
            settings: { entryFee: 25, lockMode: 'WEEKLY', pickMode: 'STRAIGHT', confidenceMode: false },
        });
        await seedMember(OTHER_POOL, ALICE);

        await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE }, {
            poolId: OTHER_POOL, week: 1, picks: { [W2]: 'KC' },
        } as never);
        expect((await memberDoc(OTHER_POOL, ALICE))?.pickedWeeks).toBeUndefined();

        // ...and a pick that IS on week 1's slate does mark it.
        await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE }, {
            poolId: OTHER_POOL, week: 1, picks: { [W1]: 'KC' },
        } as never);
        expect((await memberDoc(OTHER_POOL, ALICE))?.pickedWeeks).toEqual([1]);
    }, 30000);

    it('unions a second week rather than replacing the first', async () => {
        const GAME2 = 'blind-submit-g2';
        await seedGame(SEASON, GAME2, 2, Date.now() + 8 * HOUR);
        await submitNFLPicksInternal(db, { actorUid: ALICE, subjectUid: ALICE }, {
            poolId: POOL, week: 2, picks: { [GAME2]: 'KC' },
        } as never);
        expect((await memberDoc(POOL, ALICE))?.pickedWeeks).toEqual([1, 2]);
    }, 30000);
});

describe('T1 — proxyPick and the marker', () => {
    const SEASON = 'blind-proxy-season';
    const POOL = 'blind-proxy-pool';
    const GAME = 'blind-proxy-g1';
    const LEGACY = 'blind-legacy-no-record';

    beforeAll(async () => {
        await seedGame(SEASON, GAME, 1, Date.now() + 4 * HOUR);
        await db.collection('pools').doc(POOL).set({
            name: POOL, type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
            ownerId: OWNER, participantIds: [OWNER, BOB, LEGACY],
            status: 'OPEN', billing: { status: 'free' },
            settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
        });
        await seedMember(POOL, BOB);
        // The pinned legacy shape: a PAID entry and NO Member Record.
        await db.collection('pools').doc(POOL).collection('entries').doc(LEGACY).set({
            id: LEGACY, poolId: POOL, ownerUid: LEGACY, userName: 'Pat',
            picks: {}, totalScore: 0, paidStatus: 'PAID',
        });
        await db.collection('users').doc(BOB).set({ name: 'Bob' });
        await db.collection('users').doc(LEGACY).set({ name: 'Pat' });
    }, 30000);

    it('marks the week when the member ALREADY has a Member Record', async () => {
        await wProxy({
            data: { poolId: POOL, targetUid: BOB, week: 1, picks: { [GAME]: 'KC' }, reason: 'Bob texted his picks in' },
            auth: asSuperAdmin,
        } as never);
        expect((await memberDoc(POOL, BOB))?.pickedWeeks).toEqual([1]);
    }, 30000);

    /**
     * ⚠️ THE MONEY-SAFETY CASE, pinned as behaviour rather than left as a gap
     * nobody tests. `proxyPick` must NOT create a Member Record to carry the
     * marker: `planMembershipWrite`'s create branch seeds `paidStatus: 'UNPAID'`
     * and `buildPoolRoster` PREFERS a Member Record over entry evidence, so
     * minting one for this legacy PAID member would silently mark them unpaid
     * and add their fee back to outstanding dues.
     *
     * Advancing a DISPLAY LATCH must not be able to move money. The cost is that
     * this member's standings cell reads "—" until they submit for themselves,
     * and that is the correct trade.
     */
    it('creates NOTHING for a member with no record — no marker, no record, no payment touch', async () => {
        await wProxy({
            data: { poolId: POOL, targetUid: LEGACY, week: 1, picks: { [GAME]: 'BUF' }, reason: 'Pat phoned their pick in' },
            auth: asSuperAdmin,
        } as never);

        const entry = (await db.collection('pools').doc(POOL).collection('entries').doc(LEGACY).get()).data()!;
        expect(entry.picks?.[GAME]).toBe('BUF');   // the pick landed
        expect(entry.paidStatus).toBe('PAID');     // and their money is untouched

        const member = await db.collection('pools').doc(POOL).collection('members').doc(LEGACY).get();
        expect(member.exists).toBe(false);
    }, 30000);
});

// ---------------------------------------------------------------------------
// T2 — getPoolPicks
// ---------------------------------------------------------------------------

describe('T2 — getPoolPicks, PER_GAME pick\'em', () => {
    const SEASON = 'blind-reveal-pickem-season';
    const POOL = 'blind-reveal-pickem';
    const LOCKED_GAME = 'blind-reveal-locked';
    const OPEN_GAME = 'blind-reveal-open';

    beforeAll(async () => {
        // A MIXED-LOCKED week: one game kicked off an hour ago, one is 4h out.
        await seedGame(SEASON, LOCKED_GAME, 1, Date.now() - HOUR);
        await seedGame(SEASON, OPEN_GAME, 1, Date.now() + 4 * HOUR);
        await seedPool(SEASON, POOL, 'NFL_PICKEM');
        await seedMember(POOL, ALICE);
        await seedMember(POOL, BOB);
        await db.collection('pools').doc(POOL).collection('entries').doc(ALICE).set({
            id: ALICE, poolId: POOL, ownerUid: ALICE, userName: 'Alice',
            picks: { [LOCKED_GAME]: 'KC', [OPEN_GAME]: 'BUF' },
            weeklyTiebreakers: { 1: 44 },
        });
        await db.collection('pools').doc(POOL).collection('entries').doc(BOB).set({
            id: BOB, poolId: POOL, ownerUid: BOB, userName: 'Bob',
            picks: { [LOCKED_GAME]: 'BUF' },
        });
    }, 30000);

    /**
     * ⚠️ THE LEAK TEST, and the reason `getPoolPicks` assembles by allowlist
     * rather than filtering a copy of the entry. An entry document holds the
     * WHOLE sheet, so a callable authorized at week granularity hands back the
     * un-kicked-off games the moment the first one locks.
     */
    it('a commissioner gets ONLY the locked game in a mixed-locked week', async () => {
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOwner } as never);

        expect(res.revealedGameIds).toEqual([LOCKED_GAME]);
        expect(res.weekRevealed).toBe(false);
        expect(res.picks[ALICE]).toEqual({ [LOCKED_GAME]: 'KC' });
        expect(res.picks[ALICE][OPEN_GAME]).toBeUndefined();
        // The tiebreaker is a whole-week secret with no game to attach it to.
        expect(res.tiebreakers[ALICE]).toBeUndefined();
    }, 30000);

    it('counts are returned in full at any time — they carry no pick content', async () => {
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOwner } as never);
        // Alice picked both games, Bob one. This is what the roster's
        // completeness column and the reminder targeting need, and it is the
        // reading that must NOT be on the participant-readable Member Record.
        expect(res.counts[ALICE]).toBe(2);
        expect(res.counts[BOB]).toBe(1);
        expect(res.weekGameIds.sort()).toEqual([LOCKED_GAME, OPEN_GAME].sort());
    }, 30000);

    it('SUPER_ADMIN gets everything, boundary or no boundary', async () => {
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asSuperAdmin } as never);
        expect(res.weekRevealed).toBe(true);
        expect(res.picks[ALICE]).toEqual({ [LOCKED_GAME]: 'KC', [OPEN_GAME]: 'BUF' });
        expect(res.tiebreakers[ALICE]).toBe(44);
    }, 30000);

    /**
     * ⚠️ A SUPER_ADMIN CLAIM ALONE IS NOT PROOF. This principal's token says
     * SUPER_ADMIN and their `users/{uid}` doc does not — the shape a demoted
     * admin carries until their token refreshes. The elevated branch of this
     * callable returns every member's picks regardless of reveal timing, so
     * trusting the claim would leave a stale token with full pre-kickoff access
     * on the one door this plan built to close it. (qodo #6 on this PR.)
     *
     * They are not a member of this pool either, so the fall-through to
     * owner/manager refuses them outright.
     */
    it('a token claiming SUPER_ADMIN with no matching profile role is REFUSED', async () => {
        await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asStaleAdmin } as never))
            .rejects.toThrow(/members can read/i);
    }, 30000);

    it('a demoted admin who OWNS the pool keeps the owner view, not the elevated one', async () => {
        // Demotion costs the elevated read, not the pool they own. The owner's
        // answer is boundary-limited, so the un-kicked-off game stays hidden.
        await db.collection('users').doc(OWNER).set({ name: 'Owner' });
        const res: any = await wGetPicks({
            data: { poolId: POOL, week: 1 },
            auth: { uid: OWNER, token: { role: 'SUPER_ADMIN' } } as any,
        } as never);
        expect(res.weekRevealed).toBe(false);
        expect(res.revealedGameIds).toEqual([LOCKED_GAME]);
    }, 30000);

    /**
     * ⚠️ REVERSED ON PURPOSE. This used to assert *"an ordinary participant is
     * REFUSED — members gain nothing from this plan"*, which was
     * PLAN-COMMISSIONER-BLIND-PICKS Q5. Kevin's 2026-08-14 ruling reversed it:
     * members see other members' picks once the pool locks.
     *
     * 🛑 WHAT DID **NOT** CHANGE IS THE POINT OF THIS TEST. A participant is
     * admitted to the SAME reveal computation, so they get the locked game and
     * NOT the open one — identical to the commissioner. Changing WHO can call
     * this must never change WHEN a pick appears.
     */
    it("a participant is ADMITTED, and gets exactly the commissioner's reveal", async () => {
        const mine: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asAlice } as never);
        const boss: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOwner } as never);

        expect(mine.revealedGameIds).toEqual([LOCKED_GAME]);
        expect(mine.weekRevealed).toBe(false);
        // The reveal-bound fields are identical for both principals.
        expect(mine.picks).toEqual(boss.picks);
        expect(mine.confidence).toEqual(boss.confidence);
        expect(mine.tiebreakers).toEqual(boss.tiebreakers);
        // ...and the OPEN game is still hidden from them, which is the invariant
        // this reversal must not break.
        expect(mine.picks[BOB]?.[OPEN_GAME]).toBeUndefined();
    }, 30000);

    /**
     * 🛑 K1 — the one field that does NOT come along. `counts` is ungated by
     * reveal, so handing it to members would let everyone watch everyone else's
     * sheet fill in before kickoff ("Kevin 14 of 16" ticking to 15 says he is
     * still working). Kevin's ruling: withhold it until the week reveals.
     */
    it('a participant gets NO counts before the week reveals, while the commissioner does', async () => {
        const mine: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asAlice } as never);
        const boss: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOwner } as never);

        expect(mine.weekRevealed).toBe(false);
        expect(mine.counts).toEqual({});          // not zeroes — absent
        expect(boss.counts[ALICE]).toBe(2);       // the commissioner keeps it
    }, 30000);

    it('a non-member is still REFUSED', async () => {
        await expect(wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOutsider } as never))
            .rejects.toThrow(/members can read/i);
    }, 30000);

    /**
     * 🛑 D7/K8 — a member the pool no longer lists must vanish from EVERY map,
     * not merely from `picks`. Presence in `counts` alone still says "this
     * person is playing". Removal deletes the Member Record and pulls the uid
     * from `participantIds`; it does NOT delete the entry, which is what made
     * this reachable the moment participants were admitted.
     */
    it('a DEPARTED member is invisible to a participant and still visible to the commissioner', async () => {
        const GHOST = 'blind-ghost';
        await db.collection('pools').doc(POOL).collection('entries').doc(GHOST).set({
            id: GHOST, poolId: POOL, ownerUid: GHOST, userName: 'Ghost',
            picks: { [LOCKED_GAME]: 'DEN' },
        });
        // No Member Record and not in participantIds — i.e. removed.
        const mine: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asAlice } as never);
        expect(mine.picks[GHOST]).toBeUndefined();
        expect(mine.counts[GHOST]).toBeUndefined();
        expect(mine.confidence[GHOST]).toBeUndefined();
        expect(mine.tiebreakers[GHOST]).toBeUndefined();

        // The privileged contract is UNCHANGED — the filter is participant-only.
        const boss: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOwner } as never);
        expect(boss.picks[GHOST]).toEqual({ [LOCKED_GAME]: 'DEN' });

        await db.collection('pools').doc(POOL).collection('entries').doc(GHOST).delete();
    }, 30000);

    /**
     * ⚠️ THE WIDENING TEST. `assertPoolOwnerOrSuperAdmin` — the obvious helper to
     * reach for here — also admits `createdByUid` and a participant listed in
     * `coManagers`. The removed firestore.rules clause admitted neither, so using
     * it would make this callable a WIDER door to pick data than the raw read it
     * replaces. codex r1 on this PR.
     */
    it('a co-manager gets the PARTICIPANT view, never the commissioner one', async () => {
        // ⚠️ ADJUSTED, NOT WEAKENED. BOB is a seeded member, so after the
        // 2026-08-14 widening he is admitted — as a PARTICIPANT. The invariant
        // that matters is unchanged and is now asserted directly: being listed
        // in `coManagers` (or as `createdByUid`) must not buy the commissioner's
        // pre-reveal `counts`, which is the capability the helper would have
        // handed over.
        await db.collection('pools').doc(POOL).update({
            coManagers: [BOB], createdByUid: 'someone-else-entirely',
        });
        const asCo: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: { uid: BOB, token: {} } as any } as never);
        expect(asCo.counts).toEqual({});
        expect(asCo.revealedGameIds).toEqual([LOCKED_GAME]);
        // ...and the real owner is unaffected by a createdByUid that disagrees.
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: asOwner } as never);
        expect(res.revealedGameIds).toEqual([LOCKED_GAME]);
        await db.collection('pools').doc(POOL).update({ coManagers: [], createdByUid: OWNER });
    }, 30000);

    it('a distinct managerUid IS admitted — the rule named them', async () => {
        await db.collection('pools').doc(POOL).update({ managerUid: BOB });
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 1 }, auth: { uid: BOB, token: {} } as any } as never);
        expect(res.counts[ALICE]).toBe(2);
        await db.collection('pools').doc(POOL).update({ managerUid: admin.firestore.FieldValue.delete() });
    }, 30000);

    it('a week with no games reveals nothing and returns no picks', async () => {
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 9 }, auth: asOwner } as never);
        expect(res.weekGameIds).toEqual([]);
        expect(res.revealedGameIds).toEqual([]);
        expect(res.weekRevealed).toBe(false);
        expect(res.picks).toEqual({});
    }, 30000);
});

describe('T2 — getPoolPicks, weekly-hard-lock pools', () => {
    const SEASON = 'blind-reveal-survivor-season';
    const OPEN_POOL = 'blind-reveal-survivor-open';
    const LOCKED_POOL = 'blind-reveal-survivor-locked';

    beforeAll(async () => {
        // OPEN_POOL's week has a game already under way AND one still to come:
        // under a hard weekly lock the deadline is the EARLIEST kickoff, so this
        // week is in fact past its deadline. Use a wholly-future slate for the
        // pre-boundary case instead.
        await seedGame(SEASON, 'blind-surv-future-1', 3, Date.now() + 4 * HOUR);
        await seedGame(SEASON, 'blind-surv-future-2', 3, Date.now() + 30 * HOUR);
        await seedGame(SEASON, 'blind-surv-past-1', 4, Date.now() - 2 * HOUR);
        await seedGame(SEASON, 'blind-surv-past-2', 4, Date.now() + 24 * HOUR);

        for (const poolId of [OPEN_POOL, LOCKED_POOL]) {
            await seedPool(SEASON, poolId, 'NFL_SURVIVOR');
            await seedMember(poolId, ALICE);
            await db.collection('pools').doc(poolId).collection('entries').doc(ALICE).set({
                id: ALICE, poolId, ownerUid: ALICE, userName: 'Alice',
                picks: { 3: 'KC', 4: 'BUF' }, usedTeams: ['KC', 'BUF'],
            });
        }
    }, 30000);

    it('BEFORE the weekly deadline the commissioner gets a count and NO pick', async () => {
        const res: any = await wGetPicks({ data: { poolId: OPEN_POOL, week: 3 }, auth: asOwner } as never);
        expect(res.mode).toBe('WEEK');
        expect(res.weekRevealed).toBe(false);
        expect(res.picks[ALICE]).toBeUndefined();
        expect(res.counts[ALICE]).toBe(1);
    }, 30000);

    /**
     * The half a PER_GAME reading would get wrong: week 4's first game has
     * kicked off, so a per-game rule would reveal it — but a hard-weekly-lock
     * pool reveals the whole week at once, and here it is correct to do so
     * because the weekly deadline (the earliest kickoff) has passed.
     */
    it('AFTER the weekly deadline the commissioner gets the pick', async () => {
        const res: any = await wGetPicks({ data: { poolId: LOCKED_POOL, week: 4 }, auth: asOwner } as never);
        expect(res.weekRevealed).toBe(true);
        expect(res.picks[ALICE]).toEqual({ 4: 'BUF' });
    }, 30000);

    it('the un-revealed week of the SAME pool stays hidden', async () => {
        const res: any = await wGetPicks({ data: { poolId: LOCKED_POOL, week: 3 }, auth: asOwner } as never);
        expect(res.weekRevealed).toBe(false);
        expect(res.picks[ALICE]).toBeUndefined();
    }, 30000);
});

describe('T2 — getPoolPicks refuses non-NFL pools', () => {
    const BRACKET = 'blind-bracket-pool';

    beforeAll(async () => {
        await db.collection('pools').doc(BRACKET).set({
            name: BRACKET, type: 'BRACKET', ownerId: OWNER,
            participantIds: [OWNER, ALICE], status: 'LOCKED', billing: { status: 'free' },
        });
    }, 30000);

    // D4: bracket/playoff pools are single-lock and reveal by design. They never
    // lost their raw read, so they must not gain a second door to pick data.
    it('a BRACKET pool is out of scope', async () => {
        await expect(wGetPicks({ data: { poolId: BRACKET, week: 1 }, auth: asOwner } as never))
            .rejects.toThrow(/NFL season pools/i);
    }, 30000);

    it('an unknown pool is not-found', async () => {
        await expect(wGetPicks({ data: { poolId: 'no-such-pool', week: 1 }, auth: asOwner } as never))
            .rejects.toThrow(/not found/i);
    }, 30000);
});

describe('T2 — a commissioner without a SUPER_ADMIN claim is still blind', () => {
    // The whole point of the plan: the person who owns the pool is the principal
    // being restricted, and they are usually not a SUPER_ADMIN.
    const SEASON = 'blind-plain-commish-season';
    const POOL = 'blind-plain-commish';
    const FUTURE = 'blind-plain-future-g';

    beforeAll(async () => {
        await seedGame(SEASON, FUTURE, 5, Date.now() + 6 * HOUR);
        await seedPool(SEASON, POOL, 'NFL_PICKEM');
        await seedMember(POOL, ALICE);
        await db.collection('pools').doc(POOL).collection('entries').doc(ALICE).set({
            id: ALICE, poolId: POOL, ownerUid: ALICE, userName: 'Alice',
            picks: { [FUTURE]: 'KC' },
        });
    }, 30000);

    it('gets a count and nothing else before kickoff', async () => {
        const res: any = await wGetPicks({ data: { poolId: POOL, week: 5 }, auth: asProxyCommish } as never);
        expect(res.counts[ALICE]).toBe(1);
        expect(res.picks).toEqual({});
        expect(res.revealedGameIds).toEqual([]);
    }, 30000);
});
