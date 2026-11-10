import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { reserveSquare, reserveSquares, releaseSquares } from '../../squares';
import { createClaimCode, claimMySquares, claimByCode, mintClaimCode } from '../../participant';
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
  claimedAt?: number | null;
  paymentConfirmedAt?: number | null;
  paymentConfirmedByUid?: string | null;
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
  for (const col of ['pools', 'users', 'poolClaims', 'pool_access_attempts']) {
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
    expect(typeof s.claimedAt).toBe('number');
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

describe('qodo #12 — a square the commissioner enters for someone else is that player\'s, not the commissioner\'s', () => {
  const owner = authed(OWNER, 'Olivia Owner');
  const ownerReserve = (ids: number[], name: string, email?: string) => reserveMany({
    data: { poolId: POOL, squareIds: ids, customerDetails: { name, ...(email ? { email } : {}) }, pickedAsName: name },
    auth: owner,
  } as never);
  const privateOf = async (id: number) =>
    (await db.collection('pools').doc(POOL).collection('squarePrivate').doc(String(id)).get()).data() as Record<string, unknown>;

  it('carries the name and NO account — it is not on the commissioner\'s dashboard', async () => {
    await ownerReserve([20, 21], 'Cash Carl');
    for (const id of [20, 21]) {
      const s = await square(id);
      expect(s.owner).toBe('Cash Carl');
      expect(s.reservedByUid).toBeNull();
      expect(s.guestKeyHash).toBeNull();
    }
  });

  it('the commissioner cannot press "I have paid" on it as if it were theirs', async () => {
    await ownerReserve([20], 'Cash Carl');
    await expect(confirm({ data: { poolId: POOL, squareIds: [20] }, auth: owner } as never)).rejects.toThrow();
  });

  it('its contact details are the player\'s as typed — never the commissioner\'s own email by default', async () => {
    await ownerReserve([20], 'Cash Carl');
    expect((await privateOf(20)).email).not.toBe(`${OWNER}@example.com`);
    await ownerReserve([21], 'Emailed Emma', 'emma@example.com');
    expect((await privateOf(21)).email).toBe('emma@example.com');
  });

  it('the commissioner\'s OWN squares, under their own name, still belong to their account', async () => {
    await ownerReserve([30], 'olivia  owner');
    expect((await square(30)).reservedByUid).toBe(OWNER);
    await expect(confirm({ data: { poolId: POOL, squareIds: [30] }, auth: owner } as never)).resolves.toMatchObject({ success: true });
  });

  it('a PLAYER typing a different name still holds the square by account — only the owner enters for others', async () => {
    await reserveMany({
      data: { poolId: POOL, squareIds: [40], customerDetails: { name: 'For My Wife' }, pickedAsName: 'For My Wife' },
      auth: authed('bob-uid', 'Bob'),
    } as never);
    expect((await square(40)).reservedByUid).toBe('bob-uid');
  });
});

describe('qodo #8 / #11 — a fresh claim starts clean, and does not arm the unpaid auto-release', () => {
  it('a re-booked square does not inherit the last holder\'s "payment sent"', async () => {
    const squares = Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null as string | null }));
    // What the auto-release leaves: owner cleared, the old marks still there.
    Object.assign(squares[9], { paymentConfirmedAt: 555, paymentConfirmedByUid: 'old-holder', reservedAt: 123 });
    await seedPool({ squares });
    await guestReserve([9], 'New Holder', key('new-device'));
    const s = await square(9);
    expect(s.owner).toBe('New Holder');
    expect(s.paymentConfirmedAt).toBeNull();
    expect(s.paymentConfirmedByUid).toBeNull();
  });

  it('no square is ever given a reservedAt — the field the auto-release in reminders.ts is switched on by', async () => {
    await guestReserve([1, 2], 'Guest', key('device'));
    await reserveMany({ data: { poolId: POOL, squareIds: [3], customerDetails: { name: 'Bob' }, pickedAsName: 'Bob' }, auth: authed('bob-uid', 'Bob') } as never);
    await reserveOne({ data: { poolId: POOL, squareId: 4, customerDetails: { name: 'Bob' }, pickedAsName: 'Bob' }, auth: authed('bob-uid', 'Bob') } as never);
    const all = (await pool()).squares;
    expect(all.filter((s) => s.reservedAt != null)).toEqual([]);
    expect(all.filter((s) => typeof s.claimedAt === 'number').map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('qodo #2 — a claim code cannot be guessed', () => {
  const victimKey = key('victim-device');
  const mallory = authed('mallory-uid', 'Mallory');
  const redeem = (code: string, auth = mallory) => claimCode({ data: { claimCode: code }, auth } as never);
  const mint = async () => ((await mintCode({ data: { poolId: POOL, guestDeviceKey: victimKey } } as never)) as { claimCode: string }).claimCode;

  beforeEach(() => guestReserve([50, 51], 'Victim', victimKey));

  it('is 8 characters with no look-alikes', async () => {
    expect(await mint()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('can be typed in lower case with a dash, as read off another screen', async () => {
    const code = await mint();
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`;
    await expect(redeem(typed, authed('victim-uid', 'Victim'))).resolves.toMatchObject({ success: true, claimed: [50, 51] });
  });

  it('ATTACK: ten wrong guesses and the account is stopped — even a RIGHT code is then refused', async () => {
    const code = await mint();
    for (let i = 0; i < 10; i++) {
      await expect(redeem(`WRONG${String(i).padStart(3, '2')}`)).rejects.toThrow(/invalid claim code/i);
    }
    await expect(redeem('WRONGXYZ')).rejects.toThrow(/too many attempts/i);
    await expect(redeem(code)).rejects.toThrow(/too many attempts/i);
    expect((await square(50)).reservedByUid ?? null).toBeNull();
  });

  it('ATTACK: redeeming a code of your own does not reset the count', async () => {
    // Anyone can mint a code for their own squares. If a right code refunded the
    // slot, an attacker would redeem their own every ninth guess and never run out.
    const malloryKey = key('mallory-device');
    await guestReserve([60], 'Mallory', malloryKey);
    const own = ((await mintCode({ data: { poolId: POOL, guestDeviceKey: malloryKey } } as never)) as { claimCode: string }).claimCode;
    for (let i = 0; i < 9; i++) await expect(redeem(`WRONG${String(i).padStart(3, '2')}`)).rejects.toThrow(/invalid claim code/i);
    await expect(redeem(own)).resolves.toMatchObject({ success: true });
    await expect(redeem('WRONGXYZ')).rejects.toThrow(/too many attempts/i);
  });

  it('one account running out does not stop anybody else', async () => {
    const code = await mint();
    for (let i = 0; i < 10; i++) await expect(redeem(`WRONG${String(i).padStart(3, '2')}`)).rejects.toThrow();
    await expect(redeem(code, authed('victim-uid', 'Victim'))).resolves.toMatchObject({ success: true, claimed: [50, 51] });
  });
});

/**
 * qodo, PR #758 round 3 — TWO LIVE CODES NEVER SHARE A VALUE.
 *
 * A claim code is looked up by value and is a bearer credential, so a second
 * live claim under the same code means one guest's code opens another guest's
 * squares. The mint used to query for the code and then write under a random
 * id — two mints could both pass the query — and its last draw was never
 * checked. The code is now the document id, taken in a transaction.
 *
 * Chance will not produce a clash in a test run, so these force one: the mint
 * takes its draw as a parameter, and here the draw is a fixed sequence.
 */
describe('claim codes — one live claim per code', () => {
  const aliceKey = key('alice-code');
  const bobKey = key('bob-code');
  const aliceHash = hashGuestKey(POOL, aliceKey)!;
  const bobHash = hashGuestKey(POOL, bobKey)!;
  const NOW = Date.now();
  const sequence = (...codes: string[]) => {
    let i = 0;
    return () => codes[Math.min(i++, codes.length - 1)];
  };
  const claims = async (): Promise<Array<{ id: string; claimCode?: string; guestKeyHash?: string }>> =>
    (await db.collection('poolClaims').get()).docs.map((d) => ({ ...(d.data() as { claimCode?: string; guestKeyHash?: string }), id: d.id }));
  const mintFor = (guestKeyHash: string, draw: () => string, now = NOW) =>
    mintClaimCode(db, { poolId: POOL, guestKeyHash, now }, draw);

  it('the claim is filed under its own code', async () => {
    const { claimCode: code, claimId } = (await mintCode({ data: { poolId: POOL, guestDeviceKey: aliceKey } } as never)) as { claimCode: string; claimId: string };
    expect(claimId).toBe(code);
    const all = await claims();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(code);
    expect(all[0].claimCode).toBe(code);
  });

  it('a code another guest already holds is not issued again — the next draw is used', async () => {
    await mintFor(aliceHash, sequence('AAAAAAAA'));
    const bob = await mintFor(bobHash, sequence('AAAAAAAA', 'BBBBBBBB'));
    expect(bob.claimCode).toBe('BBBBBBBB');
    const all = await claims();
    expect(all.map((c) => c.id).sort()).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    // Alice's claim was not touched by Bob's attempt on it.
    expect(all.find((c) => c.id === 'AAAAAAAA')!.guestKeyHash).toBe(aliceHash);
    expect(all.find((c) => c.id === 'BBBBBBBB')!.guestKeyHash).toBe(bobHash);
  });

  it('ATTACK: when every draw is taken the mint FAILS — it does not hand out the last one unchecked', async () => {
    await mintFor(aliceHash, sequence('AAAAAAAA'));
    await expect(mintFor(bobHash, sequence('AAAAAAAA'))).rejects.toThrow(/Could not create a claim code/);
    const all = await claims();
    expect(all).toHaveLength(1);
    expect(all[0].guestKeyHash).toBe(aliceHash);
  });

  it('two mints racing for the same code: exactly one gets it', async () => {
    const results = await Promise.allSettled([
      mintFor(aliceHash, sequence('CCCCCCCC', 'DDDDDDDD')),
      mintFor(bobHash, sequence('CCCCCCCC', 'EEEEEEEE')),
    ]);
    const codes = results.map((r) => (r.status === 'fulfilled' ? r.value.claimCode : null));
    expect(codes.every(Boolean)).toBe(true);
    expect(new Set(codes).size).toBe(2);
    expect(codes.filter((c) => c === 'CCCCCCCC')).toHaveLength(1);
    // Each code leads to the guest it was issued to, and to nobody else.
    const all = await claims();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id === codes[0])!.guestKeyHash).toBe(aliceHash);
    expect(all.find((c) => c.id === codes[1])!.guestKeyHash).toBe(bobHash);
  });

  it('an EXPIRED claim under a code is dead: the code can be issued again, and opens only the new claim', async () => {
    await mintFor(aliceHash, sequence('FFFFFFFF'), NOW - 48 * 60 * 60 * 1000);
    const bob = await mintFor(bobHash, sequence('FFFFFFFF'));
    expect(bob.claimCode).toBe('FFFFFFFF');
    const all = await claims();
    expect(all).toHaveLength(1);
    expect(all[0].guestKeyHash).toBe(bobHash);
  });

  it('a live code minted before this change (random id) is not shadowed', async () => {
    await db.collection('poolClaims').doc('random-legacy-id').set({
      claimId: 'random-legacy-id', claimCode: 'GGGGGGGG', createdAt: NOW, expiresAt: NOW + 60_000, guestKeyHash: aliceHash, poolId: POOL, uses: 0,
    });
    const bob = await mintFor(bobHash, sequence('GGGGGGGG', 'HHHHHHHH'));
    expect(bob.claimCode).toBe('HHHHHHHH');
  });

  it('...but an expired one of those does not block the code', async () => {
    await db.collection('poolClaims').doc('random-legacy-id').set({
      claimId: 'random-legacy-id', claimCode: 'GGGGGGGG', createdAt: 1, expiresAt: NOW - 1, guestKeyHash: aliceHash, poolId: POOL, uses: 0,
    });
    const bob = await mintFor(bobHash, sequence('GGGGGGGG', 'HHHHHHHH'));
    expect(bob.claimCode).toBe('GGGGGGGG');
  });

  it('and the reissued code opens the NEW claim, not the dead one that shares its value', async () => {
    await guestReserve([70], 'Bob', bobKey);
    // Sorts ahead of the code, so a lookup by value alone would find it first.
    await db.collection('poolClaims').doc('0-dead-legacy').set({
      claimId: '0-dead-legacy', claimCode: 'KKKKKKKK', createdAt: 1, expiresAt: NOW - 1, guestKeyHash: aliceHash, poolId: POOL, uses: 0,
    });
    const bob = await mintFor(bobHash, sequence('KKKKKKKK'));
    expect(bob.claimCode).toBe('KKKKKKKK');
    const res = (await claimCode({ data: { claimCode: 'KKKKKKKK' }, auth: authed('bob-uid', 'Bob') } as never)) as { claimed: number[] };
    expect(res.claimed).toEqual([70]);
  });

  it('a code minted before this change still redeems for its remaining life', async () => {
    await guestReserve([60, 61], 'Alice', aliceKey);
    await db.collection('poolClaims').doc('random-legacy-id').set({
      claimId: 'random-legacy-id', claimCode: 'JJJJJJJJ', createdAt: NOW, expiresAt: Date.now() + 60_000, guestKeyHash: aliceHash, poolId: POOL, uses: 0,
    });
    const res = (await claimCode({ data: { claimCode: 'JJJJJJJJ' }, auth: authed('alice-uid', 'Alice') } as never)) as { claimed: number[] };
    expect(res.claimed.sort()).toEqual([60, 61]);
    expect((await db.collection('poolClaims').doc('random-legacy-id').get()).data()!.uses).toBe(1);
  });

  it('the code a guest is given opens that guest\'s squares and not another guest\'s', async () => {
    await guestReserve([60], 'Alice', aliceKey);
    await guestReserve([70], 'Bob', bobKey);
    const alice = (await mintCode({ data: { poolId: POOL, guestDeviceKey: aliceKey } } as never)) as { claimCode: string };
    const bob = (await mintCode({ data: { poolId: POOL, guestDeviceKey: bobKey } } as never)) as { claimCode: string };
    expect(alice.claimCode).not.toBe(bob.claimCode);
    const res = (await claimCode({ data: { claimCode: bob.claimCode }, auth: authed('bob-uid', 'Bob') } as never)) as { claimed: number[] };
    expect(res.claimed).toEqual([70]);
    expect((await square(60)).reservedByUid ?? null).toBeNull();
  });
});
