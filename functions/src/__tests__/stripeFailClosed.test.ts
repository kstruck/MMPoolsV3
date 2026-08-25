import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// stripe.ts touches admin.firestore() at module load — stub the SDK so the pure
// gates can be imported (same shape as checkoutOwnership.test.ts).
vi.mock('firebase-admin', () => {
  const firestore: any = () => ({});
  firestore.FieldValue = { delete: () => null, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) };
  return { default: { firestore, apps: [], initializeApp: () => undefined }, firestore, apps: [], initializeApp: () => undefined };
});
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => null, serverTimestamp: () => 0, increment: (n: number) => ({ __inc__: n }) } }));

import {
  classifyStripeKey,
  isEmulatedEnvironment,
  resolveStripeMode,
  assertStripePaymentAllowed,
  assertNotMockSessionInDeployedEnv,
  makeAlertThrottle,
  STRIPE_UNAVAILABLE_MESSAGE,
} from '../stripe';

/**
 * PLAN-STRIPE-FAIL-CLOSED.md — the external (codex) P0 finding, confirmed:
 * `getStripe()` returned null on a missing/placeholder STRIPE_SECRET_KEY with NO
 * environment condition, and both checkout branches read that null as "mock
 * mode" and granted paid state — pool activation + ledger row + coupon
 * confirmation on one path, bundle entitlements + credit docs + ledger row on
 * the other. In a deployed environment that is free money.
 *
 * These are the NEGATIVE tests: in a deployed environment neither path can
 * grant anything without a usable secret.
 */

const DEPLOYED: NodeJS.ProcessEnv = {};
const FUNCTIONS_EMU: NodeJS.ProcessEnv = { FUNCTIONS_EMULATOR: 'true' };
const FIRESTORE_EMU: NodeJS.ProcessEnv = { FIRESTORE_EMULATOR_HOST: 'localhost:8080' };

const UNUSABLE_KEYS: Array<[string, string | undefined]> = [
  ['undefined', undefined],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['placeholder', 'placeholder_stripe_key'],
  ['PLACEHOLDER (case)', 'PLACEHOLDER'],
  ['changeme', 'changeme'],
  ['dummy', 'dummy-key'],
  ['example', 'example_key'],
  ['todo', 'TODO'],
  ['your-key scaffold', 'your-stripe-secret-key'],
  ['xxxx redaction', 'xxxxxxxx'],
  ['a publishable key pasted by mistake', 'pk_live_51abcdef'],
  ['a webhook secret pasted by mistake', 'whsec_abcdef'],
  ['arbitrary junk', 'not-a-key'],
];

describe('classifyStripeKey', () => {
  it('accepts only real Stripe secret/restricted key shapes', () => {
    expect(classifyStripeKey('sk_live_51abcdef')).toBe('usable');
    expect(classifyStripeKey('sk_test_51abcdef')).toBe('usable');
    expect(classifyStripeKey('rk_live_51abcdef')).toBe('usable');
    // trimmed, because a trailing newline in Secret Manager is a real thing
    expect(classifyStripeKey('  sk_live_51abcdef\n')).toBe('usable');
  });

  it('classifies missing values', () => {
    expect(classifyStripeKey(undefined)).toBe('missing');
    expect(classifyStripeKey(null)).toBe('missing');
    expect(classifyStripeKey('')).toBe('missing');
    expect(classifyStripeKey('   ')).toBe('missing');
    expect(classifyStripeKey('\n\t ')).toBe('missing');
  });

  it('classifies placeholder spellings', () => {
    for (const k of ['placeholder', 'placeholder_key', 'PLACEHOLDER', 'changeme', 'change-me', 'dummy', 'example', 'TODO', 'your-key', 'your_stripe_key', 'xxxxxx']) {
      expect(classifyStripeKey(k), k).toBe('placeholder');
    }
  });

  it('classifies anything that is not sk_/rk_ as malformed — including the WRONG Stripe key pasted in', () => {
    expect(classifyStripeKey('pk_live_51abcdef')).toBe('malformed');
    expect(classifyStripeKey('whsec_abcdef')).toBe('malformed');
    expect(classifyStripeKey('not-a-key')).toBe('malformed');
  });

  it('never returns "usable" for ANY unusable input in the table', () => {
    for (const [label, key] of UNUSABLE_KEYS) {
      expect(classifyStripeKey(key), label).not.toBe('usable');
    }
  });
});

describe('isEmulatedEnvironment — only the emulator can say it is the emulator', () => {
  it('is true only for the two variables the Firebase emulator sets on itself', () => {
    expect(isEmulatedEnvironment(FUNCTIONS_EMU)).toBe(true);
    expect(isEmulatedEnvironment(FIRESTORE_EMU)).toBe(true);
  });

  it('is false for a deployed environment', () => {
    expect(isEmulatedEnvironment(DEPLOYED)).toBe(false);
    expect(isEmulatedEnvironment({ FUNCTIONS_EMULATOR: 'false' })).toBe(false);
    expect(isEmulatedEnvironment({ FUNCTIONS_EMULATOR: '1' })).toBe(false); // strict "true" only
    expect(isEmulatedEnvironment({ FIRESTORE_EMULATOR_HOST: '' })).toBe(false);
  });

  it('CANNOT be flipped by anything a caller or a config doc could set', () => {
    // The hazard this guard exists to close would return in a heartbeat if a
    // settable field were allowed to mean "dev mode".
    const attackerShaped: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
      isEmulator: 'true',
      devMode: '1',
      MOCK_STRIPE: 'true',
      allowMockCheckout: 'true',
      FIREBASE_CONFIG: '{"projectId":"demo-test"}',
      GCLOUD_PROJECT: 'demo-test',
      FUNCTIONS_EMULATOR_HOST: 'localhost:5001', // note: NOT the real variable
    } as NodeJS.ProcessEnv;
    expect(isEmulatedEnvironment(attackerShaped)).toBe(false);
  });
});

describe('resolveStripeMode — the full matrix', () => {
  it('a usable key is live in EVERY environment', () => {
    for (const env of [DEPLOYED, FUNCTIONS_EMU, FIRESTORE_EMU]) {
      expect(resolveStripeMode('sk_live_51abcdef', env).mode).toBe('live');
    }
  });

  it('an unusable key is REFUSE when deployed', () => {
    for (const [label, key] of UNUSABLE_KEYS) {
      expect(resolveStripeMode(key, DEPLOYED).mode, label).toBe('refuse');
    }
  });

  it('an unusable key is mock ONLY under the emulator', () => {
    for (const [label, key] of UNUSABLE_KEYS) {
      expect(resolveStripeMode(key, FUNCTIONS_EMU).mode, label).toBe('mock');
      expect(resolveStripeMode(key, FIRESTORE_EMU).mode, label).toBe('mock');
    }
  });
});

describe('assertStripePaymentAllowed — the money gate', () => {
  // A FRESH throttle per gate, and persistClaim disabled: the throttle is
  // exercised on its own below, and a shared module-level one would make these
  // tests order-dependent (the second refusal would be silently suppressed).
  const gate = (key: string | undefined, env: NodeJS.ProcessEnv, dispatch = vi.fn().mockResolvedValue('sent')) =>
    ({
      dispatch,
      run: () => assertStripePaymentAllowed({
        context: { path: 'test' }, env, readKey: () => key, dispatch,
        throttle: makeAlertThrottle(30 * 60 * 1000), persistClaim: null,
      }),
    });

  it('REFUSES every unusable key in a deployed environment, with failed-precondition', async () => {
    for (const [label, key] of UNUSABLE_KEYS) {
      const g = gate(key, DEPLOYED);
      await expect(g.run(), label).rejects.toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('the refusal message tells the caller nothing was charged and nothing changed', async () => {
    const g = gate(undefined, DEPLOYED);
    await expect(g.run()).rejects.toThrow(/not been charged/i);
    expect(STRIPE_UNAVAILABLE_MESSAGE).toMatch(/nothing about your pool was changed/i);
  });

  it('pages ops EXACTLY ONCE per refusal, through the existing dispatcher shape', async () => {
    const g = gate('placeholder', DEPLOYED);
    await expect(g.run()).rejects.toThrow();
    expect(g.dispatch).toHaveBeenCalledTimes(1);
    const input = g.dispatch.mock.calls[0][0];
    expect(input.type).toBe('PAYMENT_FAILED');
    expect(input.title).toMatch(/Stripe is not configured/i);
    expect(input.context).toMatchObject({ verdict: 'placeholder', path: 'test' });
  });

  it('still REFUSES when the ops alert itself fails — paging is best-effort, the refusal is not', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('courier down'));
    await expect(
      assertStripePaymentAllowed({
        context: {}, env: DEPLOYED, readKey: () => undefined, dispatch,
        throttle: makeAlertThrottle(1), persistClaim: null,
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('still REFUSES when the PERSISTED alert claim throws (Firestore down)', async () => {
    const dispatch = vi.fn().mockResolvedValue('sent');
    await expect(
      assertStripePaymentAllowed({
        context: {}, env: DEPLOYED, readKey: () => undefined, dispatch,
        throttle: makeAlertThrottle(1), persistClaim: async () => { throw new Error('firestore down'); },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

/**
 * codex r1 [P2]: the refusal fires on EVERY checkout attempt for as long as the
 * secret is broken, and dispatchOpsAlert writes one mail doc per recipient with
 * no dedupe. Unthrottled, the fix for a config outage would bury the on-call
 * inbox during that same outage.
 */
describe('ops-alert throttling during a config outage', () => {
  it('makeAlertThrottle admits one claim per window and re-admits after it', () => {
    const t = makeAlertThrottle(1000);
    expect(t.tryClaim(0)).toBe(true);
    expect(t.tryClaim(1)).toBe(false);
    expect(t.tryClaim(999)).toBe(false);
    expect(t.tryClaim(1000)).toBe(true);
    expect(t.tryClaim(1500)).toBe(false);
    expect(t.tryClaim(2000)).toBe(true);
  });

  it('admits the very first claim even at t=0 (no "lastAt = 0" off-by-one)', () => {
    expect(makeAlertThrottle(60_000).tryClaim(0)).toBe(true);
  });

  it('a storm of refusals inside one window pages ONCE — but refuses EVERY time', async () => {
    const dispatch = vi.fn().mockResolvedValue('sent');
    const throttle = makeAlertThrottle(30 * 60 * 1000);
    let refusals = 0;
    for (let i = 0; i < 25; i++) {
      await assertStripePaymentAllowed({
        context: { attempt: i }, env: DEPLOYED, readKey: () => undefined, dispatch,
        throttle, persistClaim: null, now: 1_000_000 + i * 1000,
      }).catch((e) => { if (e?.code === 'failed-precondition') refusals++; });
    }
    expect(refusals).toBe(25);       // the refusal is NEVER throttled
    expect(dispatch).toHaveBeenCalledTimes(1); // the paging is
  });

  it('pages again once the window has elapsed — a still-broken config is not forgotten', async () => {
    const dispatch = vi.fn().mockResolvedValue('sent');
    const throttle = makeAlertThrottle(1000);
    for (const now of [0, 500, 1000, 1200, 2000]) {
      await assertStripePaymentAllowed({
        context: {}, env: DEPLOYED, readKey: () => undefined, dispatch, throttle, persistClaim: null, now,
      }).catch(() => undefined);
    }
    expect(dispatch).toHaveBeenCalledTimes(3); // t=0, t=1000, t=2000
  });

  it('a persisted claim that says "already paged" suppresses the page but not the refusal', async () => {
    const dispatch = vi.fn().mockResolvedValue('sent');
    await expect(
      assertStripePaymentAllowed({
        context: {}, env: DEPLOYED, readKey: () => undefined, dispatch,
        throttle: makeAlertThrottle(1), persistClaim: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT refuse and does NOT page when the key is usable', async () => {
    const g = gate('sk_live_51abcdef', DEPLOYED);
    await expect(g.run()).resolves.toMatchObject({ mode: 'live' });
    expect(g.dispatch).not.toHaveBeenCalled();
  });

  it('does NOT refuse under the emulator — local mock checkout survives', async () => {
    for (const env of [FUNCTIONS_EMU, FIRESTORE_EMU]) {
      const g = gate(undefined, env);
      await expect(g.run()).resolves.toMatchObject({ mode: 'mock', verdict: 'missing' });
      expect(g.dispatch).not.toHaveBeenCalled();
    }
  });
});

describe('assertNotMockSessionInDeployedEnv — the backstop on the two functions that WRITE paid state', () => {
  it('refuses the pool mock session id in a deployed environment', () => {
    expect(() => assertNotMockSessionInDeployedEnv('mock_local_dev_session_1700000000000', DEPLOYED))
      .toThrow(/temporarily unavailable/i);
  });

  it('refuses the bundle mock session id in a deployed environment', () => {
    expect(() => assertNotMockSessionInDeployedEnv('mock_bundle_session_1700000000000', DEPLOYED))
      .toThrow(/temporarily unavailable/i);
  });

  it('permits mock ids under the emulator', () => {
    expect(() => assertNotMockSessionInDeployedEnv('mock_bundle_session_1', FUNCTIONS_EMU)).not.toThrow();
    expect(() => assertNotMockSessionInDeployedEnv('mock_local_dev_session_1', FIRESTORE_EMU)).not.toThrow();
  });

  it('never blocks a real Stripe session, or the free-activation tags, anywhere', () => {
    for (const id of ['cs_test_a1b2c3', 'cs_live_a1b2c3', 'free_tier_activation', 'pool_credit_use', 'free_promo_abc', undefined]) {
      expect(() => assertNotMockSessionInDeployedEnv(id as any, DEPLOYED), String(id)).not.toThrow();
      expect(() => assertNotMockSessionInDeployedEnv(id as any, FUNCTIONS_EMU), String(id)).not.toThrow();
    }
  });
});

/**
 * Source invariants. The unit tests above prove the gate DECIDES correctly; these
 * prove it is WIRED where it has to be — before the first write on each path —
 * which no amount of testing the pure function can show. Same technique as
 * __tests__/checkoutOwnership.test.ts.
 */
describe('the gate is positioned before the first write on BOTH checkout paths', () => {
  const raw = readFileSync(resolve(__dirname, '..', 'stripe.ts'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Region anchors are CODE, not comments — `src` has comments stripped, so a
  // comment banner like "PAID PATH" is not there to slice on. (The first draft
  // of this test anchored on the banner, found nothing, sliced from -1, and
  // "passed" the ordering assertions on an empty region.)
  const freeStartAt = src.indexOf('if (serverPrice === 0) {');
  const freeEndAt = src.indexOf('[Checkout] Pool '); // the free path's closing log
  const freePath = src.slice(freeStartAt, freeEndAt);
  const paidPath = src.slice(freeEndAt);

  it('the region anchors actually resolved (a -1 slice would fake every assertion below)', () => {
    expect(freeStartAt).toBeGreaterThan(-1);
    expect(freeEndAt).toBeGreaterThan(freeStartAt);
    expect(freePath.length).toBeGreaterThan(500);
    expect(paidPath.length).toBeGreaterThan(500);
  });

  it('POOL: the paid path gates before its reservation transaction, and before the mock branch', () => {
    const gateAt = paidPath.indexOf('assertStripePaymentAllowed');
    const txnAt = paidPath.indexOf('db.runTransaction');
    const finalizeAt = paidPath.indexOf('finalizePoolPayment(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(txnAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(txnAt);
    expect(gateAt).toBeLessThan(finalizeAt);
  });

  it('POOL: the free ($0) path is deliberately NOT gated — it never calls Stripe', () => {
    expect(freePath).not.toContain('assertStripePaymentAllowed');
    // ...and it still refuses a $0 activation with no free-activation reason.
    expect(freePath).toContain('No valid free-activation reason provided');
  });

  it('BUNDLE: createBundleCheckout gates before it resolves a price or grants anything', () => {
    const fn = src.slice(src.indexOf('async function createBundleCheckout'), src.indexOf('async function resolveBundlePackage'));
    const gateAt = fn.indexOf('assertStripePaymentAllowed');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(fn.indexOf('grantBundle('));
    expect(gateAt).toBeLessThan(fn.indexOf('billing_config'));
  });

  it('EVERY mock branch carries its own refusal (defence in depth)', () => {
    const branches = src.split('if (!stripe) {').slice(1);
    // pool mock branch, bundle mock branch, and the webhook refusal
    expect(branches.length).toBeGreaterThanOrEqual(3);
    const granting = branches.filter((b) => /finalizePoolPayment\(|grantBundle\(/.test(b.slice(0, 900)));
    expect(granting.length).toBe(2); // exactly the two grant branches
    for (const b of granting) {
      const head = b.slice(0, 900);
      expect(head).toContain('assertStripePaymentAllowed');
      expect(head.indexOf('assertStripePaymentAllowed')).toBeLessThan(
        Math.min(...[head.indexOf('finalizePoolPayment('), head.indexOf('grantBundle(')].filter((i) => i > -1)),
      );
    }
  });

  it('the two functions that WRITE paid state each carry the mock-session backstop', () => {
    const finalize = src.slice(src.indexOf('async function finalizePoolPayment'));
    const grant = src.slice(src.indexOf('async function grantBundle'), src.indexOf('async function finalizePoolPayment'));
    for (const [label, fn] of [['finalizePoolPayment', finalize.slice(0, 1200)], ['grantBundle', grant]] as const) {
      const guardAt = fn.indexOf('assertNotMockSessionInDeployedEnv');
      expect(guardAt, label).toBeGreaterThan(-1);
      expect(guardAt, label).toBeLessThan(fn.indexOf('runTransaction'));
    }
  });

  it('the webhook null-checks getStripe before verifying a signature (no null deref)', () => {
    const hook = src.slice(src.indexOf('export const handleStripeWebhook'));
    const nullCheckAt = hook.indexOf('if (!stripe)');
    const constructAt = hook.indexOf('webhooks.constructEvent');
    expect(nullCheckAt).toBeGreaterThan(-1);
    expect(nullCheckAt).toBeLessThan(constructAt);
    expect(hook.slice(nullCheckAt, constructAt)).toContain('503');
  });

  it('getStripe no longer decides policy — the environment is resolved by the exported helpers only', () => {
    // The original bug in one line: `if (!key || key.startsWith("placeholder"))
    // return null` WAS the whole policy. It must not come back.
    expect(src).not.toContain('key.startsWith("placeholder")');
    expect(src).toContain('classifyStripeKey');
  });

  it('emulator detection reads ONLY the two emulator variables, nowhere in this file', () => {
    const detector = src.slice(src.indexOf('export function isEmulatedEnvironment'));
    const body = detector.slice(0, detector.indexOf('}') + 1);
    expect(body).toContain('FUNCTIONS_EMULATOR');
    expect(body).toContain('FIRESTORE_EMULATOR_HOST');
    // No other file-level source of "am I in dev" may exist.
    expect(src.match(/FUNCTIONS_EMULATOR|FIRESTORE_EMULATOR_HOST/g)?.length).toBe(2);
    expect(src).not.toMatch(/NODE_ENV\s*===/);
  });
});
