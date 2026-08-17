import { describe, it, expect, afterAll } from 'vitest';
import ftest from 'firebase-functions-test';
import * as admin from 'firebase-admin';
import { updatePoolSettings } from '../../poolOps';

/**
 * PLAN-PAYMENT-LEDGER T1 — `settings.weeklyPayouts` through updatePoolSettings:
 * HYBRID accepts; SEASON/WEEKLY refuse; duplicate ranks / > 100 % refused on
 * both lists; leaving HYBRID deletes the stored weekly list in the same write.
 */
const test = ftest();
const db = admin.firestore();
const wUpdate = test.wrap(updatePoolSettings);
const HOST = 'wp-host';
const auth = (uid: string) => ({ uid, token: {} }) as any;
let n = 0; let POOL = ''; const created: string[] = [];
const poolRef = () => db.collection('pools').doc(POOL);
const P = (rank: number, percentage: number) => ({ rank, percentage });
const BASE = { entryFee: 20, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false, payouts: { places: [P(1, 100)], bonuses: [] } };

async function seed(settings: Record<string, unknown>) {
  n += 1; POOL = `pool-wp-${n}`; created.push(POOL);
  await poolRef().set({ name: 'WP', type: 'NFL_PICKEM', league: 'NFL', season: 'wp-season', seasonType: 1, ownerId: HOST, managerUid: HOST, participantIds: [HOST], status: 'OPEN', billing: { status: 'free' }, settings: { ...BASE, ...settings } });
}
const save = (settings: Record<string, unknown>) => wUpdate({ data: { poolId: POOL, updates: { settings } }, auth: auth(HOST) } as never);
const stored = async () => ((await poolRef().get()).data() as any).settings;

afterAll(async () => { for (const id of created) await db.recursiveDelete(db.collection('pools').doc(id)); });

describe('updatePoolSettings — weeklyPayouts (T1)', () => {
  it('HYBRID pool: sets weeklyPayouts; SEASON pool: refused WRONG_MODE', async () => {
    await seed({ payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 } });
    await save({ ...BASE, payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 }, weeklyPayouts: { places: [P(1, 70), P(2, 30)] } });
    expect((await stored()).weeklyPayouts).toEqual({ places: [P(1, 70), P(2, 30)] });
    await seed({ payoutMode: 'SEASON' });
    await expect(save({ ...BASE, payoutMode: 'SEASON', weeklyPayouts: { places: [P(1, 100)] } })).rejects.toThrow(/WEEKLY_PAYOUTS_WRONG_MODE/);
    expect((await stored()).weeklyPayouts).toBeUndefined();
  }, 60000);

  it('duplicate ranks and > 100 % are refused on either list', async () => {
    await seed({ payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 } });
    await expect(save({ ...BASE, payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 }, weeklyPayouts: { places: [P(1, 50), P(1, 50)] } })).rejects.toThrow(/PAYOUT_DUPLICATE_RANK/);
    await expect(save({ ...BASE, payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 }, weeklyPayouts: { places: [P(1, 60), P(2, 50)] } })).rejects.toThrow(/exceed 100/);
    await expect(save({ ...BASE, payouts: { places: [P(1, 60), P(1, 40)], bonuses: [] } })).rejects.toThrow(/PAYOUT_DUPLICATE_RANK/);
  }, 60000);

  it('leaving HYBRID deletes the stored weeklyPayouts in the same write (HYBRID→SEASON and HYBRID→WEEKLY); payouts untouched', async () => {
    for (const to of ['SEASON', 'WEEKLY']) {
      await seed({ payoutMode: 'HYBRID', hybridSplit: { weeklyPerEntry: 10, seasonPerEntry: 10 }, weeklyPayouts: { places: [P(1, 100)] } });
      await save({ ...BASE, payoutMode: to });
      const s = await stored();
      expect(s.payoutMode).toBe(to);
      expect(s.weeklyPayouts).toBeUndefined();
      expect(s.hybridSplit).toBeUndefined(); // the existing split clearing rides along
      expect(s.payouts).toEqual({ places: [P(1, 100)], bonuses: [] });
    }
  }, 60000);
});
