import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import './setup';
import { isCurrentProfileName, propagateUserName, resolveSubjectName, stampSearchName } from '../../lib/displayName';
import { createParticipantProfileIfMissing } from '../../participant';

/**
 * Display-name ownership, the half only a live Firestore can prove:
 *
 *  P1 — `propagateUserName` rewrites `userName` on EVERY Member Record and
 *       every owned entry across pools, touches nothing else on those docs,
 *       leaves other members / other owners / `entryName` alone, skips docs
 *       that carry no `userName` (bracket entries), and is idempotent.
 *  P2 — `createParticipantProfileIfMissing` never overwrites an existing
 *       profile (the "New User" race, 2026-09-10) and falls back to the email
 *       prefix, not a placeholder, when the Auth record has no display name.
 *  P3 — `resolveSubjectName` prefers the PROFILE over the login token, so a
 *       fixed name no longer reverts on the next pick.
 */
const db = admin.firestore();

const UID = 'dn_target';
const OTHER = 'dn_other';
const POOL_A = 'dn_pool_a';
const POOL_B = 'dn_pool_b';

async function wipe() {
  for (const p of [POOL_A, POOL_B]) {
    const ref = db.collection('pools').doc(p);
    for (const sub of ['members', 'entries']) {
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
  it('rewrites userName on every member record and owned entry, across pools, and nothing else', async () => {
    const result = await propagateUserName(db, UID, 'Ron Johnson');
    expect(result).toEqual({ members: 2, entries: 3 });

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

  it('does not invent a userName on an entry that never carried one', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    const e = (await db.collection('pools').doc(POOL_B).collection('entries').doc(`${POOL_B}_${UID}_bracket`).get()).data()!;
    expect('userName' in e).toBe(false);
    expect(e.name).toBe('My Bracket');
  });

  it('is idempotent — a second run writes nothing', async () => {
    await propagateUserName(db, UID, 'Ron Johnson');
    expect(await propagateUserName(db, UID, 'Ron Johnson')).toEqual({ members: 0, entries: 0 });
  });

  it('a uid with no pool copies is a no-op', async () => {
    expect(await propagateUserName(db, 'dn_nobody', 'Nobody')).toEqual({ members: 0, entries: 0 });
  });
});

describe('P2 — createParticipantProfileIfMissing', () => {
  const authUser = (over: Record<string, unknown> = {}) => ({
    uid: UID, email: 'ron.johnson@example.com', displayName: undefined, photoURL: undefined,
    providerData: [{ providerId: 'password' }],
    ...over,
  }) as never;

  it('never overwrites a profile the client (or the other trigger) already wrote — the "New User" race', async () => {
    await db.collection('users').doc(UID).set({ id: UID, name: 'Ron Johnson', referralCode: UID, registrationMethod: 'email' });
    expect(await createParticipantProfileIfMissing(db, authUser())).toBe('exists');
    const u = (await db.collection('users').doc(UID).get()).data()!;
    expect(u.name).toBe('Ron Johnson');
    expect(u.referralCode).toBe(UID);
    expect(u.registrationMethod).toBe('email');
  });

  it('creates the profile when absent, with the email prefix rather than a placeholder', async () => {
    expect(await createParticipantProfileIfMissing(db, authUser())).toBe('created');
    const u = (await db.collection('users').doc(UID).get()).data()!;
    expect(u.name).toBe('ron.johnson');
    expect(u.role).toBe('MEMBER');
    expect(u.provider).toBe('password');
  });

  it('uses the Auth display name when it is there', async () => {
    await createParticipantProfileIfMissing(db, authUser({ displayName: 'Ron Johnson' }));
    expect((await db.collection('users').doc(UID).get()).data()!.name).toBe('Ron Johnson');
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
