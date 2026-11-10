import { describe, it, expect } from 'vitest';
import {
  duesBuckets,
  GUEST_KEY_PREFIX,
  claimRefusalMessage,
  countHeldSquares,
  effectiveSquareCap,
  isCurrentGuestKey,
  isHeldBy,
  normalizePlayerName,
  planClaim,
  squareCapLabel,
  squareCapSentence,
  type ClaimSquare,
  isOwnSquare,
  isEnteringForSomeoneElse,
} from '../shared/squaresClaim';

/**
 * The squares claim rules (PLAN-SQUARES-REOPEN A1/A2/A4), as a pure function.
 *
 * The callable that decides a claim and the pages that preview one both call
 * these, so what is proven here is true of both. The wiring — which identity
 * the callable hands in, what it writes — is proven against the emulator in
 * `functions/src/__tests__/emulator/squaresClaim.emulator.test.ts`.
 */
type Sq = ClaimSquare & {
  isPaid?: boolean; guestDeviceKey?: string | null; reservedAt?: number | null; claimedAt?: number | null;
  paymentConfirmedAt?: number | null; paymentConfirmedByUid?: string | null;
};

const emptyGrid = (): Sq[] => Array.from({ length: 100 }, (_, i) => ({ id: i, owner: null }));
const guest = (hash: string) => ({ uid: null, guestKeyHash: hash });
const account = (uid: string) => ({ uid, guestKeyHash: null });
const nobody = { uid: null, guestKeyHash: null };

function claim(over: Partial<Parameters<typeof planClaim<Sq>>[0]>) {
  return planClaim<Sq>({
    squares: emptyGrid(),
    squareIds: [0],
    identity: nobody,
    displayName: 'Alice',
    maxSquaresPerPlayer: 0,
    exemptFromCap: false,
    now: 1000,
    ...over,
  });
}
const held = (owner: string, extra: Partial<Sq> = {}) => (id: number): Sq => ({ id, owner, ...extra });
const gridWith = (...filled: Sq[]): Sq[] => {
  const byId = new Map(filled.map((s) => [s.id, s]));
  return emptyGrid().map((s) => byId.get(s.id) ?? s);
};

describe('effectiveSquareCap — one reader for the limit', () => {
  it.each([
    [0, null], [undefined, null], [null, null], [-5, null], ['', null], ['abc', null], [NaN, null], [Infinity, null],
    [1, 1], [10, 10], ['7', 7], [3.9, 3],
  ])('%s → %s', (raw, expected) => {
    expect(effectiveSquareCap(raw)).toBe(expected);
  });

  it('renders the same fact one way', () => {
    expect(squareCapLabel(0)).toBe('No limit');
    expect(squareCapLabel(10)).toBe('10');
    expect(squareCapSentence(0)).toBe('No limit on squares per player');
    expect(squareCapSentence(1)).toBe('Max 1 square per player');
    expect(squareCapSentence(4)).toBe('Max 4 squares per player');
  });
});

describe('normalizePlayerName — one comparison form', () => {
  it('folds case, trims, collapses inner whitespace', () => {
    expect(normalizePlayerName('  Mike   Smith ')).toBe('mike smith');
    expect(normalizePlayerName('MIKE smith')).toBe(normalizePlayerName('mike Smith'));
  });
  it('a non-string is nobody', () => {
    expect(normalizePlayerName(undefined)).toBe('');
    expect(normalizePlayerName(null)).toBe('');
    expect(normalizePlayerName(42)).toBe('');
  });
});

describe('isCurrentGuestKey — which keys the server honours', () => {
  const good = `${GUEST_KEY_PREFIX}${'a'.repeat(36)}`;
  it('accepts a prefixed key of UUID length', () => expect(isCurrentGuestKey(good)).toBe(true));
  it.each([
    ['a bare UUID (minted before the prefix — published on old pools)', '11111111-2222-4333-8444-555555555555'],
    ['a short prefixed key', `${GUEST_KEY_PREFIX}abc`],
    ['an over-long key', `${GUEST_KEY_PREFIX}${'a'.repeat(300)}`],
    ['empty', ''],
    ['null', null],
    ['a number', 12345],
  ])('refuses %s', (_label, key) => expect(isCurrentGuestKey(key)).toBe(false));
});

describe('isHeldBy', () => {
  it('matches the account or the device', () => {
    expect(isHeldBy({ id: 1, owner: 'A', reservedByUid: 'u1' }, account('u1'))).toBe(true);
    expect(isHeldBy({ id: 1, owner: 'A', guestKeyHash: 'h1' }, guest('h1'))).toBe(true);
    expect(isHeldBy({ id: 1, owner: 'A', reservedByUid: 'u1' }, account('u2'))).toBe(false);
  });
  it('a square nobody owns is held by nobody, whatever it still carries', () => {
    // The auto-release in reminders.ts clears the owner and leaves the hash.
    expect(isHeldBy({ id: 1, owner: null, guestKeyHash: 'h1' }, guest('h1'))).toBe(false);
    expect(isHeldBy({ id: 1, owner: null, reservedByUid: 'u1' }, account('u1'))).toBe(false);
  });
  it('an identity with nothing in it holds nothing', () => {
    expect(isHeldBy({ id: 1, owner: 'A' }, nobody)).toBe(false);
  });
});

describe('countHeldSquares — identity OR name', () => {
  const grid = gridWith(
    held('Alice', { guestKeyHash: 'dev-1' })(1),
    held('Someone Else', { guestKeyHash: 'dev-1' })(2), // same device, different name
    held(' alice ', { guestKeyHash: 'dev-2' })(3),      // same name, different device
    held('Bob', { reservedByUid: 'bob' })(4),
  );
  it('counts both the device match and the name match', () => {
    expect(countHeldSquares(grid, guest('dev-1'), 'Alice')).toBe(3);
  });
  it('a different person is not counted', () => {
    expect(countHeldSquares(grid, guest('dev-9'), 'Carol')).toBe(0);
  });
  it('an account is counted by uid whatever name it types', () => {
    expect(countHeldSquares(grid, account('bob'), 'Robert')).toBe(1);
  });
});

describe('planClaim — the limit', () => {
  it('0 is no limit: the whole grid', () => {
    const plan = claim({ squareIds: emptyGrid().map((s) => s.id) });
    expect(plan.ok && plan.reserved.length).toBe(100);
  });
  it('refuses the square past a real limit, and says how many are left', () => {
    const squares = gridWith(held('Alice', { guestKeyHash: 'd' })(1));
    const plan = claim({ squares, squareIds: [2, 3, 4], identity: guest('d'), maxSquaresPerPlayer: 3 });
    expect(plan).toEqual({ ok: false, refusal: { code: 'LIMIT', cap: 3, held: 1, requested: 3 } });
    if (!plan.ok) expect(claimRefusalMessage(plan.refusal)).toContain('you can take 2 more');
  });
  it('exactly at the limit is allowed', () => {
    const squares = gridWith(held('Alice', { guestKeyHash: 'd' })(1));
    expect(claim({ squares, squareIds: [2, 3], identity: guest('d'), maxSquaresPerPlayer: 3 }).ok).toBe(true);
  });
  it('the owner is exempt', () => {
    expect(claim({ squareIds: [1, 2, 3], maxSquaresPerPlayer: 1, exemptFromCap: true }).ok).toBe(true);
  });
  it('re-claiming squares already held does not count as asking for more', () => {
    const squares = gridWith(held('Alice', { guestKeyHash: 'd' })(1), held('Alice', { guestKeyHash: 'd' })(2));
    const plan = claim({ squares, squareIds: [1, 2], identity: guest('d'), maxSquaresPerPlayer: 2 });
    expect(plan).toMatchObject({ ok: true, reserved: [], alreadyHeld: [1, 2] });
  });
});

describe('planClaim — taken, mine, and all-or-nothing', () => {
  it('another identity under the same name is TAKEN, not mine', () => {
    const squares = gridWith(held('Chris', { guestKeyHash: 'one' })(5));
    expect(claim({ squares, squareIds: [5], identity: guest('two'), displayName: 'Chris' }))
      .toEqual({ ok: false, refusal: { code: 'TAKEN', squareId: 5 } });
  });
  it('a square with NO identity answers to its name', () => {
    const squares = gridWith(held('Dana')(5));
    expect(claim({ squares, squareIds: [5], identity: guest('x'), displayName: ' dana' }))
      .toMatchObject({ ok: true, reserved: [], alreadyHeld: [5] });
  });
  it('one taken square refuses the selection and changes nothing', () => {
    const squares = gridWith(held('Erin', { guestKeyHash: 'e' })(31));
    const plan = claim({ squares, squareIds: [30, 31, 32], identity: guest('f'), displayName: 'Frank' });
    expect(plan).toEqual({ ok: false, refusal: { code: 'TAKEN', squareId: 31 } });
  });
  it('an id off the grid refuses the selection', () => {
    expect(claim({ squareIds: [1, 400] })).toEqual({ ok: false, refusal: { code: 'NOT_FOUND', squareId: 400 } });
  });
  it('a blank name and an empty selection are refused', () => {
    expect(claim({ displayName: '   ' })).toEqual({ ok: false, refusal: { code: 'NAME_REQUIRED' } });
    expect(claim({ squareIds: [] })).toEqual({ ok: false, refusal: { code: 'NO_SQUARES' } });
  });
  it('duplicate ids are one square', () => {
    const plan = claim({ squareIds: [7, 7, 7] });
    expect(plan.ok && plan.reserved).toEqual([7]);
  });
});

describe('planClaim — what gets written', () => {
  it('an account square carries the uid and no device hash', () => {
    const plan = claim({ squareIds: [9], identity: { uid: 'u1', guestKeyHash: 'dev' }, displayName: '  Typed Name ' });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[9]).toMatchObject({
      owner: 'Typed Name', pickedAsName: 'Typed Name', isPaid: false,
      reservedByUid: 'u1', guestKeyHash: null, claimedAt: 1000,
    });
  });
  it('a guest square carries the device hash and no uid', () => {
    const plan = claim({ squareIds: [9], identity: guest('dev') });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[9]).toMatchObject({ reservedByUid: null, guestKeyHash: 'dev' });
  });
  it('the raw key is cleared, never written', () => {
    const squares = gridWith({ id: 9, owner: null, guestDeviceKey: 'stale-raw-key' });
    const plan = claim({ squares, squareIds: [9], identity: guest('dev') });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[9].guestDeviceKey).toBeNull();
  });
  it('squares not in the selection are returned untouched, and the input is not mutated', () => {
    const squares = gridWith(held('Bob', { reservedByUid: 'bob', isPaid: true })(4));
    const before = JSON.stringify(squares);
    const plan = claim({ squares, squareIds: [9] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[4]).toEqual(squares[4]);
    expect(JSON.stringify(squares)).toBe(before);
  });
});

describe('planClaim — a fresh claim starts clean', () => {
  it('the previous holder\'s "I have sent payment" does not pass to the next holder', () => {
    // What the unpaid auto-release leaves behind: no owner, the old marks still on the square.
    const freed: Sq = { id: 9, owner: null, paymentConfirmedAt: 555, paymentConfirmedByUid: 'old-holder', isPaid: false };
    const plan = claim({ squares: gridWith(freed), squareIds: [9], identity: account('new-holder') });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[9]).toMatchObject({ owner: 'Alice', reservedByUid: 'new-holder', paymentConfirmedAt: null, paymentConfirmedByUid: null, isPaid: false });
  });

  it('records WHEN under claimedAt and never writes reservedAt — the switch for the unsafe auto-release', () => {
    const stale: Sq = { id: 9, owner: null, reservedAt: 123 };
    const plan = claim({ squares: gridWith(stale), squareIds: [9] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[9].claimedAt).toBe(1000);
    expect(plan.squares[9].reservedAt).toBeNull();
  });

  it('leaves every square it did not reserve exactly as it was', () => {
    const other: Sq = { id: 3, owner: 'Bob', reservedByUid: 'bob', paymentConfirmedAt: 777, reservedAt: 5 };
    const plan = claim({ squares: gridWith(other), squareIds: [9] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.squares[3]).toEqual(other);
  });
});

describe('isOwnSquare — one answer to "is this square mine?"', () => {
  const mine = account('u1');

  it('held by my account, whatever name is on it', () => {
    expect(isOwnSquare({ id: 1, owner: 'Typed Differently', reservedByUid: 'u1' }, mine, 'Alice')).toBe(true);
  });

  it('held by this browser as a guest', () => {
    expect(isOwnSquare({ id: 1, owner: 'Anything', guestKeyHash: 'dev' }, guest('dev'), 'Alice')).toBe(true);
  });

  it('my name on a square with NO identity — hand-entered or legacy', () => {
    expect(isOwnSquare({ id: 1, owner: ' alice ' }, mine, 'Alice')).toBe(true);
  });

  it('my name on a square that belongs to someone else\'s account is NOT mine', () => {
    expect(isOwnSquare({ id: 1, owner: 'Alice', reservedByUid: 'other' }, mine, 'Alice')).toBe(false);
    expect(isOwnSquare({ id: 1, owner: 'Alice', guestKeyHash: 'their-device' }, guest('dev'), 'Alice')).toBe(false);
  });

  it('nobody owns an empty square, and an empty name matches nothing', () => {
    expect(isOwnSquare({ id: 1, owner: null, reservedByUid: 'u1' }, mine, 'Alice')).toBe(false);
    expect(isOwnSquare({ id: 1, owner: '' }, nobody, '')).toBe(false);
  });
});

/**
 * qodo, PR #758 round 3. `confirmPayment` accepts a square only when it is
 * stamped with the caller's ACCOUNT, and refuses the WHOLE request when one
 * square in it is not. The grid sent every square that was "mine" — including
 * ones matched by name alone, which is what a square the organizer typed in
 * looks like — so a player with one of those could not confirm any of theirs.
 */
describe('duesBuckets — which unpaid squares a player can say they have paid for', () => {
  const me = { uid: 'u-alice', guestKeyHash: 'hash-alice' };
  const sq = (id: number, over: Record<string, unknown> = {}) => ({ id, owner: 'Alice', ...over });

  it('a square stamped with the player\'s account is confirmable', () => {
    const out = duesBuckets([sq(1, { reservedByUid: 'u-alice' })], me, 'Alice');
    expect(out).toEqual({ confirmable: [1], hostOnly: [], pending: [] });
  });

  it('a square the organizer entered under the player\'s name is theirs to PAY but not theirs to confirm', () => {
    const out = duesBuckets([sq(2)], me, 'Alice');
    expect(out).toEqual({ confirmable: [], hostOnly: [2], pending: [] });
  });

  it('THE BUG: mixed dues — the confirmable list holds only what the server will accept', () => {
    const squares = [
      sq(1, { reservedByUid: 'u-alice' }),
      sq(2), // organizer-entered, name only
      sq(3, { reservedByUid: 'u-alice' }),
    ];
    const out = duesBuckets(squares, me, 'Alice');
    expect(out.confirmable).toEqual([1, 3]);
    expect(out.hostOnly).toEqual([2]);
    // The server's own rule, restated: every confirmable square carries the uid.
    for (const id of out.confirmable) expect(squares.find((s) => s.id === id)!.reservedByUid).toBe('u-alice');
  });

  it('a square still held by this browser as a guest is not confirmable until it is on the account', () => {
    const out = duesBuckets([sq(4, { guestKeyHash: 'hash-alice' })], me, 'Alice');
    expect(out).toEqual({ confirmable: [], hostOnly: [4], pending: [] });
  });

  it('a guest (no account) can confirm nothing', () => {
    const guest = { uid: null, guestKeyHash: 'hash-alice' };
    // `reservedByUid: null` is what a guest's square is stored with, and it
    // must not read as "stamped with this (absent) account".
    const out = duesBuckets(
      [sq(4, { guestKeyHash: 'hash-alice', reservedByUid: null }), sq(5), sq(6, { reservedByUid: null })],
      guest, 'Alice',
    );
    expect(out.confirmable).toEqual([]);
    expect(out.hostOnly).toEqual([4, 5, 6]);
  });

  it('a square the player already confirmed is pending, whoever could have confirmed it', () => {
    const out = duesBuckets(
      [sq(1, { reservedByUid: 'u-alice', paymentConfirmedAt: 5 }), sq(2, { paymentConfirmedAt: 5 })],
      me, 'Alice',
    );
    expect(out).toEqual({ confirmable: [], hostOnly: [], pending: [1, 2] });
  });

  it('a paid square is in no bucket', () => {
    const out = duesBuckets(
      [sq(1, { reservedByUid: 'u-alice', isPaid: true }), sq(2, { isPaid: true }), sq(3, { reservedByUid: 'u-alice', isPaid: true, paymentConfirmedAt: 5 })],
      me, 'Alice',
    );
    expect(out).toEqual({ confirmable: [], hostOnly: [], pending: [] });
  });

  it('somebody else\'s square is in no bucket — by account, by device, or by name', () => {
    const out = duesBuckets(
      [
        sq(1, { reservedByUid: 'u-bob' }),               // Bob's account, typed "Alice"
        sq(2, { guestKeyHash: 'hash-bob' }),              // Bob's browser, typed "Alice"
        sq(3, { owner: 'Bob' }),                          // organizer-entered for Bob
        sq(4, { owner: null }),                           // nobody's
      ],
      me, 'Alice',
    );
    expect(out).toEqual({ confirmable: [], hostOnly: [], pending: [] });
  });

  it('a square held under the account but a different typed name is still the player\'s', () => {
    const out = duesBuckets([sq(1, { owner: 'Ali', reservedByUid: 'u-alice' })], me, 'Alice');
    expect(out.confirmable).toEqual([1]);
  });
});

/**
 * "FOR SOMEONE ELSE" — the one rule the page shows and the request carries.
 * The server follows `onBehalf` for the pool's owner and does not compare
 * names of its own; `squaresClaim.emulator.test.ts` holds it to that.
 */
describe('isEnteringForSomeoneElse', () => {
  const owner = (typedName: string | null | undefined, accountName: string | null | undefined) =>
    isEnteringForSomeoneElse({ isOwner: true, typedName, accountName });

  it('the organizer typing another name is entering for that person', () => {
    expect(owner('Uncle Ray', 'Olivia Owner')).toBe(true);
  });

  it('the organizer typing their own name is not — however it is spaced or cased', () => {
    for (const typed of ['Olivia Owner', 'olivia owner', '  OLIVIA   owner  ']) {
      expect(owner(typed, 'Olivia Owner'), typed).toBe(false);
    }
  });

  it('nobody but the organizer ever enters for someone else', () => {
    expect(isEnteringForSomeoneElse({ isOwner: false, typedName: 'For My Wife', accountName: 'Bob' })).toBe(false);
  });

  it('an account with no name has nothing to compare against — the squares stay the organizer\'s', () => {
    for (const none of [undefined, null, '', '   ']) {
      expect(owner('Whoever', none)).toBe(false);
    }
  });

  it('nothing typed yet is not "for someone else"', () => {
    for (const none of [undefined, null, '', '   ']) {
      expect(owner(none, 'Olivia Owner')).toBe(false);
    }
  });
});

describe('the pool page sends the rule it shows', () => {
  it('the claim request carries isEnteringForSomeoneElse, evaluated on the name being claimed under', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const route = readFileSync(resolve(__dirname, '..', 'src/components/routes/PoolRoute.tsx'), 'utf8');
    expect(route).toContain('isEnteringForSomeoneElse({ isOwner, typedName: normalizedName, accountName: user?.name })');
    const service = readFileSync(resolve(__dirname, '..', 'src/services/dbService.ts'), 'utf8');
    // Sent only when true: an absent flag is "these are mine".
    expect(service).toContain('...(onBehalf ? { onBehalf: true } : {})');
  });
});

