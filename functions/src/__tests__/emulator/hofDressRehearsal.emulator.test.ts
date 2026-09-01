import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import {
    simStartRun, simJoinMembers, simSubmitPicks, simSeedNFLGames,
    simFinalizePool, cleanupSimPool,
} from '../../simHarness';
import { scoreNFLWeek } from '../../nflPools';

/**
 * HOF DRESS REHEARSAL — the full pool lifecycle on a **seasonType 1** slate.
 *
 * WHY THIS EXISTS. `goldenArc.emulator.test.ts` certifies the real member-action
 * paths end to end, and every pool and every game in it is `seasonType: 2`
 * (REGULAR). The 2026 pilot opens on the **Hall of Fame game, seasonType 1**, so
 * the lifecycle the pilot will actually run had never been executed once. Other
 * suites do use seasonType 1 (`autoScore`, `finalizeSweepAndReplay`), but only
 * for the scheduled-job paths — never create → join → pick → lock → score →
 * finalize.
 *
 * Preseason is not regular season with a different number in a field:
 *
 *   - **HOF week is a ONE-GAME week.** Every other NFL week the code has been
 *     exercised against has 13-16. Confidence ranges, survivor team pools,
 *     margin team reuse and "is the week fully final" all key off the size of
 *     the slate.
 *   - **Preseason and regular season share week NUMBERS.** Preseason week 2 and
 *     regular week 2 both exist in `nfl_games`, so anything that queries by
 *     `week` without also constraining `seasonType` silently mixes two slates.
 *     That is the #319 defect class, and this file exercises it server-side.
 *   - **`seasonType` is OPTIONAL on a pool and unset means REGULAR** (`|| 2`,
 *     per `shared/schemas/nfl.ts`). A pool created through the wizard can
 *     legitimately omit it.
 *
 * DELIBERATE DESIGN NOTE — why lock behaviour uses relative offsets and the real
 * HOF instant is asserted separately. Pinning a lock test to
 * `2026-08-07T00:00Z` would make it pass today and fail forever after the game
 * kicks off: a test that expires is worse than no test. So kickoff-relative
 * behaviour uses `Date.now() ± hours`, and the real HOF constant gets its own
 * pure assertion that cannot rot.
 */
const test = ftest();
const db = admin.firestore();

const wStart = test.wrap(simStartRun);
const wJoin = test.wrap(simJoinMembers);
const wSubmit = test.wrap(simSubmitPicks);
const wSeed = test.wrap(simSeedNFLGames);
const wFinalize = test.wrap(simFinalizePool);
const wCleanup = test.wrap(cleanupSimPool);
const wScore = test.wrap(scoreNFLWeek);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;

// Claim+doc (PLAN-API-TRUST-BOUNDARY Phase 3): every SUPER_ADMIN claim must be
// backed by a users/{uid}.role doc; suites share one emulator DB and another
// file's wipe can delete it, so re-seed per test.
beforeEach(async () => {
    await db.collection('users').doc('admin-1').set({ role: 'SUPER_ADMIN' }, { merge: true });
});

const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });
const HOUR = 60 * 60 * 1000;

/** PRESEASON. The whole point of this file. */
const PRESEASON = 1;
/** REGULAR — used only to prove a preseason pool does not see these. */
const REGULAR = 2;

/**
 * The real Hall of Fame game: Carolina at Arizona, 2026-08-06 8:00pm ET, which
 * is `2026-08-07T00:00Z`. The UTC DATE being the 7th is correct — 8:00pm ET is
 * midnight UTC the next day — and docs mis-dated this for weeks by copying the
 * UTC date down as if it were the calendar date.
 */
const HOF_KICKOFF_UTC = '2026-08-07T00:00:00.000Z';
const HOF_AWAY = 'CAR';
const HOF_HOME = 'ARI';

async function seedPreseasonPool(
    poolId: string, runId: string, type: string, settings: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
) {
    await db.collection('pools').doc(poolId).set({
        name: `HOF ${type}`, type, league: 'NFL',
        season: `sim-${runId}`, seasonType: PRESEASON, simRunId: runId,
        ownerId: 'admin-1', participantIds: ['admin-1'],
        status: 'OPEN', billing: { status: 'free' }, settings,
        ...overrides,
    });
}

/** The HOF slate: exactly one game, CAR at ARI. */
const hofGame = (startTime: number, over: Record<string, unknown> = {}) => ({
    week: 1, seasonType: PRESEASON, startTime, status: 'SCHEDULED', isMonday: false,
    homeTeam: T(HOF_HOME), awayTeam: T(HOF_AWAY),
    scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    ...over,
});

describe('HOF dress rehearsal — the kickoff instant is what the feed says', () => {
    it('is 8:00pm ET on 2026-08-06, which is 2026-08-07T00:00Z — the UTC date is a day later ON PURPOSE', () => {
        const kickoff = new Date(HOF_KICKOFF_UTC);
        expect(kickoff.toISOString()).toBe(HOF_KICKOFF_UTC);
        expect(kickoff.getUTCFullYear()).toBe(2026);
        expect(kickoff.getUTCMonth() + 1).toBe(8);
        expect(kickoff.getUTCDate()).toBe(7);
        expect(kickoff.getUTCHours()).toBe(0);

        // 8:00pm on 2026-08-06 in New York (EDT, UTC-4) is the same instant.
        const et = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
            day: '2-digit', hour: '2-digit', hour12: false,
        }).formatToParts(kickoff);
        const part = (t: string) => et.find(p => p.type === t)!.value;
        expect(`${part('year')}-${part('month')}-${part('day')}`).toBe('2026-08-06');
        expect(part('hour')).toBe('20');
    });
});

describe('HOF dress rehearsal — PICK’EM through the real paths on a one-game preseason week', () => {
    const runId = 'run-hof-pickem';
    const poolId = `pool-${runId}`;
    const ALICE = `sim-${runId}-alice`;
    const BOB = `sim-${runId}-bob`;
    const gid = `sim-${runId}-g1`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'hof-pickem' }, auth: superAdmin } as never);
        await seedPreseasonPool(poolId, runId, 'NFL_PICKEM', {
            entryFee: 10, lockMode: 'PER_GAME', payoutMode: 'SEASON',
            pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] },
        });
        await wSeed({
            data: { runId, games: [hofGame(Date.now() + 2 * HOUR)] },
            auth: superAdmin,
        } as never);
    }, 30000);

    it('joins members and accepts a pre-kickoff pick on the single preseason game', async () => {
        await wJoin({
            data: { poolId, runId, members: [{ uid: ALICE, name: 'Alice' }, { uid: BOB, name: 'Bob' }] },
            auth: superAdmin,
        } as never);
        await wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { [gid]: HOF_AWAY }, tiebreakerPrediction: 31 },
            auth: superAdmin,
        } as never);
        await wSubmit({
            data: { poolId, runId, subjectUid: BOB, week: 1, picks: { [gid]: HOF_HOME }, tiebreakerPrediction: 44 },
            auth: superAdmin,
        } as never);

        const alice = (await db.collection('pools').doc(poolId).collection('entries').doc(ALICE).get()).data()!;
        expect(alice.picks[gid]).toBe(HOF_AWAY);
    }, 30000);

    it('locks the pick once the HOF game has kicked off (real per-game lock path)', async () => {
        await wSeed({
            data: { runId, games: [hofGame(Date.now() - HOUR, { status: 'IN_PROGRESS', scores: { home: 7, away: 3 } })] },
            auth: superAdmin,
        } as never);
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: ALICE, week: 1, picks: { [gid]: HOF_HOME } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/GAME_LOCKED/);
    }, 30000);

    it('scores, ranks and finalizes the one-game week with the real engine', async () => {
        // CAR 24, ARI 20 — Alice (CAR) right, Bob (ARI) wrong.
        await wSeed({
            data: {
                runId,
                games: [hofGame(Date.now() - 4 * HOUR, { status: 'FINAL', scores: { home: 20, away: 24 } })],
            },
            auth: superAdmin,
        } as never);
        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);

        const alice = (await db.collection('pools').doc(poolId).collection('entries').doc(ALICE).get()).data()!;
        const bob = (await db.collection('pools').doc(poolId).collection('entries').doc(BOB).get()).data()!;
        expect(alice.totalScore).toBe(1);
        expect(bob.totalScore).toBe(0);

        // The commissioner's HOF-night button is "Score & Recap Week 1", so the
        // recap and the member-readable standings projection are part of the
        // deliverable, not side effects. Asserting only entry.totalScore would
        // pass while members saw an empty leaderboard.
        const recap = (await db.collection('pools').doc(poolId)
            .collection('weekly_recaps').doc('week_1').get()).data();
        expect(recap).toBeTruthy();
        expect(recap!.week).toBe(1);

        const standings = (await db.collection('pools').doc(poolId)
            .collection('standings').doc('current').get()).data();
        expect(standings).toBeTruthy();
        expect(standings!.lastScoredWeek).toBe(1);
        expect(standings!.rows).toHaveLength(2);
        // Allowlist projection: no picks leak into the member-readable rows.
        for (const row of standings!.rows) {
            expect(row.picks).toBeUndefined();
            expect(row.confidence).toBeUndefined();
        }
        const top = standings!.rows.find((r: any) => (r.ownerUid ?? r.id) === ALICE);
        expect(top?.totalScore).toBe(1);

        const outcome = await wFinalize({ data: { poolId, runId }, auth: superAdmin } as never);
        expect(outcome.finalized).toBe(true);
        const hist = (await db.collection('users').doc(ALICE).collection('seasonHistory').doc(poolId).get()).data();
        expect(hist?.finalRank).toBe(1);
        expect(hist?.isChampion).toBe(true);
    }, 60000);

    it('cleans to zero residue', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
        expect((await db.collection('pools').doc(poolId).get()).exists).toBe(false);
        expect((await db.collection('nfl_games').doc(gid).get()).exists).toBe(false);
    }, 60000);
});

/**
 * CONFIDENCE MODE ON A ONE-GAME WEEK.
 *
 * `validateConfidenceValues` (nflScoringEngine.ts:130) computes the legal range
 * as `[17 - N .. 16]` where N is the size of the week's slate. That anchors the
 * TOP of the range at 16 rather than the bottom at 1, so for a 16-game week it
 * is the familiar 1..16 — but **on the one-game HOF week the only legal
 * confidence value is 16, and 1 is rejected.**
 *
 * That is surprising enough to be worth pinning, because "the highest-confidence
 * pick is worth the number of games" is the convention most players expect. It
 * is NOT a defect: `PickemPickEntry.tsx:94` computes the identical range
 * (`// Compute confidence range for this week: [17 - N .. 16]`), so client and
 * server agree and no submission is rejected in practice. Checked deliberately
 * — a client offering 1..N against a server demanding 16..16 would have failed
 * every confidence submission on HOF night.
 */
describe('HOF dress rehearsal — confidence mode on a one-game week', () => {
    const runId = 'run-hof-conf';
    const poolId = `pool-${runId}`;
    const DANA = `sim-${runId}-dana`;
    const gid = `sim-${runId}-g1`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'hof-confidence' }, auth: superAdmin } as never);
        await seedPreseasonPool(poolId, runId, 'NFL_PICKEM', {
            entryFee: 10, lockMode: 'WEEKLY', payoutMode: 'SEASON',
            pickMode: 'STRAIGHT', confidenceMode: true, payouts: { places: [], bonuses: [] },
        });
        await wSeed({ data: { runId, games: [hofGame(Date.now() + 2 * HOUR)] }, auth: superAdmin } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: DANA, name: 'Dana' }] }, auth: superAdmin } as never);
    }, 30000);

    it('REJECTS confidence 1 on a one-game week — the range is [16..16], not [1..1]', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: DANA, week: 1, picks: { [gid]: HOF_AWAY }, confidence: { [gid]: 1 } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/OUT_OF_RANGE_CONFIDENCE/);
    }, 30000);

    it('REJECTS a pick submitted with no confidence value at all', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: DANA, week: 1, picks: { [gid]: HOF_AWAY }, confidence: {} },
            auth: superAdmin,
        } as never)).rejects.toThrow(/INCOMPLETE_CONFIDENCE_SUBMISSION/);
    }, 30000);

    it('ACCEPTS confidence 16 and stores it, and the client computes the same range', async () => {
        await wSubmit({
            data: { poolId, runId, subjectUid: DANA, week: 1, picks: { [gid]: HOF_AWAY }, confidence: { [gid]: 16 } },
            auth: superAdmin,
        } as never);
        const entry = (await db.collection('pools').doc(poolId).collection('entries').doc(DANA).get()).data()!;
        expect(entry.confidence[gid]).toBe(16);
    }, 30000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

describe('HOF dress rehearsal — SURVIVOR on a one-game week (two teams, no hiding)', () => {
    const runId = 'run-hof-surv';
    const poolId = `pool-${runId}`;
    const ERIN = `sim-${runId}-erin`;
    const FRANK = `sim-${runId}-frank`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'hof-survivor' }, auth: superAdmin } as never);
        await seedPreseasonPool(poolId, runId, 'NFL_SURVIVOR', {
            entryFee: 20, maxStrikes: 0, pickLosersMode: false, autoSurviveExemption: false,
            maxRebuys: 0, rebuyDeadlineWeek: 0, rebuyCost: 0, payouts: { places: [], bonuses: [] },
        });
        await wSeed({ data: { runId, games: [hofGame(Date.now() + 2 * HOUR)] }, auth: superAdmin } as never);
        await wJoin({
            data: { poolId, runId, members: [{ uid: ERIN, name: 'Erin' }, { uid: FRANK, name: 'Frank' }] },
            auth: superAdmin,
        } as never);
    }, 30000);

    it('splits the room across the only two available teams', async () => {
        await wSubmit({ data: { poolId, runId, subjectUid: ERIN, week: 1, picks: { 1: HOF_AWAY } }, auth: superAdmin } as never);
        await wSubmit({ data: { poolId, runId, subjectUid: FRANK, week: 1, picks: { 1: HOF_HOME } }, auth: superAdmin } as never);
        const erin = (await db.collection('pools').doc(poolId).collection('entries').doc(ERIN).get()).data()!;
        expect(erin.picks['1']).toBe(HOF_AWAY);
    }, 30000);

    it('eliminates exactly the half that picked the loser', async () => {
        // CAR 24, ARI 20 — Erin (CAR) survives, Frank (ARI) out.
        await wSeed({
            data: { runId, games: [hofGame(Date.now() - 4 * HOUR, { status: 'FINAL', scores: { home: 20, away: 24 } })] },
            auth: superAdmin,
        } as never);
        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);

        const erin = (await db.collection('pools').doc(poolId).collection('entries').doc(ERIN).get()).data()!;
        const frank = (await db.collection('pools').doc(poolId).collection('entries').doc(FRANK).get()).data()!;
        expect(erin.status).toBe('ALIVE');
        expect(frank.status).toBe('ELIMINATED');
        expect(erin.usedTeams).toContain(HOF_AWAY);
    }, 60000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

describe('HOF dress rehearsal — MARGIN on a one-game week', () => {
    const runId = 'run-hof-margin';
    const poolId = `pool-${runId}`;
    const GINA = `sim-${runId}-gina`;
    const HANK = `sim-${runId}-hank`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'hof-margin' }, auth: superAdmin } as never);
        await seedPreseasonPool(poolId, runId, 'NFL_MARGIN', {
            entryFee: 25, payouts: { places: [], bonuses: [] },
        });
        await wSeed({ data: { runId, games: [hofGame(Date.now() + 2 * HOUR)] }, auth: superAdmin } as never);
        await wJoin({
            data: { poolId, runId, members: [{ uid: GINA, name: 'Gina' }, { uid: HANK, name: 'Hank' }] },
            auth: superAdmin,
        } as never);
    }, 30000);

    it('REJECTS a team that is not in the one-game slate', async () => {
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: GINA, week: 1, picks: { 1: 'KC' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/TEAM_NOT_PLAYING/);
    }, 30000);

    it('scores the winner by margin and the loser by the negative margin', async () => {
        await wSubmit({ data: { poolId, runId, subjectUid: GINA, week: 1, picks: { 1: HOF_AWAY } }, auth: superAdmin } as never);
        await wSubmit({ data: { poolId, runId, subjectUid: HANK, week: 1, picks: { 1: HOF_HOME } }, auth: superAdmin } as never);

        // CAR 24, ARI 20 — a 4-point margin.
        await wSeed({
            data: { runId, games: [hofGame(Date.now() - 4 * HOUR, { status: 'FINAL', scores: { home: 20, away: 24 } })] },
            auth: superAdmin,
        } as never);
        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);

        const gina = (await db.collection('pools').doc(poolId).collection('entries').doc(GINA).get()).data()!;
        const hank = (await db.collection('pools').doc(poolId).collection('entries').doc(HANK).get()).data()!;
        expect(gina.weeklyScores['1']).toBe(4);
        expect(hank.weeklyScores['1']).toBe(-4);
        expect(gina.seasonTotal).toBe(4);
        expect(hank.negativeBurden).toBe(4);
    }, 60000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

/**
 * CROSS-SEASON-TYPE CONTAMINATION — the #319 defect class, server-side.
 *
 * Preseason week 2 (the 2026-08-13 slate) and regular week 2 both exist in
 * `nfl_games` and share a week NUMBER. Any query that constrains `week` without
 * also constraining `seasonType` mixes them. This seeds both into one sim season
 * and proves the preseason pool's scorer sees only the preseason game.
 *
 * It bites on 08-13, not on HOF night: prod regular-season week 1 currently has
 * ZERO documents, so week 1 cannot collide. Week 2 can.
 */
describe('HOF dress rehearsal — a preseason pool must not see the regular-season slate of the same week', () => {
    const runId = 'run-hof-crosstype';
    const poolId = `pool-${runId}`;
    const IVY = `sim-${runId}-ivy`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'hof-crosstype' }, auth: superAdmin } as never);
        await seedPreseasonPool(poolId, runId, 'NFL_PICKEM', {
            entryFee: 10, lockMode: 'PER_GAME', payoutMode: 'SEASON',
            pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] },
        });
        // Same season, same week NUMBER, two different season types. Seeded
        // SCHEDULED and in the FUTURE so picks are legal; concluded below.
        await wSeed({
            data: {
                runId,
                games: [
                    {
                        week: 2, seasonType: PRESEASON, startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED',
                        isMonday: false, homeTeam: T('ARI'), awayTeam: T('CAR'),
                        scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
                    },
                    {
                        week: 2, seasonType: REGULAR, startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED',
                        isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'),
                        scores: { home: 0, away: 0 }, spread: { value: -7, locked: true },
                    },
                ],
            },
            auth: superAdmin,
        } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: IVY, name: 'Ivy' }] }, auth: superAdmin } as never);
    }, 30000);

    it('REJECTS a pick on the regular-season game — it is not in this pool’s week', async () => {
        // Pinned to the specific message. A bare `.rejects.toThrow()` would also
        // pass on a typo in this test's own payload, which is the failure mode
        // that makes a guard look like it guards when it does not.
        await expect(wSubmit({
            data: { poolId, runId, subjectUid: IVY, week: 2, picks: { [`sim-${runId}-g2`]: 'KC' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/not found/i);
    }, 30000);

    it('scores ONLY the preseason game — a correct preseason pick is the whole score', async () => {
        await wSubmit({
            data: { poolId, runId, subjectUid: IVY, week: 2, picks: { [`sim-${runId}-g1`]: 'CAR' } },
            auth: superAdmin,
        } as never);
        // Conclude BOTH games. If the regular-season one leaked into this pool's
        // week it would now be a scoreable, unpicked game.
        await wSeed({
            data: {
                runId,
                games: [
                    {
                        week: 2, seasonType: PRESEASON, startTime: Date.now() - 4 * HOUR, status: 'FINAL',
                        isMonday: false, homeTeam: T('ARI'), awayTeam: T('CAR'),
                        scores: { home: 20, away: 24 }, spread: { value: -3, locked: true },
                    },
                    {
                        week: 2, seasonType: REGULAR, startTime: Date.now() - 4 * HOUR, status: 'FINAL',
                        isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'),
                        scores: { home: 31, away: 10 }, spread: { value: -7, locked: true },
                    },
                ],
            },
            auth: superAdmin,
        } as never);
        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 2 }, auth: superAdmin } as never);

        const ivy = (await db.collection('pools').doc(poolId).collection('entries').doc(IVY).get()).data()!;
        expect(ivy.totalScore).toBe(1);

        // The DISCRIMINATING assertion, and the reason totalScore alone is not
        // enough: `weeklyResults[week].games` is built over the pool's gradable
        // slate (`gradePickemGames`), so it holds one entry per game the scorer
        // considered part of this week. If the regular-season KC/BUF game leaked
        // in, this map would have TWO keys — and `totalScore` would still be 1,
        // because an unmade pick scores nothing. A leak is invisible in the score
        // and visible here.
        const graded = ivy.weeklyResults?.['2']?.games ?? {};
        expect(Object.keys(graded)).toEqual([`sim-${runId}-g1`]);
    }, 60000);

    /**
     * THE SCORER'S FILTER, ISOLATED — and why the test above does not cover it.
     *
     * `nflPools.ts` holds TWO independent `seasonType` filters: one on the
     * SUBMIT path (:367) and one on the SCORER (:1492). Deleting both fails the
     * test above. Deleting **only the scorer's** does not — mutation-tested, it
     * stayed green — because `gradePickemGames` skips games the entry never
     * picked (`if (!pick) continue`), and submit's own filter had already made
     * a regular-season pick impossible. So a leak confined to the scorer is
     * invisible in every entry field: the extra game is simply never graded.
     *
     * It would still be wrong. The scorer's slate is what decides whether a
     * week is fully final and what "N of M games" reads, so a preseason week 2
     * pulling in 16 regular-season games would misreport completeness even
     * though nobody's score moved.
     *
     * To reach that boundary the pick is written DIRECTLY onto the entry,
     * bypassing submit. That is deliberate: it is the only way to ask the
     * scorer, on its own, which slate it thinks it is scoring.
     */
    it('the SCORER’s own seasonType filter holds, tested independently of submit’s', async () => {
        const entryRef = db.collection('pools').doc(poolId).collection('entries').doc(IVY);
        // A pick on the REGULAR-season game, planted past the submit path.
        await entryRef.update({ [`picks.sim-${runId}-g2`]: 'KC' });

        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 2 }, auth: superAdmin } as never);

        const ivy = (await entryRef.get()).data()!;
        // KC won 31-10. If the scorer's slate included the regular-season game,
        // this planted pick would grade correct and the score would be 2.
        expect(ivy.totalScore).toBe(1);
        expect(Object.keys(ivy.weeklyResults?.['2']?.games ?? {})).toEqual([`sim-${runId}-g1`]);
    }, 60000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});

/**
 * THE UNSET-`seasonType` POOL. `shared/schemas/nfl.ts` makes the field optional
 * and documents that omitting it means REGULAR, and the wizard can legitimately
 * produce such a pool (`buildNFLPayload.test.ts` asserts it). #319 found that
 * member surfaces read it as a bare `Number(pool.seasonType)` — `NaN` when
 * unset, matching no game — so those pools rendered with no schedule at all.
 * This pins the SERVER half of that contract, which uses `|| 2`.
 */
describe('HOF dress rehearsal — a pool with NO seasonType behaves as REGULAR, not as nothing', () => {
    const runId = 'run-hof-unset';
    const poolId = `pool-${runId}`;
    const JOE = `sim-${runId}-joe`;

    beforeAll(async () => {
        await wStart({ data: { runId, scenarioId: 'hof-unset-seasontype' }, auth: superAdmin } as never);
        await db.collection('pools').doc(poolId).set({
            name: 'Unset seasonType', type: 'NFL_PICKEM', league: 'NFL',
            season: `sim-${runId}`, simRunId: runId, // <- seasonType deliberately ABSENT
            ownerId: 'admin-1', participantIds: ['admin-1'],
            status: 'OPEN', billing: { status: 'free' },
            settings: {
                entryFee: 10, lockMode: 'PER_GAME', payoutMode: 'SEASON',
                pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [], bonuses: [] },
            },
        });
        await wSeed({
            data: {
                runId,
                games: [
                    {
                        week: 1, seasonType: REGULAR, startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED',
                        isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'),
                        scores: { home: 0, away: 0 }, spread: { value: -7, locked: true },
                    },
                    {
                        week: 1, seasonType: PRESEASON, startTime: Date.now() + 2 * HOUR, status: 'SCHEDULED',
                        isMonday: false, homeTeam: T('ARI'), awayTeam: T('CAR'),
                        scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
                    },
                ],
            },
            auth: superAdmin,
        } as never);
        await wJoin({ data: { poolId, runId, members: [{ uid: JOE, name: 'Joe' }] }, auth: superAdmin } as never);
    }, 30000);

    it('accepts a pick on the REGULAR-season game and scores it', async () => {
        await wSubmit({
            data: { poolId, runId, subjectUid: JOE, week: 1, picks: { [`sim-${runId}-g1`]: 'KC' } },
            auth: superAdmin,
        } as never);
        await wSeed({
            data: {
                runId,
                games: [
                    {
                        week: 1, seasonType: REGULAR, startTime: Date.now() - 4 * HOUR, status: 'FINAL',
                        isMonday: false, homeTeam: T('KC'), awayTeam: T('BUF'),
                        scores: { home: 31, away: 10 }, spread: { value: -7, locked: true },
                    },
                    {
                        week: 1, seasonType: PRESEASON, startTime: Date.now() - 4 * HOUR, status: 'FINAL',
                        isMonday: false, homeTeam: T('ARI'), awayTeam: T('CAR'),
                        scores: { home: 20, away: 24 }, spread: { value: -3, locked: true },
                    },
                ],
            },
            auth: superAdmin,
        } as never);
        await db.collection('pools').doc(poolId).update({ scoredWeeks: {} });
        await wScore({ data: { poolId, week: 1 }, auth: superAdmin } as never);
        const joe = (await db.collection('pools').doc(poolId).collection('entries').doc(JOE).get()).data()!;
        expect(joe.totalScore).toBe(1);
    }, 60000);

    it('cleans up', async () => {
        await wCleanup({ data: { poolId, runId, deleteGames: true }, auth: superAdmin } as never);
    }, 60000);
});
