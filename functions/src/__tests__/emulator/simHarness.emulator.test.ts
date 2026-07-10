import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { simWriteEntries, simUpdatePool, cleanupSimPool, simSeedNFLGames, simStartRun } from '../../simHarness';
import { maybeFinalizeNFLPool } from '../../nflFinalize';

// PLAN-TEST-SUITE 8e/8f emulator gate: the sim harness callables must refuse
// (a) non-SUPER_ADMIN callers, (b) pools without the run's simRunId, and
// (c) wrong-runId targets — and every refusal must still be an HttpsError,
// never a write. Run via `npm run test:emulator` (needs the Firestore emulator).
// Extended by PLAN-NFL-SIM-HARNESS Phase 0: run-scoped uids, namespace-field
// immutability, manifest lifecycle, off-pool residue purge, finalize sim guard.
const test = ftest();
const db = admin.firestore();

const wrappedWrite = test.wrap(simWriteEntries);
const wrappedUpdate = test.wrap(simUpdatePool);
const wrappedCleanup = test.wrap(cleanupSimPool);
const wrappedSeed = test.wrap(simSeedNFLGames);
const wrappedStart = test.wrap(simStartRun);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;
const commissioner = { uid: 'comm-1', token: { role: 'COMMISSIONER' } } as any;
const RUN = 'run-test-0001';
const UID_A = `sim-${RUN}-alice`; // run-scoped subject uid (Phase 0.6)

async function seedPool(id: string, data: Record<string, unknown>) {
    await db.collection('pools').doc(id).set(data);
}

beforeEach(async () => {
    for (const col of ['pools', 'users', 'publicProfiles', 'simRuns', 'consensus']) {
        const snap = await db.collection(col).get();
        await Promise.all(snap.docs.map(d => db.recursiveDelete(d.ref)));
    }
    const games = await db.collection('nfl_games').get();
    await Promise.all(games.docs.map(d => d.ref.delete()));
});

describe('sim harness — refusal paths', () => {
    it('rejects non-SUPER_ADMIN callers on every callable', async () => {
        for (const [fn, data] of [
            [wrappedWrite, { poolId: 'p', runId: RUN, entries: [{ ownerUid: 'sim-u1' }] }],
            [wrappedUpdate, { poolId: 'p', runId: RUN, patch: { status: 'COMPLETED' } }],
            [wrappedCleanup, { poolId: 'p', runId: RUN }],
            [wrappedSeed, { runId: RUN, games: [{ week: 1 }] }],
        ] as const) {
            await expect((fn as any)({ data, auth: commissioner } as never)).rejects.toThrow(/SUPER_ADMIN/);
        }
    });

    it('refuses a REAL pool (no simRunId) — the production-corruption guard', async () => {
        await seedPool('real-pool', { name: 'Real', ownerId: 'someone' });
        await expect(wrappedWrite({
            data: { poolId: 'real-pool', runId: RUN, entries: [{ ownerUid: 'sim-u1' }] },
            auth: superAdmin,
        } as never)).rejects.toThrow(/NOT_A_SIM_POOL/);
        await expect(wrappedCleanup({
            data: { poolId: 'real-pool', runId: RUN },
            auth: superAdmin,
        } as never)).rejects.toThrow(/NOT_A_SIM_POOL/);
    });

    it('refuses a sim pool from a DIFFERENT run', async () => {
        await seedPool('other-run-pool', { name: 'Sim', simRunId: 'run-other-9999' });
        await expect(wrappedUpdate({
            data: { poolId: 'other-run-pool', runId: RUN, patch: { status: 'COMPLETED' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/NOT_A_SIM_POOL/);
    });

    it('refuses fabricated entries whose ownerUid is not sim-namespaced', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN });
        await expect(wrappedWrite({
            data: { poolId: 'sim-pool', runId: RUN, entries: [{ ownerUid: 'real-user-uid' }] },
            auth: superAdmin,
        } as never)).rejects.toThrow(/must start with "sim-/);
    });

    it('refuses merely sim-prefixed uids that are not RUN-scoped (Phase 0.6)', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN });
        await expect(wrappedWrite({
            data: { poolId: 'sim-pool', runId: RUN, entries: [{ ownerUid: 'sim-user-alice' }] },
            auth: superAdmin,
        } as never)).rejects.toThrow(new RegExp(`must start with "sim-${RUN}-"`));
    });

    it('refuses ownership/billing patches even on a verified sim pool', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN });
        await expect(wrappedUpdate({
            data: { poolId: 'sim-pool', runId: RUN, patch: { ownerId: 'attacker' } },
            auth: superAdmin,
        } as never)).rejects.toThrow(/cannot be patched/);
    });

    it('refuses namespace-load-bearing patches: season/seasonType/type (Phase 0.5)', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN, season: `sim-${RUN}` });
        for (const patch of [{ season: '2025' }, { seasonType: 2 }, { type: 'NFL_PICKEM' }]) {
            await expect(wrappedUpdate({
                data: { poolId: 'sim-pool', runId: RUN, patch },
                auth: superAdmin,
            } as never)).rejects.toThrow(/cannot be patched/);
        }
    });

    it('refuses DOTTED-PATH patches into forbidden roots (qodo PR #156 finding)', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN, season: `sim-${RUN}`, billing: { status: 'free' } });
        for (const patch of [
            { 'billing.status': 'paid' },
            { 'ownerId.x': 'attacker' },
            { 'season.0': 'x' },
        ]) {
            await expect(wrappedUpdate({
                data: { poolId: 'sim-pool', runId: RUN, patch },
                auth: superAdmin,
            } as never)).rejects.toThrow(/cannot be patched/);
        }
        // billing untouched
        const pool = (await db.collection('pools').doc('sim-pool').get()).data();
        expect(pool?.billing?.status).toBe('free');
    });
});

describe('sim harness — finalize guard (Phase 0.1/0.2)', () => {
    it('maybeFinalizeNFLPool refuses a Test Pool unless allowSim is passed', async () => {
        await seedPool('sim-scored', {
            name: 'Sim', simRunId: RUN, season: `sim-${RUN}`, type: 'NFL_PICKEM',
            scoredThroughWeek: 1, scoredWeeks: { '1': true },
        });
        const refused = await maybeFinalizeNFLPool(db as any, 'sim-scored');
        expect(refused.finalized).toBe(false);
        expect(refused.reason).toMatch(/sim pool/);
        // With allowSim the guard is bypassed — it proceeds to the completeness
        // check (no games seeded => 'no games for season'), proving the override
        // reaches the real finalize path rather than a hard-coded refusal.
        const allowed = await maybeFinalizeNFLPool(db as any, 'sim-scored', { allowSim: true });
        expect(allowed.finalized).toBe(false);
        expect(allowed.reason).toMatch(/no games/);
    });
});

describe('sim harness — happy path + manifest lifecycle (Phase 0.3/0.7/0.8)', () => {
    it('writes run-scoped entries with simRunId stamp, tracks the manifest, purges all residue', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN, ownerId: 'admin-1', participantIds: ['admin-1'] });

        // Manifest opens at run start.
        await wrappedStart({ data: { runId: RUN, scenarioId: 'test-scn' }, auth: superAdmin } as never);
        let manifest = (await db.collection('simRuns').doc(RUN).get()).data();
        expect(manifest?.status).toBe('RUNNING');
        expect(manifest?.scenarioId).toBe('test-scn');

        await wrappedWrite({
            data: { poolId: 'sim-pool', runId: RUN, entries: [{ ownerUid: UID_A, picks: {} }] },
            auth: superAdmin,
        } as never);
        const entry = await db.collection('pools').doc('sim-pool').collection('entries').doc(UID_A).get();
        expect(entry.exists).toBe(true);              // docId === ownerUid invariant
        expect(entry.data()?.simRunId).toBe(RUN);     // Phase 0.3 stamp (trigger short-circuit)

        // Manifest tracked the pool and the subject.
        manifest = (await db.collection('simRuns').doc(RUN).get()).data();
        expect(manifest?.poolIds).toContain('sim-pool');
        expect(manifest?.simUids).toContain(UID_A);

        await wrappedUpdate({
            data: { poolId: 'sim-pool', runId: RUN, patch: { status: 'COMPLETED' } },
            auth: superAdmin,
        } as never);

        const seeded = await wrappedSeed({
            data: { runId: RUN, games: [{ week: 1, status: 'FINAL' }] },
            auth: superAdmin,
        } as never);
        expect(seeded.season).toBe(`sim-${RUN}`);
        const game = await db.collection('nfl_games').doc(`sim-${RUN}-g1`).get();
        expect(game.data()?.season).toBe(`sim-${RUN}`);

        // Fabricate the off-pool residue a real run would leave: sim-subject user tree
        // (seasonHistory), publicProfile, and a site-wide consensus doc for the sim season.
        await db.collection('users').doc(UID_A).collection('seasonHistory').doc('sim-pool').set({ finalRank: 1 });
        await db.collection('publicProfiles').doc(UID_A).set({ subjectKind: 'PLAYER' });
        await db.collection('consensus').doc(`sim-${RUN}_2_1`).collection('NFL_PICKEM').doc('g1').set({ total: 3 });

        const res = await wrappedCleanup({
            data: { poolId: 'sim-pool', runId: RUN, deleteGames: true },
            auth: superAdmin,
        } as never);
        expect(res.gamesDeleted).toBe(1);
        expect(res.subjectsPurged).toBe(1);
        expect(res.consensusDeleted).toBe(1);

        // Zero-residue contract (Phase 0.8): everything matching the run is gone…
        expect((await db.collection('pools').doc('sim-pool').get()).exists).toBe(false);
        expect((await db.collection('nfl_games').doc(`sim-${RUN}-g1`).get()).exists).toBe(false);
        expect((await db.collection('publicProfiles').doc(UID_A).get()).exists).toBe(false);
        expect((await db.collection('users').doc(UID_A).collection('seasonHistory').doc('sim-pool').get()).exists).toBe(false);
        expect((await db.collection('consensus').doc(`sim-${RUN}_2_1`).collection('NFL_PICKEM').doc('g1').get()).exists).toBe(false);
        // …EXCEPT the manifest, which survives as the run record, marked CLEANED.
        manifest = (await db.collection('simRuns').doc(RUN).get()).data();
        expect(manifest?.status).toBe('CLEANED');
    });
});
