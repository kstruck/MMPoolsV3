import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import ftest from 'firebase-functions-test';
import { sendManualReminder } from '../../manualReminders';
import { setPaidStatus } from '../../setPaidStatus';

/**
 * End-to-end coverage for the commissioner "nudge", through the real callable.
 *
 * This file exists because of a defect the unit suite structurally could not
 * see. `manualReminderTargets.test.ts` calls `resolveReminderTargets` directly,
 * so it proved the RULE while the CALL SITE handed that rule a projection with
 * the membership discriminator stripped out — every roster-only member looked
 * forged and was dropped, which is precisely the bug this feature exists to fix.
 * 79 unit tests stayed green. codex found it by reading the caller.
 *
 * `sendEmail` only writes to the `mail` collection (the Firestore email
 * extension's queue), so there is no transport to stub: the assertion is which
 * documents land there.
 */
const test = ftest();
const db = admin.firestore();
const wrappedReminder = test.wrap(sendManualReminder);
const wrappedSetPaid = test.wrap(setPaidStatus);

const POOL = 'mr_pool';
const BOSS = { uid: 'mr_boss', token: {} };
const JOINED = 1_700_000_000_000;

async function seedUser(uid: string, name: string) {
  await db.collection('users').doc(uid).set({ role: 'PARTICIPANT', name, email: `${uid}@example.com` });
}

async function wipe() {
  for (const col of ['mail', 'notifications', 'users']) {
    const s = await db.collection(col).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  const pools = await db.collection('pools').get();
  for (const p of pools.docs) {
    for (const sub of ['members', 'entries']) {
      const s = await p.ref.collection(sub).get();
      await Promise.all(s.docs.map((d) => d.ref.delete()));
    }
    await p.ref.delete();
  }
}

/** Recipients of every queued email, sorted. */
async function mailedTo(): Promise<string[]> {
  const snap = await db.collection('mail').get();
  return snap.docs.map((d) => d.data().to as string).sort();
}

beforeEach(wipe);
afterAll(() => test.cleanup());

describe('sendManualReminder — who actually gets the email', () => {
  async function seedPool() {
    await db.collection('pools').doc(POOL).set({
      id: POOL, type: 'NFL_PICKEM', name: 'Nudge Pool', ownerId: 'mr_boss',
      participantIds: ['mr_boss', 'mr_never', 'mr_entry'], status: 'OPEN',
      settings: { entryFee: 25 },
    });
    await Promise.all([
      seedUser('mr_boss', 'Boss'),
      seedUser('mr_never', 'Never Submitted'),
      seedUser('mr_entry', 'Entry Only'),
      seedUser('mr_forger', 'Forger'),
    ]);
    // The whole point of the feature: on the roster, never submitted anything.
    await db.collection('pools').doc(POOL).collection('members').doc('mr_never').set({
      uid: 'mr_never', poolId: POOL, userName: 'Never Submitted',
      role: 'PARTICIPANT', paidStatus: 'UNPAID', joinedAt: JOINED,
    });
    // A legacy member represented ONLY by an entry (pre-Member-Record pool).
    await db.collection('pools').doc(POOL).collection('entries').doc('mr_entry').set({
      id: 'mr_entry', poolId: POOL, ownerUid: 'mr_entry', userName: 'Entry Only', picks: {},
    });
    // Exactly what the pre-#344 setPaidStatus claim bug minted: the two
    // self-report fields, no server-seeded joinedAt.
    await db.collection('pools').doc(POOL).collection('members').doc('mr_forger').set({
      memberReportedPaid: true, memberReportedAt: JOINED,
    });
  }

  it('reaches a roster-only member — the case the unit tests could not prove', async () => {
    // The regression this file was written for: a call site that projected
    // `joinedAt` away made this member undeliverable while every unit test
    // still passed.
    await seedPool();

    const res = (await wrappedReminder({
      data: { poolId: POOL, kind: 'PICKS' }, auth: BOSS,
    } as never)) as { sent: number; skipped: number };

    expect(await mailedTo()).toContain('mr_never@example.com');
    expect(res.sent).toBeGreaterThanOrEqual(2);
  });

  it('still reaches an entry-only member from a pre-Member-Record pool', async () => {
    await seedPool();

    await wrappedReminder({ data: { poolId: POOL, kind: 'PICKS' }, auth: BOSS } as never);

    expect(await mailedTo()).toContain('mr_entry@example.com');
  });

  it('does NOT email a forged Member Record (§4a)', async () => {
    await seedPool();

    await wrappedReminder({ data: { poolId: POOL, kind: 'PICKS' }, auth: BOSS } as never);

    expect(await mailedTo()).not.toContain('mr_forger@example.com');
  });

  it('sends to exactly the roster, forger excluded', async () => {
    // Pinned as a set rather than a count: a resolver that dropped the real
    // members AND the forger would satisfy "forger got nothing" while being
    // completely broken.
    await seedPool();

    await wrappedReminder({ data: { poolId: POOL, kind: 'PICKS' }, auth: BOSS } as never);

    expect(await mailedTo()).toEqual(['mr_entry@example.com', 'mr_never@example.com']);
  });

  it('still nudges a legacy member whose ONLY record came from their own claim', async () => {
    // codex P2 on this PR, end to end. `mr_legacy` is in participantIds with no
    // Member Record and no entry — a legacy/partially-backfilled pool. The
    // membership guard admits their self-report on that evidence, and the record
    // it writes is the ONLY one they have. If that write is not stamped canonical,
    // this filter calls it a forgery and the member is silently unreachable —
    // the guard and the filter disagreeing about the same person.
    await seedPool();
    await seedUser('mr_legacy', 'Legacy Claimer');
    await db.collection('pools').doc(POOL).update({
      participantIds: ['mr_boss', 'mr_never', 'mr_entry', 'mr_legacy'],
    });

    await wrappedSetPaid({
      data: { poolId: POOL, memberUid: 'mr_legacy', claim: true },
      auth: { uid: 'mr_legacy', token: { name: 'Legacy Claimer' } },
    } as never);

    await wrappedReminder({ data: { poolId: POOL, kind: 'PICKS' }, auth: BOSS } as never);

    expect(await mailedTo()).toContain('mr_legacy@example.com');
  });

  it('refuses to single out a forger by uid', async () => {
    // The Nudge button sends one uid. The filter must hold on that path too,
    // not just on the send-to-everyone path.
    await seedPool();

    const res = (await wrappedReminder({
      data: { poolId: POOL, kind: 'PICKS', targetUids: ['mr_forger'] }, auth: BOSS,
    } as never)) as { sent: number };

    expect(res.sent).toBe(0);
    expect(await mailedTo()).toEqual([]);
  });
});
