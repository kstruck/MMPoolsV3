import { describe, it, expect } from 'vitest';
import {
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
