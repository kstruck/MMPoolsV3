import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { simWriteEntries, simUpdatePool, cleanupSimPool, simSeedNFLGames } from '../../simHarness';

// PLAN-TEST-SUITE 8e/8f emulator gate: the sim harness callables must refuse
// (a) non-SUPER_ADMIN callers, (b) pools without the run's simRunId, and
// (c) wrong-runId targets — and every refusal must still be an HttpsError,
// never a write. Run via `npm run test:emulator` (needs the Firestore emulator).
const test = ftest();
const db = admin.firestore();

const wrappedWrite = test.wrap(simWriteEntries);
const wrappedUpdate = test.wrap(simUpdatePool);
const wrappedCleanup = test.wrap(cleanupSimPool);
const wrappedSeed = test.wrap(simSeedNFLGames);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN' } } as any;
const commissioner = { uid: 'comm-1', token: { role: 'COMMISSIONER' } } as any;
const RUN = 'run-test-0001';

async function seedPool(id: string, data: Record<string, unknown>) {
    await db.collection('pools').doc(id).set(data);
}

beforeEach(async () => {
    const pools = await db.collection('pools').get();
    await Promise.all(pools.docs.map(d => db.recursiveDelete(d.ref)));
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
            await expect((fn as any)({ data, auth: commissioner })).rejects.toThrow(/SUPER_ADMIN/);
        }
    });

    it('refuses a REAL pool (no simRunId) — the production-corruption guard', async () => {
        await seedPool('real-pool', { name: 'Real', ownerId: 'someone' });
        await expect(wrappedWrite({
            data: { poolId: 'real-pool', runId: RUN, entries: [{ ownerUid: 'sim-u1' }] },
            auth: superAdmin,
        })).rejects.toThrow(/NOT_A_SIM_POOL/);
        await expect(wrappedCleanup({
            data: { poolId: 'real-pool', runId: RUN },
            auth: superAdmin,
        })).rejects.toThrow(/NOT_A_SIM_POOL/);
    });

    it('refuses a sim pool from a DIFFERENT run', async () => {
        await seedPool('other-run-pool', { name: 'Sim', simRunId: 'run-other-9999' });
        await expect(wrappedUpdate({
            data: { poolId: 'other-run-pool', runId: RUN, patch: { status: 'COMPLETED' } },
            auth: superAdmin,
        })).rejects.toThrow(/NOT_A_SIM_POOL/);
    });

    it('refuses fabricated entries whose ownerUid is not sim-namespaced', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN });
        await expect(wrappedWrite({
            data: { poolId: 'sim-pool', runId: RUN, entries: [{ ownerUid: 'real-user-uid' }] },
            auth: superAdmin,
        })).rejects.toThrow(/must start with "sim-"/);
    });

    it('refuses ownership/billing patches even on a verified sim pool', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN });
        await expect(wrappedUpdate({
            data: { poolId: 'sim-pool', runId: RUN, patch: { ownerId: 'attacker' } },
            auth: superAdmin,
        })).rejects.toThrow(/cannot be patched/);
    });
});

describe('sim harness — happy path', () => {
    it('writes entries keyed by ownerUid, updates, seeds namespaced games, cleans up', async () => {
        await seedPool('sim-pool', { name: 'Sim', simRunId: RUN, ownerId: 'admin-1', participantIds: ['admin-1'] });

        await wrappedWrite({
            data: { poolId: 'sim-pool', runId: RUN, entries: [{ ownerUid: 'sim-u-alice', picks: {} }] },
            auth: superAdmin,
        });
        const entry = await db.collection('pools').doc('sim-pool').collection('entries').doc('sim-u-alice').get();
        expect(entry.exists).toBe(true); // docId === ownerUid invariant

        await wrappedUpdate({
            data: { poolId: 'sim-pool', runId: RUN, patch: { status: 'COMPLETED' } },
            auth: superAdmin,
        });

        const seeded = await wrappedSeed({
            data: { runId: RUN, games: [{ week: 1, status: 'FINAL' }] },
            auth: superAdmin,
        });
        expect(seeded.season).toBe(`sim-${RUN}`);
        const game = await db.collection('nfl_games').doc(`sim-${RUN}-g1`).get();
        expect(game.data()?.season).toBe(`sim-${RUN}`);

        const res = await wrappedCleanup({
            data: { poolId: 'sim-pool', runId: RUN, deleteGames: true },
            auth: superAdmin,
        });
        expect(res.gamesDeleted).toBe(1);
        expect((await db.collection('pools').doc('sim-pool').get()).exists).toBe(false);
        expect((await db.collection('nfl_games').doc(`sim-${RUN}-g1`).get()).exists).toBe(false);
    });
});
