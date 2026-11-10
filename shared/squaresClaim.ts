/**
 * Squares claim rules (PLAN-SQUARES-REOPEN A1/A2/A4). PURE — no Firebase, no
 * Node APIs — so the callable that DECIDES a claim and the pages that PREVIEW
 * one read the same definitions.
 *
 * Why this file exists: before it, `maxSquaresPerPlayer: 0` meant six different
 * things in six places (refuse everything on the server; 100, 10, "N/A", "∞"
 * and "N/A" again on the client), and the wizard's own label — "0 = no limit" —
 * was true in none of them. A player could select squares the grid allowed and
 * the pool page counted as fine, and be refused by the server on the first one.
 */

/**
 * The prefix on every guest device key minted from 2026-11 on.
 *
 * 🛑 A KEY WITHOUT IT IS TREATED AS COMPROMISED, AND THAT IS THE WHOLE FIX FOR
 * THE KEYS ALREADY OUT THERE. Until this change the raw key was written onto
 * each square of the world-readable pool document, and the browser reuses one
 * key for every pool. So every key ever used has been published, permanently —
 * hashing new writes does nothing for a key somebody already copied.
 *
 * The client therefore mints a NEW key under a new storage name, carrying this
 * prefix, and the server gives a guest identity only to a key that has it. An
 * old key still reserves a square; it just proves nothing afterwards.
 */
export const GUEST_KEY_PREFIX = 'g2_';

/** Shortest key the server will treat as an identity: the prefix plus a UUID. */
export const MIN_GUEST_KEY_LENGTH = 32;

/** Is this a key the server will hash and honour? */
export function isCurrentGuestKey(key: unknown): key is string {
  return typeof key === 'string'
    && key.startsWith(GUEST_KEY_PREFIX)
    && key.length >= MIN_GUEST_KEY_LENGTH
    && key.length <= 200;
}

/** The fields of a stored square these rules read. Everything else passes through. */
export interface ClaimSquare {
  id: number;
  owner: string | null;
  reservedByUid?: string | null;
  guestKeyHash?: string | null;
}

/**
 * WHO is claiming. `uid` for a signed-in player, `guestKeyHash` for a guest's
 * device. Both may be present: a signed-in player on the browser they used to
 * reserve as a guest still holds those guest squares.
 */
export interface ClaimIdentity {
  uid: string | null;
  guestKeyHash: string | null;
}

/**
 * The most squares one player may hold, or `null` for no limit.
 *
 * `0` IS NO LIMIT (Kevin, 2026-08-28) — which is what the wizard has always
 * told the commissioner. Absent, negative and non-numeric values are no limit
 * too: a stored value nobody can interpret must not refuse a paying player.
 */
export function effectiveSquareCap(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** One string for every surface that shows the cap. */
export function squareCapLabel(raw: unknown): string {
  const cap = effectiveSquareCap(raw);
  return cap === null ? 'No limit' : String(cap);
}

/** The same fact as a sentence, for the pool page's rules list. */
export function squareCapSentence(raw: unknown): string {
  const cap = effectiveSquareCap(raw);
  if (cap === null) return 'No limit on squares per player';
  return `Max ${cap} ${cap === 1 ? 'square' : 'squares'} per player`;
}

/**
 * The form two names are COMPARED in: trimmed, inner whitespace collapsed,
 * case-folded. Stored names keep the spelling the player typed.
 *
 * One definition, because there were three: the server compared exactly, the
 * grid case-insensitively, the pool page exactly-after-trim. "mike" and "Mike"
 * were one player to the grid and two to the server.
 */
export function normalizePlayerName(name: unknown): string {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/** Does this identity hold this square? A square nobody owns is held by nobody. */
export function isHeldBy(square: ClaimSquare, identity: ClaimIdentity): boolean {
  if (!square.owner) return false;
  if (identity.uid && square.reservedByUid === identity.uid) return true;
  if (identity.guestKeyHash && square.guestKeyHash === identity.guestKeyHash) return true;
  return false;
}

/** Does the square carry any identity at all? Legacy and hand-entered squares do not. */
function hasIdentity(square: ClaimSquare): boolean {
  return Boolean(square.reservedByUid) || Boolean(square.guestKeyHash);
}

/**
 * Is this square the claimer's OWN — for "already mine", for the squares a
 * player is shown as theirs, and for the ones their "I've paid" covers.
 *
 * By IDENTITY first. A name match counts only on a square that carries no
 * identity at all (a legacy square, or one the commissioner typed in), where
 * the name is all there is. ONE definition: the grid used to decide "mine" by
 * name alone, so a signed-in player's "I've paid" skipped every square they
 * held under a different typed name while the limit still counted them.
 */
export function isOwnSquare(square: ClaimSquare, identity: ClaimIdentity, displayName: string): boolean {
  // `isHeldBy` already refuses a square with no owner, and an empty owner
  // matches no name — so an unowned square is nobody's without a check here.
  if (isHeldBy(square, identity)) return true;
  const name = normalizePlayerName(displayName);
  return !hasIdentity(square) && name !== '' && normalizePlayerName(square.owner) === name;
}

/**
 * How many squares count against this claimer's limit.
 *
 * Held by the same IDENTITY, or under the same NAME. The union is deliberate:
 * identity alone is evaded by a second device, name alone by typing a different
 * name. Counting either closes both for anyone who keeps one of the two — and a
 * guest who changes both is a new person to a system with no accounts.
 */
export function countHeldSquares(
  squares: ReadonlyArray<ClaimSquare>,
  identity: ClaimIdentity,
  displayName: string,
): number {
  const name = normalizePlayerName(displayName);
  let n = 0;
  for (const s of squares) {
    if (!s.owner) continue;
    if (isHeldBy(s, identity) || (name !== '' && normalizePlayerName(s.owner) === name)) n++;
  }
  return n;
}

export type ClaimRefusal =
  | { code: 'NO_SQUARES' }
  | { code: 'NAME_REQUIRED' }
  | { code: 'NOT_FOUND'; squareId: number }
  | { code: 'TAKEN'; squareId: number }
  | { code: 'LIMIT'; cap: number; held: number; requested: number };

export interface ClaimPlanInput<S extends ClaimSquare = ClaimSquare> {
  squares: ReadonlyArray<S>;
  squareIds: ReadonlyArray<number>;
  identity: ClaimIdentity;
  /** The name to put on the squares, as the player typed it. */
  displayName: string;
  maxSquaresPerPlayer: unknown;
  /** The pool's owner is not capped — they enter squares on players' behalf. */
  exemptFromCap: boolean;
  now: number;
}

export type ClaimPlan<S extends ClaimSquare = ClaimSquare> =
  | { ok: true; squares: S[]; reserved: number[]; alreadyHeld: number[] }
  | { ok: false; refusal: ClaimRefusal };

/**
 * Decide a claim for a whole selection, ALL OR NOTHING.
 *
 * A square already held by the claimer is skipped, not refused — retrying a
 * claim that half-landed must succeed. A square held by anyone else refuses the
 * whole selection: reserving the rest and reporting failure is what the old
 * one-callable-per-square client did, and it left players holding squares they
 * had been told they did not get.
 *
 * 🛑 "ALREADY MINE" IS DECIDED BY IDENTITY, NOT BY NAME. The old check was
 * `owner === userName`, so a square held by a different person with the same
 * name returned success and reserved nothing. A name match counts only on a
 * square that carries NO identity — a legacy square, or one the commissioner
 * typed in by hand — where the name is all there is.
 */
export function planClaim<S extends ClaimSquare>(input: ClaimPlanInput<S>): ClaimPlan<S> {
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (displayName === '') return { ok: false, refusal: { code: 'NAME_REQUIRED' } };

  const ids = [...new Set(input.squareIds)];
  if (ids.length === 0) return { ok: false, refusal: { code: 'NO_SQUARES' } };

  const byId = new Map(input.squares.map((s) => [s.id, s]));
  const reserved: number[] = [];
  const alreadyHeld: number[] = [];

  for (const id of ids) {
    const square = byId.get(id);
    if (!square) return { ok: false, refusal: { code: 'NOT_FOUND', squareId: id } };
    if (!square.owner) {
      reserved.push(id);
      continue;
    }
    if (!isOwnSquare(square, input.identity, displayName)) return { ok: false, refusal: { code: 'TAKEN', squareId: id } };
    alreadyHeld.push(id);
  }

  const cap = effectiveSquareCap(input.maxSquaresPerPlayer);
  if (cap !== null && !input.exemptFromCap && reserved.length > 0) {
    const held = countHeldSquares(input.squares, input.identity, displayName);
    if (held + reserved.length > cap) {
      return { ok: false, refusal: { code: 'LIMIT', cap, held, requested: reserved.length } };
    }
  }

  const take = new Set(reserved);
  const squares = input.squares.map((s): S => {
    if (!take.has(s.id)) return { ...s };
    return {
      ...s,
      owner: displayName,
      pickedAsName: displayName,
      isPaid: false,
      // A fresh claim starts with a clean payment state. A square the unpaid
      // auto-release freed keeps its previous holder's "I've sent payment"
      // marks, and the new holder would otherwise inherit them.
      paymentConfirmedAt: null,
      paymentConfirmedByUid: null,
      // WHEN it was claimed — under `claimedAt`, deliberately NOT `reservedAt`.
      // `reservedAt` is the switch for the unpaid auto-release in
      // `functions/src/reminders.ts`, which has never run because nothing wrote
      // the field. That job picks its squares outside its transaction and
      // releases them by id inside it, and it ignores `paymentConfirmedAt` — so
      // switching it on would free squares that were paid during the run,
      // re-bought by someone else, or awaiting the commissioner's confirmation
      // (qodo, PR #758). It stays off until that job is fixed: PLAN K6.
      claimedAt: input.now,
      reservedAt: null,
      // A signed-in player's square belongs to the ACCOUNT. The device hash is
      // kept only for a guest, where it is the only identity there is.
      reservedByUid: input.identity.uid,
      guestKeyHash: input.identity.uid ? null : input.identity.guestKeyHash,
      // The raw key is never stored again (SECURITY-CLAIM-SQUARES.md).
      guestDeviceKey: null,
      guestClaimId: null,
    } as S;
  });

  return { ok: true, squares, reserved, alreadyHeld };
}

/** The sentence a player is shown for a refusal. One wording, server and client. */
export function claimRefusalMessage(refusal: ClaimRefusal): string {
  switch (refusal.code) {
    case 'NO_SQUARES': return 'Pick at least one square.';
    case 'NAME_REQUIRED': return 'Name is required to reserve a square.';
    case 'NOT_FOUND': return 'Square not found.';
    case 'TAKEN': return `Square #${refusal.squareId} is already taken.`;
    case 'LIMIT': {
      const left = Math.max(0, refusal.cap - refusal.held);
      return left === 0
        ? `You already hold the most squares one player may have in this pool (${refusal.cap}).`
        : `This pool allows ${refusal.cap} squares per player. You hold ${refusal.held}, so you can take ${left} more.`;
    }
  }
}
