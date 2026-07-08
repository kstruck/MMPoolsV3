import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { createNFLPool, joinNFLPool, executeSurvivorRebuy } from '../../nflPools';

// Verifies the additive Member Record wiring (ADR 0003) against a live Firestore
// emulator: create seeds the owner's record, join seeds the joiner's, and a survivor
// rebuy adds rebuy dues to the member's record. Existing entry/participantIds logic is
// unchanged (covered by poolCreation.emulator + the NFL unit suite).
const test = ftest();
const db = admin.firestore();
const wrappedCreateNFL = test.wrap(createNFLPool);
const wrappedJoin = test.wrap(joinNFLPool);
const wrappedRebuy = test.wrap(executeSurvivorRebuy);

async function seedUser(uid: string, name: string, role = 'PARTICIPANT') {
  await db.collection('users').doc(uid).set({ role, name, email: `${uid}@example.com` });
}

async function wipe() {
  const pools = await db.collection('pools').get();
  for (const p of pools.docs) {
    for (const sub of ['members', 'entries', 'participants']) {
      const s = await p.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await p.ref.delete();
  }
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    for (const sub of ['managedPools', 'participations', 'activity']) {
      const s = await u.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await u.ref.delete();
  }
}

beforeEach(wipe);
afterAll(() => test.cleanup());

describe('Member Record wiring (emulator)', () => {
  it('createNFLPool seeds the owner Member Record (MANAGER, UNPAID)', async () => {
    await seedUser('owner1', 'Owner One', 'MEMBER');
    const res = (await wrappedCreateNFL({
      data: { type: 'NFL_PICKEM', name: 'Weekly', season: '2025', settings: { entryFee: 20, isListedPublic: true, payouts: { places: [], bonuses: [] } } },
      auth: { uid: 'owner1', token: { name: 'Owner One' } },
    } as never)) as { poolId: string };

    const m = (await db.collection('pools').doc(res.poolId).collection('members').doc('owner1').get()).data() as Record<string, any>;
    expect(m).toBeTruthy();
    expect(m.role).toBe('MANAGER');
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.userName).toBe('Owner One');
  });

  it('joinNFLPool seeds the joiner Member Record', async () => {
    await seedUser('owner2', 'Owner Two', 'MEMBER');
    await seedUser('joiner2', 'Joiner Two');
    const res = (await wrappedCreateNFL({
      data: { type: 'NFL_PICKEM', name: 'Weekly2', season: '2025', settings: { entryFee: 10, isListedPublic: true, payouts: { places: [], bonuses: [] } } },
      auth: { uid: 'owner2', token: { name: 'Owner Two' } },
    } as never)) as { poolId: string };

    await wrappedJoin({ data: { poolId: res.poolId }, auth: { uid: 'joiner2', token: { name: 'Joiner Two' } } } as never);

    const m = (await db.collection('pools').doc(res.poolId).collection('members').doc('joiner2').get()).data() as Record<string, any>;
    expect(m).toBeTruthy();
    expect(m.role).toBe('PARTICIPANT');
    expect(m.paidStatus).toBe('UNPAID');
    expect(m.userName).toBe('Joiner Two');
  });

  it('executeSurvivorRebuy adds rebuy dues to the Member Record', async () => {
    await seedUser('sp_owner', 'SP Owner');
    await seedUser('sp_player', 'SP Player');
    const poolId = 'survivor_pool_1';
    await db.collection('pools').doc(poolId).set({
      id: poolId, type: 'NFL_SURVIVOR', name: 'Survivor', ownerId: 'sp_owner', managerUid: 'sp_owner',
      participantIds: ['sp_owner', 'sp_player'], status: 'OPEN',
      settings: { entryFee: 25, rebuyCost: 15, maxRebuys: 2, rebuyDeadlineWeek: 6 },
    });
    await db.collection('pools').doc(poolId).collection('members').doc('sp_player').set({
      uid: 'sp_player', poolId, userName: 'SP Player', role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: Date.now(),
    });
    await db.collection('pools').doc(poolId).collection('entries').doc('sp_player').set({
      id: 'sp_player', poolId, ownerUid: 'sp_player', userName: 'SP Player', status: 'ELIMINATED',
      strikesUsed: 1, strikeWeeks: [1], rebuysUsed: 0, usedTeams: [], picks: {}, exemptWeeks: [], submittedAt: Date.now(), paidStatus: 'UNPAID',
    });

    await wrappedRebuy({ data: { poolId, week: 3 }, auth: { uid: 'sp_player', token: { name: 'SP Player' } } } as never);

    const m = (await db.collection('pools').doc(poolId).collection('members').doc('sp_player').get()).data() as Record<string, any>;
    expect(m.rebuyOwed).toBe(15);
  });
});
