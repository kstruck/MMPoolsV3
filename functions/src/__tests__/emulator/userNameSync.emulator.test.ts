import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import './setup';
import { isCurrentProfileName, propagateUserName, resolveSubjectName, stampSearchName } from '../../lib/displayName';
import { createUserProfileIfMissing } from '../../userSync';
import { submitNFLPicksInternal } from '../../nflPools';

/**
 * Display-name ownership, the half only a live Firestore can prove:
 *
 *  P1 — `propagateUserName` rewrites `userName` on EVERY Member Record and
 *       every owned entry across pools, touches nothing else on those docs,
 *       leaves other members / other owners / `entryName` alone, skips docs
 *       that carry no `userName` (bracket entries), and is idempotent.
 *  P2 — `createUserProfileIfMissing` (userSync.ts, the ONE Auth-create
 *       creator since 2026-09-11) never overwrites an existing profile (the
 *       "New User" race, 2026-09-10), refreshes only the index/login fields on
 *       one that exists, and falls back to the email prefix, not a
 *       placeholder, when the Auth record has no display name.
 *  P7 — the NFL-playoff `entries` MAP on the pool document follows the name
 *       (qodo #690 finding 1): only this uid's entries, only `userName`, never
 *       `entryName`, and a deleted entry is not resurrected.
 *  P8 — prop-bet cards (`pools/{*}/propCards/*`, several per uid) follow the
 *       name (qodo #690 finding 2); a guest card is not a uid and is untouched.
 *  P3 — `resolveSubjectName` prefers the PROFILE over the login token, so a
 *       fixed name no longer reverts on the next pick.
 */
const db = admin.firestore();

const UID = 'dn_target';
const OTHER = 'dn_other';
const POOL_A = 'dn_pool_a';
const POOL_B = 'dn_pool_b';
const POOL_PLAYOFF = 'dn_pool_playoff';
const POOL_PROPS = 'dn_pool_props';

async function wipe() {
  await db.collection('nfl_games').doc('dn_game_1').delete().catch(() => undefined);
  for (const p of [POOL_A, POOL_B, 'dn_pool_c', POOL_PLAYOFF, POOL_PROPS]) {
    const ref = db.collection('pools').doc(p);
    for (const sub of ['members', 'entries', 'propCards']) {
      const snap = await ref.collection(sub).get();
      await Promise.all(snap.docs.map(d => d.ref.delete()));
    }
    await ref.delete();
  }
  await Promise.all([UID, OTHER].map(u => db.collection('users').doc(u).delete()));
}

async function seed() {
  for (const p of [POOL_A, POOL_B]) {
    const ref = db.collection('pools').doc(p);
    await ref.set({ name: p, type: 'NFL_PICKEM', participantIds: [UID, OTHER] });
    await ref.collection('members').doc(UID).set({ uid: UID, poolId: p, userName: 'New User', role: 'PARTICIPANT', paidStatus: 'PAID', feeOwed: 50 });
    await ref.collection('members').doc(OTHER).set({ uid: OTHER, poolId: p, userName: 'Other Person', role: 'PARTICIPANT', paidStatus: 'UNPAID' });
    await ref.collection('entries').doc(`${p}_${UID}_1`).set({ ownerUid: UID, poolId: p, entryIndex: 1, userName: 'New User', picks: { g1: 'KC' }, totalScore: 3 });
    await ref.collection('entries').doc(`${p}_${OTHER}_1`).set({ ownerUid: OTHER, poolId: p, entryIndex: 1, userName: 'Other Person', picks: {} });
  }
  // A second entry with a custom label — the label is NOT a copy of the profile name.
  await db.collection('pools').doc(POOL_A).collection('entries').doc(`${POOL_A}_${UID}_2`)
    .set({ ownerUid: UID, poolId: POOL_A, entryIndex: 2, entryName: 'Ron’s Wildcard', userName: 'New User', picks: {} });
  // A bracket-style entry: owned by the uid, but carries no userName at all.
  await db.collection('pools').doc(POOL_B).collection('entries').doc(`${POOL_B}_${UID}_bracket`)
    .set({ ownerUid: UID, poolId: POOL_B, name: 'My Bracket', score: 0 });
}

beforeEach(async () => { await wipe(); await seed(); });

describe('P1 — propagateUserName', () => {
  // Propagation is serialized against the profile: it commits only while
  // `users/{uid}.name` still equals the name being pushed. So the profile is
  // the precondition, not a side detail.
  beforeEach(async () => { await db.collection('users').doc(UID).set({ name: 'Ron Johnson' }); });

  it('rewrites userName on every member record and owned entry, across pools, and nothing else', async () => {
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result).toEqual({ members: 2, entries: 3, propCards: 0, playoffEntries: 0, superseded: false });

    for (const p of [POOL_A, POOL_B]) {
      const m = (await db.collection('pools').doc(p).collection('members').doc(UID).get()).data()!;
      expect(m.userName).toBe('Ron Johnson');
      // Paid state on the Member Record survives — this is an `update`, not a `set`.
      expect(m.paidStatus).toBe('PAID');
      expect(m.feeOwed).toBe(50);
      expect(m.role).toBe('PARTICIPANT');

      const e = (await db.collection('pools').doc(p).collection('entries').doc(`${p}_${UID}_1`).get()).data()!;
      expect(e.userName).toBe('Ron Johnson');
      expect(e.picks).toEqual({ g1: 'KC' });
      expect(e.totalScore).toBe(3);
    }
  });

  it('leaves other members and other owners untouched', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    for (const p of [POOL_A, POOL_B]) {
      expect((await db.collection('pools').doc(p).collection('members').doc(OTHER).get()).data()!.userName).toBe('Other Person');
      expect((await db.collection('pools').doc(p).collection('entries').doc(`${p}_${OTHER}_1`).get()).data()!.userName).toBe('Other Person');
    }
  });

  it('updates userName under a custom entryName but never the label itself', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    const e = (await db.collection('pools').doc(POOL_A).collection('entries').doc(`${POOL_A}_${UID}_2`).get()).data()!;
    expect(e.entryName).toBe('Ron’s Wildcard');
    expect(e.userName).toBe('Ron Johnson');
  });

  it('reaches a pre-multi-entry entries/{uid} doc that has no ownerUid (codex r3)', async () => {
    const legacy = db.collection('pools').doc(POOL_B).collection('entries').doc(UID);
    await legacy.set({ poolId: POOL_B, userName: 'New User', picks: { g1: 'KC' }, totalScore: 1 });
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result).toEqual({ members: 2, entries: 4, propCards: 0, playoffEntries: 0, superseded: false });
    const e = (await legacy.get()).data()!;
    expect(e.userName).toBe('Ron Johnson');
    expect(e.totalScore).toBe(1);
    expect('ownerUid' in e).toBe(false);
  });

  it('does not invent a userName on an entry that never carried one', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    const e = (await db.collection('pools').doc(POOL_B).collection('entries').doc(`${POOL_B}_${UID}_bracket`).get()).data()!;
    expect('userName' in e).toBe(false);
    expect(e.name).toBe('My Bracket');
  });

  it('is idempotent — a second run writes nothing', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    expect(await propagateUserName(db, UID, 'Ron Johnson')).toEqual({ members: 0, entries: 0, propCards: 0, playoffEntries: 0, superseded: false });
  });

  it('a uid with no pool copies is a no-op', async () => {
    expect(await propagateUserName(db, 'dn_nobody', 'Nobody')).toEqual({ members: 0, entries: 0, propCards: 0, playoffEntries: 0, superseded: false });
  });

  it('SUPERSEDED — commits nothing when the profile no longer carries the event name (codex r2 P2)', async () => {
    // The newer edit ("Ronald Johnson") has already landed on the profile; an
    // older event still holding "Ron Johnson" must not write it anywhere.
    await db.collection('users').doc(UID).set({ name: 'Ronald Johnson' });
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result).toEqual({ members: 0, entries: 0, propCards: 0, playoffEntries: 0, superseded: true });
    for (const p of [POOL_A, POOL_B]) {
      expect((await db.collection('pools').doc(p).collection('members').doc(UID).get()).data()!.userName).toBe('New User');
      expect((await db.collection('pools').doc(p).collection('entries').doc(`${p}_${UID}_1`).get()).data()!.userName).toBe('New User');
    }
    // And the current name goes through.
    expect(await propagateUserName(db, UID, 'Ronald Johnson')).toEqual({ members: 2, entries: 3, propCards: 0, playoffEntries: 0, superseded: false });
  });

  it('a missing profile commits nothing either', async () => {
    await db.collection('users').doc(UID).delete();
    expect(await propagateUserName(db, UID, 'Ron Johnson')).toEqual({ members: 0, entries: 0, propCards: 0, playoffEntries: 0, superseded: true });
    expect((await db.collection('pools').doc(POOL_A).collection('members').doc(UID).get()).data()!.userName).toBe('New User');
  });
});

describe('P2 — createUserProfileIfMissing (userSync.ts, the one Auth-create creator)', () => {
  const authUser = (over: Record<string, unknown> = {}) => ({
    uid: UID, email: 'Ron.Johnson@example.com', displayName: undefined, photoURL: undefined,
    providerData: [{ providerId: 'password' }],
    ...over,
  }) as never;

  it('never overwrites a profile the client already wrote — the "New User" race; it refreshes index/login fields only', async () => {
    await db.collection('users').doc(UID).set({ id: UID, name: 'Ron Johnson', referralCode: UID, registrationMethod: 'email', provider: 'password' });
    expect(await createUserProfileIfMissing(db, authUser())).toBe('exists');
    const u = (await db.collection('users').doc(UID).get()).data()!;
    expect(u.name).toBe('Ron Johnson');
    expect(u.referralCode).toBe(UID);
    expect(u.registrationMethod).toBe('email');
    // The index follows the name the profile SHOWS (the typed one), not the email prefix.
    expect(u.searchName).toBe('ron johnson');
    expect(u.searchEmail).toBe('ron.johnson@example.com');
    expect(u.email).toBe('Ron.Johnson@example.com');
    expect(u.lastLogin).toBeTruthy();
    expect('createdAt' in u).toBe(false);
  });

  it('creates the profile when absent, on the userSync schema, with the email prefix rather than a placeholder', async () => {
    expect(await createUserProfileIfMissing(db, authUser())).toBe('created');
    const u = (await db.collection('users').doc(UID).get()).data()!;
    expect(u.id).toBe(UID);
    expect(u.name).toBe('Ron.Johnson');
    expect(u.searchName).toBe('ron.johnson');
    expect(u.searchEmail).toBe('ron.johnson@example.com');
    expect(u.role).toBe('MEMBER');
    expect(u.registrationMethod).toBe('email');
    expect(u.provider).toBe('password');
    expect(u.picture).toBeNull();
    expect(u.createdAt).toBeTruthy();
    expect(u.lastLogin).toBeTruthy();
    // The retired participant.ts schema is gone: no `photoURL`, no numeric createdAt.
    expect('photoURL' in u).toBe(false);
    expect(typeof u.createdAt).not.toBe('number');
  });

  it('uses the Auth display name when it is there', async () => {
    await createUserProfileIfMissing(db, authUser({ displayName: 'Ron Johnson', providerData: [{ providerId: 'google.com' }] }));
    const u = (await db.collection('users').doc(UID).get()).data()!;
    expect(u.name).toBe('Ron Johnson');
    expect(u.searchName).toBe('ron johnson');
    expect(u.registrationMethod).toBe('google');
    expect(u.provider).toBe('google.com');
  });
});

describe('P7 — the NFL-playoff entries MAP follows the name (qodo #690 finding 1)', () => {
  const ref = db.collection('pools').doc(POOL_PLAYOFF);
  const E1 = `${UID}_1700000000000`;
  const E2 = 'custom.entry.id'; // caller-supplied ids may contain dots — FieldPath, not a dotted string
  const EO = `${OTHER}_1700000000001`;

  beforeEach(async () => {
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson' });
    await ref.set({
      name: POOL_PLAYOFF, type: 'NFL_PLAYOFF', participantIds: [UID, OTHER], isLocked: false,
      entries: {
        [E1]: { id: E1, userId: UID, userName: 'New User', entryName: 'New User', rankings: { KC: 14 }, tiebreaker: 40, totalScore: 7, submittedAt: 1, paid: true },
        [E2]: { id: E2, userId: UID, userName: 'New User', entryName: 'Ron’s Long Shot', rankings: { BUF: 14 }, tiebreaker: 41, totalScore: 0, submittedAt: 2 },
        [EO]: { id: EO, userId: OTHER, userName: 'Other Person', entryName: 'Other Person', rankings: {}, tiebreaker: 0, totalScore: 0, submittedAt: 3 },
      },
      results: { WILD_CARD: ['KC'] },
    });
  });

  it('rewrites userName on this uid’s entries only, never entryName, and nothing else on the pool', async () => {
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result).toEqual({ members: 2, entries: 3, propCards: 0, playoffEntries: 2, superseded: false });
    const pool = (await ref.get()).data()!;
    expect(pool.entries[E1].userName).toBe('Ron Johnson');
    expect(pool.entries[E1].entryName).toBe('New User'); // a label, even one that equals the old placeholder, is not ours
    expect(pool.entries[E1].totalScore).toBe(7);
    expect(pool.entries[E1].paid).toBe(true);
    expect(pool.entries[E1].rankings).toEqual({ KC: 14 });
    expect(pool.entries[E2].userName).toBe('Ron Johnson');
    expect(pool.entries[E2].entryName).toBe('Ron’s Long Shot');
    expect(pool.entries[EO].userName).toBe('Other Person');
    expect(pool.results).toEqual({ WILD_CARD: ['KC'] });
    expect(pool.participantIds).toEqual([UID, OTHER]);
    expect(Object.keys(pool.entries).sort()).toEqual([E1, E2, EO].sort());
  });

  it('is idempotent on the map too', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    expect(await propagateUserName(db, UID, 'Ron Johnson')).toEqual({ members: 0, entries: 0, propCards: 0, playoffEntries: 0, superseded: false });
  });

  it('does not resurrect an entry deleted after the query — and never invents one', async () => {
    // Only the other person's entry is left by the time the write runs: the
    // transaction re-reads the pool and finds nothing of ours to update.
    await ref.update({ entries: { [EO]: { id: EO, userId: OTHER, userName: 'Other Person', rankings: {}, tiebreaker: 0, totalScore: 0, submittedAt: 3 } } });
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result.playoffEntries).toBe(0);
    const pool = (await ref.get()).data()!;
    expect(Object.keys(pool.entries)).toEqual([EO]);
  });

  it('a pool the uid is listed on that has no entries map (Pick’em) is skipped', async () => {
    await ref.update({ entries: admin.firestore.FieldValue.delete() });
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result.playoffEntries).toBe(0);
    expect('entries' in (await ref.get()).data()!).toBe(false);
  });

  it('SUPERSEDED — commits nothing to the map when the profile has moved on', async () => {
    await db.collection('users').doc(UID).set({ name: 'Ronald Johnson' });
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result.superseded).toBe(true);
    expect(result.playoffEntries).toBe(0);
    expect((await ref.get()).data()!.entries[E1].userName).toBe('New User');
  });
});

describe('P8 — prop-bet cards follow the name (qodo #690 finding 2)', () => {
  const ref = db.collection('pools').doc(POOL_PROPS);
  const cards = ref.collection('propCards');

  beforeEach(async () => {
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson' });
    await ref.set({ name: POOL_PROPS, type: 'SQUARES', participantIds: [UID], entryCount: 3 });
    await cards.doc('card_1').set({ userId: UID, userName: 'New User', cardName: 'Card #1', purchasedAt: 1, answers: { q1: 0 }, score: 4, tiebreakerVal: 10 });
    await cards.doc('card_2').set({ userId: UID, userName: 'New User', cardName: 'Card #2', purchasedAt: 2, answers: { q1: 1 }, score: 0 });
    await cards.doc('card_guest').set({ userId: 'guest:someone@example.com', userName: 'New User', cardName: 'Card #1', purchasedAt: 3, answers: {}, score: 0 });
    await cards.doc('card_other').set({ userId: OTHER, userName: 'Other Person', cardName: 'Card #1', purchasedAt: 4, answers: {}, score: 0 });
  });

  it('rewrites userName on every card this uid bought and nothing else', async () => {
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result).toEqual({ members: 2, entries: 3, propCards: 2, playoffEntries: 0, superseded: false });
    const c1 = (await cards.doc('card_1').get()).data()!;
    expect(c1.userName).toBe('Ron Johnson');
    expect(c1.cardName).toBe('Card #1');
    expect(c1.answers).toEqual({ q1: 0 });
    expect(c1.score).toBe(4);
    expect(c1.tiebreakerVal).toBe(10);
    expect((await cards.doc('card_2').get()).data()!.userName).toBe('Ron Johnson');
  });

  it('leaves a guest card (its userId is an email key, not a uid) and other people’s cards alone', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    expect((await cards.doc('card_guest').get()).data()!.userName).toBe('New User');
    expect((await cards.doc('card_other').get()).data()!.userName).toBe('Other Person');
  });

  it('is idempotent', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    expect(await propagateUserName(db, UID, 'Ron Johnson')).toEqual({ members: 0, entries: 0, propCards: 0, playoffEntries: 0, superseded: false });
  });
});

describe('P4 — stampSearchName keeps the admin name index on the new name', () => {
  it('lowercases the new name into searchName and reports the write', async () => {
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson', searchName: 'new user', searchEmail: 'ron.johnson@example.com' });
    expect(await stampSearchName(db, UID, 'Ron Johnson')).toBe(true);
    const u = (await db.collection('users').doc(UID).get()).data()!;
    expect(u.searchName).toBe('ron johnson');
    expect(u.searchEmail).toBe('ron.johnson@example.com');
  });
  it('is a no-op when already current, and on a missing profile', async () => {
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson', searchName: 'ron johnson' });
    expect(await stampSearchName(db, UID, 'Ron Johnson')).toBe(false);
    expect(await stampSearchName(db, 'dn_nobody', 'Nobody')).toBe(false);
  });
  it('refuses a superseded name — the profile has moved on since this event', async () => {
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson', searchName: 'new user' });
    expect(await stampSearchName(db, UID, 'Ron Johnso')).toBe(false);
    expect((await db.collection('users').doc(UID).get()).data()!.searchName).toBe('new user');
  });
});

describe('P5 — isCurrentProfileName is the supersession check the trigger runs first', () => {
  it('true only while the profile still carries the event name (trimmed)', async () => {
    await db.collection('users').doc(UID).set({ name: ' Ron Johnson ' });
    expect(await isCurrentProfileName(db, UID, 'Ron Johnson')).toBe(true);
    expect(await isCurrentProfileName(db, UID, 'Ron Johnso')).toBe(false);
    expect(await isCurrentProfileName(db, 'dn_nobody', 'Nobody')).toBe(false);
  });
});

describe('P6 — a pick submission stamps the PROFILE name, read inside its transaction (qodo #690 finding 2)', () => {
  const POOL_C = 'dn_pool_c';
  const GAME = 'dn_game_1';
  const SEASON = 'dn-season';
  const T = (abbr: string) => ({ id: abbr, name: abbr, abbreviation: abbr });

  beforeEach(async () => {
    await db.collection('nfl_games').doc(GAME).set({
      id: GAME, espnGameId: GAME, season: SEASON, seasonType: 1, week: 1,
      startTime: Date.now() + 4 * 60 * 60 * 1000, status: 'SCHEDULED', isMonday: false,
      homeTeam: T('KC'), awayTeam: T('BUF'), scores: { home: 0, away: 0 }, spread: { value: -3, locked: true },
    });
    const ref = db.collection('pools').doc(POOL_C);
    await ref.set({
      name: POOL_C, type: 'NFL_PICKEM', league: 'NFL', season: SEASON, seasonType: 1,
      ownerId: OTHER, participantIds: [OTHER, UID], status: 'OPEN', billing: { status: 'free' },
      settings: { entryFee: 25, lockMode: 'PER_GAME', pickMode: 'STRAIGHT', confidenceMode: false },
    });
    await ref.collection('members').doc(UID).set({
      uid: UID, poolId: POOL_C, userName: 'New User', role: 'PARTICIPANT',
      paidStatus: 'UNPAID', joinedAt: Date.now(), feeOwed: 25, feeOwedSource: 'LIVE', hasPlayableEntry: false,
    });
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson' });
  });

  it('writes the profile name to the entry and the member record even when the login token carries an older one', async () => {
    await submitNFLPicksInternal(db, { actorUid: UID, subjectUid: UID, subjectName: 'Old Token Name' } as never, {
      poolId: POOL_C, week: 1, picks: { [GAME]: 'BUF' },
    } as never);
    const entries = await db.collection('pools').doc(POOL_C).collection('entries').where('ownerUid', '==', UID).get();
    expect(entries.size).toBe(1);
    expect(entries.docs[0].data().userName).toBe('Ron Johnson');
    expect((await db.collection('pools').doc(POOL_C).collection('members').doc(UID).get()).data()!.userName).toBe('Ron Johnson');
  }, 30000);

  it('falls back to the token name when the profile holds a placeholder', async () => {
    await db.collection('users').doc(UID).set({ name: 'New User' });
    await submitNFLPicksInternal(db, { actorUid: UID, subjectUid: UID, subjectName: 'Typed Name' } as never, {
      poolId: POOL_C, week: 1, picks: { [GAME]: 'BUF' },
    } as never);
    const entries = await db.collection('pools').doc(POOL_C).collection('entries').where('ownerUid', '==', UID).get();
    expect(entries.docs[0].data().userName).toBe('Typed Name');
  }, 30000);
});

describe('P3 — resolveSubjectName', () => {
  it('prefers the profile over the login token', async () => {
    await db.collection('users').doc(UID).set({ name: 'Ron Johnson' });
    expect(await resolveSubjectName(db, UID, 'Old Token Name')).toBe('Ron Johnson');
  });
  it('falls back to the token when the profile holds a placeholder', async () => {
    await db.collection('users').doc(UID).set({ name: 'New User' });
    expect(await resolveSubjectName(db, UID, 'Typed Name')).toBe('Typed Name');
  });
  it('returns undefined when there is no profile and no token name', async () => {
    expect(await resolveSubjectName(db, 'dn_nobody', undefined)).toBeUndefined();
  });
});
