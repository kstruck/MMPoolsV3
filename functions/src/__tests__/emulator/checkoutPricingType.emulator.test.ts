import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';

/**
 * qodo #786, finding 1, against the emulator: the owner of a NON-squares pool
 * sends `poolType: "SQUARES"` to `createCheckoutSession` while squares is priced
 * at $0. Priced from the caller's type, that quote is free_tier
 * (PLAN-SQUARES-ZERO-PRICE-FREE) and the $0 free path would activate the pool
 * without payment. Priced from the STORED type, it is the pool's own price.
 */
import { createCheckoutSession } from '../../stripe';
import { BillingConfigSchema, DEFAULT_FORMAT_TIER_MAP } from '../../shared/schemas/billingConfig';

const test = ftest();
const db = admin.firestore();
const checkout = test.wrap(createCheckoutSession);

const OWNER = 'owner-1';
const owner = { uid: OWNER, token: { email: 'owner@example.com' } };
const NONE = { aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false };

// Squares free at every size (the Thanksgiving band); every other format priced.
const CONFIG = BillingConfigSchema.parse({
  freePlayerThreshold: 10,
  gracePeriodDays: 7,
  trialDays: 14,
  pricing: {
    season: [{ min: 11, max: 9999, price: 29 }],
    bracket: [{ min: 11, max: 9999, price: 19 }],
    squares: [{ min: 11, max: 9999, price: 0 }],
    props: [{ min: 11, max: 9999, price: 9 }],
  },
  formatTierMap: DEFAULT_FORMAT_TIER_MAP,
  features: {
    aiCommissioner: { isPremium: true, addonPrice: 19 },
    whatIfSimulator: { isPremium: true, addonPrice: 9 },
    customBranding: { isPremium: true, addonPrice: 29 },
  },
});

async function seedPool(id: string, type: string | undefined): Promise<void> {
  await db.collection('pools').doc(id).set({
    name: `pool ${id}`,
    ...(type ? { type } : {}),
    ownerId: OWNER,
    billing: { status: 'trial', tier: 'standard_tier', trialEndsAt: Date.now() + 86_400_000 },
  });
}

const attempt = (poolId: string, poolType: string) =>
  checkout({
    data: { poolId, poolName: 'x', poolType, estimatedPlayers: 40, addons: NONE },
    auth: owner,
  } as never);

beforeEach(async () => {
  for (const col of ['pools', 'users', 'checkoutSessions', 'billing_charges']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await db.collection('users').doc(OWNER).set({ role: 'COMMISSIONER', email: 'owner@example.com' });
  await db.collection('settings').doc('billing_config').set(JSON.parse(JSON.stringify(CONFIG)));
});

afterAll(async () => {
  await db.collection('settings').doc('billing_config').delete();
  test.cleanup();
});

describe('checkout prices the STORED pool type (qodo #786 finding 1)', () => {
  // In the emulator a PAID checkout completes inline (the "[Stripe Mockup]"
  // branch: a `mock_` session, as if the card were charged), so `active` alone
  // does not tell paid from free. The charge and the tier do: the bug took the
  // $0 FREE PATH — no session record, tier free_tier.
  it('an NFL pool sent as "SQUARES" is charged as NFL, not activated free', async () => {
    await seedPool('nfl-1', 'NFL_PICKEM');
    await attempt('nfl-1', 'SQUARES');
    const sessions = (await db.collection('checkoutSessions').where('poolId', '==', 'nfl-1').get()).docs.map((d) => d.data());
    expect(sessions).toHaveLength(1);
    expect(sessions[0].poolType).toBe('NFL_PICKEM');
    expect(sessions[0].amount).toBe(29);
    const pool = (await db.collection('pools').doc('nfl-1').get()).data()!;
    expect(pool.billing.tier).not.toBe('free_tier');
  });

  it('a real squares pool at $0 is activated free (the plan\'s D4 path)', async () => {
    await seedPool('sq-1', 'SQUARES');
    await attempt('sq-1', 'SQUARES');
    const pool = (await db.collection('pools').doc('sq-1').get()).data()!;
    expect(pool.billing.status).toBe('active');
    expect(pool.billing.tier).toBe('free_tier');
  });

  // qodo #786 re-review: a legacy playoff pool is stored as 'playoff'. Through
  // the real checkout and pricing map it must price as NFL_PLAYOFFS (the
  // 'bracket' band, $19 here) — not fail on an unmapped PLAYOFF.
  it('a legacy "playoff" pool is priced as NFL_PLAYOFFS through the real checkout', async () => {
    await seedPool('po-1', 'playoff');
    await attempt('po-1', 'SQUARES');
    const sessions = (await db.collection('checkoutSessions').where('poolId', '==', 'po-1').get()).docs.map((d) => d.data());
    expect(sessions).toHaveLength(1);
    expect(sessions[0].poolType).toBe('NFL_PLAYOFFS');
    expect(sessions[0].amount).toBe(19);
  });

  it('a legacy squares pool with no stored type is priced as squares, whatever is sent', async () => {
    await seedPool('legacy-1', undefined);
    await attempt('legacy-1', 'BRACKET');
    const pool = (await db.collection('pools').doc('legacy-1').get()).data()!;
    expect(pool.billing.status).toBe('active');
    expect(pool.billing.tier).toBe('free_tier');
  });
});
