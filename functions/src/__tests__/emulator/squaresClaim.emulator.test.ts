import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { reserveSquare, reserveSquares, releaseSquares } from '../../squares';
import { createClaimCode, claimMySquares, claimByCode } from '../../participant';
import { confirmPayment } from '../../confirmPayment';
import { hashGuestKey } from '../../lib/guestKey';
import { GUEST_KEY_PREFIX } from '../../shared/squaresClaim';

/**
 * The squares CLAIM PATH, driven through the real callables against the
 * emulator (PLAN-SQUARES-REOPEN PR-A).
 *
 * WHY EMULATOR. Every defect this PR closes lived in the wiring between a
 * callable and the pool document — which name the limit counted, what was
 * written onto the public square, whether the uid was stamped at all. A unit
 * test of the pure planner proves the planner; these prove the callable hands
 * it the right identity and writes what it returns.
 */
const test = ftest();
const db = admin.firestore();

const reserveOne = test.wrap(reserveSquare);
const reserveMany = test.wrap(reserveSquares);
const release = test.wrap(releaseSquares);
const mintCode = test.wrap(createClaimCode);
const claimMine = test.wrap(claimMySquares);
const claimCode = test.wrap(claimByCode);
const confirm = test.wrap(confirmPayment);

const POOL = 'squares-claim-pool';
const OWNER = 'owner-1';

/** A key the server honours: the prefix plus enough random characters. */
const key = (tag: string) => `${GUEST_KEY_PREFIX}${tag.padEnd(36, '0')}`;
/** A key from before the prefix existed — published on every old pool. */
const LEGACY_KEY = '11111111-2222-4333-8444-555555555555';

const authed = (uid: string, name: string) => ({ uid, token: { name, email: `${uid}@example.com` } });

/** The stored fields these tests read off a square. */
interface StoredSquare {
  id: number;
  owner: string | null;
  reservedByUid?: string | null;
  guestKeyHash?: string | null;
  guestDeviceKey?: string | null;
  reservedAt?: number | null;
}

/** `undefined` in `overrides` REMOVES that field, so a test can seed a pool without it. */
async function seedPool(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    type: 'SQUARES',
    name: 'Claim path pool',
    ownerId: OWNER,
    createdByUid: OWNER,
    isLocked: false,
    costPerSquare: 10,
    maxSquaresPerPlayer: 0,
    participantIds: [OWNER],
    squares: Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null })),
    scores: { current: null, q1: null, half: null, q3: null, final: null, gameStatus: 'pre' },
    ...overrides,
  };
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  await db.collection('pools').doc(POOL).set(doc);
}

const pool = async () =>
  (await db.collection('pools').doc(POOL).get()).data() as { squares: StoredSquare[]; participantIds: string[] } & Record<string, unknown>;
const square = async (id: number) => (await pool()).squares[id];

/** A guest reserving with a name and a device key, the way the pool page calls. */
const guestReserve = (squareIds: number[], name: string, deviceKey: string | null) =>
  reserveMany({
    data: { poolId: POOL, squareIds, customerDetails: { name }, guestDeviceKey: deviceKey, pickedAsName: name },
  } as never);

beforeEach(async () => {
  for (const col of ['pools', 'users', 'poolClaims']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
  await seedPool();
});

describe('A1 — a limit of 0 means no limit', () => {
  it('a guest takes their first square on a pool stored at 0', async () => {
    // The defect that closed squares creation: `0 >= 0` refused this claim.
    await guestReserve([5], 'Alice', key('alice'));
    expect((await square(5)).owner).toBe('Alice');
  });

  it('and can keep going well past any number the client used to invent', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i);
    await guestReserve(ids, 'Alice', key('alice'));
    expect((await pool()).squares.filter((s) => s.owner === 'Alice')).toHaveLength(25);
  });

  it('an absent limit is no limit too', async () => {
    await seedPool({ maxSquaresPerPlayer: undefined });
    expect('maxSquaresPerPlayer' in (await pool())).toBe(false);
    await guestReserve([1, 2, 3], 'Alice', key('alice'));
    expect((await square(3)).owner).toBe('Alice');
  });

  it('a real limit still refuses the square past it', async () => {
    await seedPool({ maxSquaresPerPlayer: 2 });
    await guestReserve([1, 2], 'Alice', key('alice'));
    await expect(guestReserve([3], 'Alice', key('alice'))).rejects.toThrow(/most squares one player may have/);
    expect((await square(3)).owner).toBeNull();
  });

  it('the pool owner is not capped — they enter squares for players', async () => {
    await seedPool({ maxSquaresPerPlayer: 1 });
    await reserveMany({
      data: { poolId: POOL, squareIds: [1, 2, 3], customerDetails: { name: 'Walk-in' }, pickedAsName: 'Walk-in' },
      auth: authed(OWNER, 'Owner'),
    } as never);
    expect((await pool()).squares.filter((s) => s.owner === 'Walk-in')).toHaveLength(3);
  });
});

describe('A2 — the limit counts a person, not a spelling', () => {
  beforeEach(() => seedPool({ maxSquaresPerPlayer: 2 }));

  it('a different NAME on the same device does not buy more squares', async () => {
    await guestReserve([1, 2], 'Alice', key('alice'));
    await expect(guestReserve([3], 'Somebody Else', key('alice'))).rejects.toThrow(/most squares/);
  });

  it('the same name on a second device does not either', async () => {
    await guestReserve([1, 2], 'Alice', key('alice'));
    await expect(guestReserve([3], '  alice ', key('second-device'))).rejects.toThrow(/most squares/);
  });

  it('a signed-in player is counted by ACCOUNT whatever name they type', async () => {
    // The old count matched the TOKEN name while the square stored the TYPED
    // name, so for a signed-in player it usually counted nothing at all.
    const bob = authed('bob-uid', 'Robert Token-Name');
    const call = (ids: number[], typed: string) => reserveMany({
      data: { poolId: POOL, squareIds: ids, customerDetails: { name: typed }, pickedAsName: typed },
      auth: bob,
    } as never);
    await call([1], 'Bob');
    await call([2], 'Bobby');
    await expect(call([3], 'B')).rejects.toThrow(/most squares/);
  });

  it('two different people are each given their own allowance', async () => {
    await guestReserve([1, 2], 'Alice', key('alice'));
    await guestReserve([3, 4], 'Carol', key('carol'));
    expect((await square(4)).owner).toBe('Carol');
  });
});

describe('A2 — a signed-in player owns their squares by account', () => {
  const bob = authed('bob-uid', 'Bob');
  const bobReserve = (ids: number[]) => reserveMany({
    data: { poolId: POOL, squareIds: ids, customerDetails: { name: 'Bob' }, pickedAsName: 'Bob' },
    auth: bob,
  } as never);

  it('the uid is stamped at reserve, and the square carries no device hash', async () => {
    await reserveMany({
      data: { poolId: POOL, squareIds: [7], customerDetails: { name: 'Bob' }, pickedAsName: 'Bob', guestDeviceKey: key('bob-browser') },
      auth: bob,
    } as never);
    const s = await square(7);
    expect(s.reservedByUid).toBe('bob-uid');
    expect(s.guestKeyHash).toBeNull();
    expect(typeof s.reservedAt).toBe('number');
    expect((await pool()).participantIds).toContain('bob-uid');
  });

  it('"I have paid" works straight after reserving — no claim code needed', async () => {
    // confirmPayment requires reservedByUid === caller. Nothing wrote it at
    // reserve, so this threw "You do not own Square #7" for every player.
    await bobReserve([7]);
    await expect(confirm({ data: { poolId: POOL, squareIds: [7] }, auth: bob } as never))
      .resolves.toMatchObject({ success: true, squaresConfirmed: 1 });
  });

  it('the legacy single-square callable stamps the uid as well', async () => {
    await reserveOne({
      data: { poolId: POOL, squareId: 8, customerDetails: { name: 'Bob' }, pickedAsName: 'Bob' },
      auth: bob,
    } as never);
    expect((await square(8)).reservedByUid).toBe('bob-uid');
  });
});

describe('A2 — "already mine" is decided by identity', () => {
  it('a square held by a DIFFERENT person with the same name is taken, not silently granted', async () => {
    await guestReserve([10], 'Chris', key('chris-one'));
    await expect(guestReserve([10], 'Chris', key('chris-two'))).rejects.toThrow(/already taken/);
    // And it is still the first Chris's.
    expect((await square(10)).guestKeyHash).toBe(hashGuestKey(POOL, key('chris-one')));
  });

  it('re-claiming your own square succeeds and changes nothing', async () => {
    await guestReserve([10], 'Chris', key('chris-one'));
    const before = await square(10);
    const res = await guestReserve([10], 'Chris', key('chris-one'));
    expect(res).toMatchObject({ success: true, reserved: [], alreadyHeld: [10] });
    expect(await square(10)).toEqual(before);
  });

  it('a hand-entered square with no identity still answers to its name', async () => {
    const squares = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: i === 20 ? 'Dana' : null }));
    await seedPool({ squares });
    const res = await guestReserve([20], 'dana', key('dana'));
    expect(res).toMatchObject({ reserved: [], alreadyHeld: [20] });
  });
});

describe('A4 — a selection is reserved all or nothing', () => {
  it('one taken square refuses the whole selection and reserves none of it', async () => {
    await guestReserve([31], 'Erin', key('erin'));
    await expect(guestReserve([30, 31, 32], 'Frank', key('frank'))).rejects.toThrow(/#31 is already taken/);
    expect((await square(30)).owner).toBeNull();
    expect((await square(32)).owner).toBeNull();
  });

  it('a selection that would cross the limit reserves none of it', async () => {
    await seedPool({ maxSquaresPerPlayer: 3 });
    await guestReserve([1], 'Gina', key('gina'));
    await expect(guestReserve([2, 3, 4], 'Gina', key('gina'))).rejects.toThrow(/you can take 2 more/);
    expect((await pool()).squares.filter((s) => s.owner)).toHaveLength(1);
  });

  it('a locked grid refuses everyone but the owner', async () => {
    await seedPool({ isLocked: true });
    await expect(guestReserve([1], 'Late', key('late'))).rejects.toThrow(/locked/i);
    await reserveMany({
      data: { poolId: POOL, squareIds: [1], customerDetails: { name: 'Fix-up' }, pickedAsName: 'Fix-up' },
      auth: authed(OWNER, 'Owner'),
    } as never);
    expect((await square(1)).owner).toBe('Fix-up');
  });

  it('refuses a blank name', async () => {
    await expect(reserveMany({
      data: { poolId: POOL, squareIds: [1], customerDetails: { name: '   ' }, pickedAsName: '   ' },
    } as never)).rejects.toThrow(/Name is required/);
  });
});

describe('A3 — the guest key is never published', () => {
  it('the pool document carries the hash and NOT the key', async () => {
    const k = key('harry');
    await guestReserve([40], 'Harry', k);
    const raw = JSON.stringify(await pool());
    expect(raw).not.toContain(k);
    const s = await square(40);
    expect(s.guestDeviceKey).toBeNull();
    expect(s.guestKeyHash).toBe(hashGuestKey(POOL, k));
  });

  it('a key from before the prefix reserves the square but is given no identity', async () => {
    await guestReserve([41], 'Old Browser', LEGACY_KEY);
    const s = await square(41);
    expect(s.owner).toBe('Old Browser');
    expect(s.guestKeyHash).toBeNull();
    expect(JSON.stringify(await pool())).not.toContain(LEGACY_KEY);
  });

  it('the hash differs per pool, so one device is not linkable across pools', () => {
    expect(hashGuestKey('pool-a', key('same'))).not.toBe(hashGuestKey('pool-b', key('same')));
  });
});

describe('A3 — only the device that reserved can claim', () => {
  const attacker = authed('attacker-uid', 'Mallory');
  const victimKey = key('victim');

  beforeEach(() => guestReserve([50, 51], 'Victim', victimKey));

  it('ATTACK: presenting the hash read off the pool document claims nothing', async () => {
    const published = (await square(50)).guestKeyHash as string;
    const res = await claimMine({ data: { poolId: POOL, guestDeviceKey: published }, auth: attacker } as never);
    expect(res.claimed).toEqual([]);
    expect((await square(50)).reservedByUid).toBeNull();
  });

  it('ATTACK: a claim code cannot be minted from the published hash', async () => {
    const published = (await square(50)).guestKeyHash as string;
    await expect(mintCode({ data: { poolId: POOL, guestDeviceKey: published } } as never))
      .rejects.toThrow(/out of date/);
  });

  it('ATTACK: a legacy key harvested from an old pool claims nothing here', async () => {
    // The victim's OLD key was published on every pool they played before the
    // fix. Their new squares were reserved under a new key, so it matches none.
    const res = await claimMine({ data: { poolId: POOL, guestDeviceKey: LEGACY_KEY }, auth: attacker } as never);
    expect(res.claimed).toEqual([]);
    await expect(mintCode({ data: { poolId: POOL, guestDeviceKey: LEGACY_KEY } } as never))
      .rejects.toThrow(/out of date/);
  });

  it('a claim code minted before the fix (raw key, no hash) is refused', async () => {
    await db.collection('poolClaims').doc('legacy').set({
      claimId: 'legacy', claimCode: 'LEGACY', createdAt: 1, guestClaimId: victimKey, poolId: POOL, uses: 0,
    });
    await expect(claimCode({ data: { claimCode: 'LEGACY' }, auth: attacker } as never)).rejects.toThrow(/expired/);
    expect((await square(50)).reservedByUid).toBeNull();
  });

  it('the guest themself, signing in on the same browser, takes both squares', async () => {
    const victim = authed('victim-uid', 'Victim');
    const res = await claimMine({ data: { poolId: POOL, guestDeviceKey: victimKey }, auth: victim } as never);
    expect(res.claimed.sort()).toEqual([50, 51]);
    const s = await square(50);
    expect(s.reservedByUid).toBe('victim-uid');
    expect(s.guestKeyHash).toBeNull();
    // Membership follows the squares now that the proof is real.
    expect((await pool()).participantIds).toContain('victim-uid');
  });

  it('a code minted on the guest device moves the squares to the account that types it', async () => {
    const { claimCode: code } = await mintCode({ data: { poolId: POOL, guestDeviceKey: victimKey } } as never);
    // The stored claim holds the hash, never the key.
    const stored = (await db.collection('poolClaims').get()).docs[0].data();
    expect(stored.guestKeyHash).toBe(hashGuestKey(POOL, victimKey));
    expect(JSON.stringify(stored)).not.toContain(victimKey);

    const victim = authed('victim-uid', 'Victim');
    const res = await claimCode({ data: { claimCode: code }, auth: victim } as never);
    expect(res.claimed.sort()).toEqual([50, 51]);
    expect((await square(51)).reservedByUid).toBe('victim-uid');
  });

  it('an expired code is refused', async () => {
    const { claimId, claimCode: code } = await mintCode({ data: { poolId: POOL, guestDeviceKey: victimKey } } as never);
    await db.collection('poolClaims').doc(claimId).update({ expiresAt: Date.now() - 1 });
    await expect(claimCode({ data: { claimCode: code }, auth: authed('victim-uid', 'Victim') } as never))
      .rejects.toThrow(/expired/);
  });

  it('a released square is not claimable through the hash it used to carry', async () => {
    await release({ data: { poolId: POOL, squareIds: [50] }, auth: authed(OWNER, 'Owner') } as never);
    expect((await square(50)).guestKeyHash).toBeNull();
    const res = await claimMine({ data: { poolId: POOL, guestDeviceKey: victimKey }, auth: authed('victim-uid', 'Victim') } as never);
    expect(res.claimed).toEqual([51]);
  });

  it('a square whose owner was cleared WITHOUT clearing the hash is not claimable either', async () => {
    // What the squares auto-release in reminders.ts leaves behind.
    const squares = (await pool()).squares.map((s) => (s.id === 50 ? { ...s, owner: null } : s));
    await db.collection('pools').doc(POOL).update({ squares });
    const res = await claimMine({ data: { poolId: POOL, guestDeviceKey: victimKey }, auth: authed('victim-uid', 'Victim') } as never);
    expect(res.claimed).toEqual([51]);
  });
});
