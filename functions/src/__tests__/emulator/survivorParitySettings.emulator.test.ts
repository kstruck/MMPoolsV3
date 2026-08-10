import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { updatePoolSettings } from '../../poolOps';

/**
 * PLAN-SURVIVOR-PARITY-SCORING decision 4 — the once-scored refusal, WIRED.
 *
 * `survivorSettingsGate.test.ts` pins the decision logic. This pins that the
 * callable actually consults it, inside the transaction that writes, with the
 * entries read in that same transaction — none of which a pure test can reach.
 *
 * The failure it guards is specific: `updatePoolSettings` serializes only
 * LOCK-affecting settings today (`touchesLockSettings`), and a parity edit is
 * not one of those. Left on the plain-update branch it would skip the lease
 * check and the refusal entirely, and every unit test would still pass.
 */
const test = ftest();
const db = admin.firestore();
const wUpdate = test.wrap(updatePoolSettings);

const OWNER = 'sps-owner';
const MEMBER = 'sps-member';
const AUTH = { uid: OWNER, token: {} } as never;

const BASE_SETTINGS = {
  entryFee: 0,
  maxStrikes: 0,
  maxRebuys: 0,
  pickLosersMode: false,
  payouts: { places: [], bonuses: [] },
};

async function seedPool(
  poolId: string,
  pool: Record<string, unknown> = {},
  entries: Array<Record<string, unknown>> = [],
) {
  await db.collection('pools').doc(poolId).set({
    name: 'Survivor parity', type: 'NFL_SURVIVOR', league: 'NFL',
    season: 'sps-season', seasonType: 1,
    ownerId: OWNER, managerUid: OWNER, participantIds: [OWNER, MEMBER],
    status: 'OPEN', billing: { status: 'free' },
    settings: { ...BASE_SETTINGS, ...(pool.settings as object ?? {}) },
    ...pool,
  });
  for (const [i, entry] of entries.entries()) {
    await db.collection('pools').doc(poolId).collection('entries').doc(`${MEMBER}-${i}`).set(entry);
  }
}

const settingsOf = (poolId: string) =>
  db.collection('pools').doc(poolId).get().then(s => (s.data()?.settings ?? {}) as Record<string, unknown>);

describe('updatePoolSettings — survivor parity settings', () => {
  const POOL = 'pool-sps';

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('pools').doc(POOL));
  }, 60000);

  it('ACCEPTS a change on a pool that has never been scored', async () => {
    await seedPool(POOL);
    await wUpdate({
      data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, tieCountsAs: 'WIN', maxTeamUses: 2 } } },
      auth: AUTH,
    } as never);

    const settings = await settingsOf(POOL);
    expect(settings.tieCountsAs).toBe('WIN');
    expect(settings.maxTeamUses).toBe(2);
  }, 60000);

  it('REFUSES a change once a week has been published', async () => {
    await seedPool(POOL, { publishedWeeks: { 1: true } });
    await expect(
      wUpdate({
        data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, tieCountsAs: 'WIN' } } },
        auth: AUTH,
      } as never),
    ).rejects.toThrow(/SETTINGS_LOCKED_AFTER_SCORING/);
    expect((await settingsOf(POOL)).tieCountsAs).toBeUndefined();
  }, 60000);

  it('REFUSES on LEGACY scoring evidence, which carries no publication marker', async () => {
    await seedPool(POOL, { scoredThroughWeek: 2 });
    await expect(
      wUpdate({
        data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, maxTeamUses: 2 } } },
        auth: AUTH,
      } as never),
    ).rejects.toThrow(/SETTINGS_LOCKED_AFTER_SCORING/);
  }, 60000);

  it('ALLOWS an unrelated save on a scored pool — and does not disturb the parity fields', async () => {
    // The manager UI sends a complete settings object on every save, so this is
    // the ordinary path. A gate that refused it would be removed within a week.
    await seedPool(POOL, {
      publishedWeeks: { 1: true },
      settings: { ...BASE_SETTINGS, tieCountsAs: 'WIN', maxTeamUses: 3 },
    });
    await wUpdate({
      data: {
        poolId: POOL,
        updates: { settings: { ...BASE_SETTINGS, tieCountsAs: 'WIN', maxTeamUses: 3, maxStrikes: 2 } },
      },
      auth: AUTH,
    } as never);

    const settings = await settingsOf(POOL);
    expect(settings.maxStrikes).toBe(2);
    expect(settings.tieCountsAs).toBe('WIN');
    expect(settings.maxTeamUses).toBe(3);
  }, 60000);

  it('BOUNCES the edit while a scoring lease is live', async () => {
    // The race the transaction exists for: the manual scorer re-reads the pool
    // AFTER acquiring its lease, so an edit committing between that read and
    // publication would publish results computed under the OLD settings.
    await seedPool(POOL, {
      autoScore: { scoringLease: { owner: 'another-worker', until: Date.now() + 60_000 } },
    });
    await expect(
      wUpdate({
        data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, maxTeamUses: 2 } } },
        auth: AUTH,
      } as never),
    ).rejects.toThrow(/SCORING_IN_PROGRESS/);
  }, 60000);

  it('REFUSES a reduction that would strand an entry over the new limit', async () => {
    await seedPool(POOL, { settings: { ...BASE_SETTINGS, maxTeamUses: 0 } }, [
      { ownerUid: MEMBER, status: 'ALIVE', usedTeams: ['KC'], picks: { 1: 'KC', 2: 'KC' }, exemptWeeks: [] },
    ]);
    await expect(
      wUpdate({
        data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, maxTeamUses: 1 } } },
        auth: AUTH,
      } as never),
    ).rejects.toThrow(/TEAM_USE_LIMIT_TOO_LOW/);
    expect((await settingsOf(POOL)).maxTeamUses).toBe(0);
  }, 60000);

  it('ALLOWS the same reduction once no entry exceeds it', async () => {
    await seedPool(POOL, { settings: { ...BASE_SETTINGS, maxTeamUses: 0 } }, [
      { ownerUid: MEMBER, status: 'ALIVE', usedTeams: ['KC'], picks: { 1: 'KC', 2: 'BUF' }, exemptWeeks: [] },
    ]);
    await wUpdate({
      data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, maxTeamUses: 1 } } },
      auth: AUTH,
    } as never);
    expect((await settingsOf(POOL)).maxTeamUses).toBe(1);
  }, 60000);

  it('REJECTS an out-of-contract value before it can be stored', async () => {
    await seedPool(POOL);
    await expect(
      wUpdate({
        data: { poolId: POOL, updates: { settings: { ...BASE_SETTINGS, maxTeamUses: -1 } } },
        auth: AUTH,
      } as never),
    ).rejects.toThrow(/maxTeamUses/);
    expect((await settingsOf(POOL)).maxTeamUses).toBeUndefined();
  }, 60000);
});
