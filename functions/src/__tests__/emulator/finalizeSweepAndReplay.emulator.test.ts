import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import './setup';
import ftest from 'firebase-functions-test';
import { encodeSnapshot } from '../../lib/feedSnapshot';
import { nflFinalizeSweepJob } from '../../nflFinalize';
import { replayFeedSnapshot } from '../../feedReplay';

/**
 * The two preseason paths with the worst coverage-to-risk ratio.
 *
 * `nflFinalizeSweepJob` HAS NEVER COMPLETED A PRODUCTION RUN. It was armed on
 * 2026-07-10 and threw FAILED_PRECONDITION every day for ten days on a missing
 * composite index, producing zero audit entries, and nobody noticed because a
 * scheduled job's throw goes nowhere a human looks. The index is fixed, but the
 * sweep body itself — candidate selection, the staleness filter, sim-pool
 * exclusion, live scoping, the cap — had no test at any level. Its unit tests
 * cover `readSweepGate` and `sweepRunVerdict`; nothing covered the loop that
 * decides which real pools get finalized.
 *
 * `replayFeedSnapshot` is the break-glass tool that turns a correlated feed
 * failure from a refund event into a delay. It had never been exercised
 * end-to-end against a real stored payload.
 *
 * These drive the actual deployed callables against the Firestore emulator, so
 * what is asserted is the wiring and the decisions — not a re-implementation of
 * them in the test.
 */
const test = ftest();
const db = admin.firestore();

/**
 * firebase-functions-test's `wrap()` is typed for CloudEvent handlers and does
 * not accept a v2 ScheduledFunction, whose event carries a required
 * `scheduleTime`. The cast is confined to this one line so the rest of the file
 * stays typed; the call below still supplies a real scheduleTime.
 *
 * It must also be invoked with NO arguments. firebase-functions-test treats a
 * scheduled wrapper's first argument as an OPTIONS object and rejects unknown
 * keys, so passing a plausible-looking `{ scheduleTime }` fails at runtime even
 * though it satisfies the ScheduledEvent type. Both halves of that were learned
 * the hard way in this PR: `wrappedSweep({})` passes vitest and fails
 * `tsc --noEmit`; `wrappedSweep({ scheduleTime })` passes tsc and fails at
 * runtime. Typing the cast as a zero-arg function is what satisfies both.
 */
const runSweep = test.wrap(nflFinalizeSweepJob as never) as () => Promise<unknown>;
const runReplay = test.wrap(replayFeedSnapshot);

const superAdmin = { uid: 'admin-1', token: { role: 'SUPER_ADMIN', email: 'a@b.co' } } as any;

/**
 * `validated({ role })` runs assertCallerRole, which requires the CLAIM and the
 * users/{uid} profile role to agree — a stale token cannot act alone. So an
 * emulator caller needs both halves seeded.
 */
async function seedUser(uid: string, role: string) {
  await db.collection('users').doc(uid).set({ role });
}

async function clear(...cols: string[]) {
  for (const c of cols) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
}

async function setGate(cfg: Record<string, unknown> | null) {
  if (cfg === null) {
    await db.doc('system/config').delete();
    return;
  }
  await db.doc('system/config').set({ nflFinalize: cfg }, { merge: true });
}

/**
 * A pool the sweep should treat as a stale candidate: scored at least once, and
 * scored more recently than it was finalized.
 */
async function seedPool(id: string, over: Record<string, unknown> = {}) {
  await db.collection('pools').doc(id).set({
    type: 'NFL_PICKEM',
    scoredThroughWeek: 1,
    seasonType: 1,
    lastScoredAt: admin.firestore.Timestamp.fromMillis(2_000),
    finalizedAt: admin.firestore.Timestamp.fromMillis(1_000),
    ...over,
  });
}

/**
 * `capMetadata` replaces any nested object in an admin_audit entry with a short
 * "[object]" marker, so structured detail is NOT readable from the audit doc.
 * The heartbeat's `detail` is stored raw, and that is where the counts live.
 */
async function sweepHeartbeat() {
  const snap = await db.doc('system/heartbeats').get();
  return (snap.data() as any)?.nflFinalizeSweepJob;
}

async function sweepAudits() {
  const snap = await db.collection('admin_audit').where('action', '==', 'NFL_FINALIZE_SWEEP').get();
  return snap.docs.map((d) => d.data() as any);
}

beforeEach(async () => {
  await clear('pools', 'admin_audit', 'nfl_games', 'nfl_feed_snapshots', 'users');
  await db.doc('system/heartbeats').delete().catch(() => undefined);
  await db.doc('system/config').delete().catch(() => undefined);
});

describe('nflFinalizeSweepJob — the gate', () => {
  it('does nothing and writes no audit when disabled', async () => {
    await seedPool('p1');
    await setGate({ enabled: false });
    await runSweep();
    expect(await sweepAudits()).toHaveLength(0);
  });

  it('treats a MISSING config as disabled — fail-safe, not fail-open', async () => {
    await seedPool('p1');
    await setGate(null);
    await runSweep();
    expect(await sweepAudits()).toHaveLength(0);
  });

  it('stays DRY when dryRun:false is set without liveSeasonTypes, and says why', async () => {
    // The deliberate two-key arming rule: dryRun:false alone must not go live.
    await seedPool('p1');
    await setGate({ enabled: true, dryRun: false });
    await runSweep();

    const [audit] = await sweepAudits();
    expect(audit.metadata.dryRun).toBe(true);
    expect(audit.metadata.forcedDryReason).toBeTruthy();
    // Nothing was finalized despite the operator asking for live.
    expect((await db.collection('pools').doc('p1').get()).data()?.finalizedAt.toMillis()).toBe(1_000);
  });
});

describe('nflFinalizeSweepJob — candidate selection (dry run)', () => {
  beforeEach(async () => {
    await setGate({ enabled: true, dryRun: true });
  });

  it('counts a stale pool and reports the seasonType spread', async () => {
    await seedPool('stale-1', { seasonType: 1 });
    await seedPool('stale-2', { seasonType: 2 });
    await runSweep();

    const [audit] = await sweepAudits();
    expect(audit.metadata.candidates).toBe(2);
    // The seasonType spread an operator reads to choose liveSeasonTypes is
    // present, but capMetadata stores nested objects as a marker — so this can
    // only assert it was recorded, not its contents. Stated rather than dressed
    // up as a stronger check than it is.
    expect(audit.metadata.bySeasonType).toBe('[object]');
  });

  it('excludes a pool already finalized after its last scoring', async () => {
    await seedPool('done', {
      finalizedAt: admin.firestore.Timestamp.fromMillis(9_000),
      lastScoredAt: admin.firestore.Timestamp.fromMillis(2_000),
    });
    await runSweep();
    expect((await sweepAudits())[0].metadata.candidates).toBe(0);
  });

  it('excludes a CANCELED pool', async () => {
    await seedPool('cancelled', { status: 'CANCELED' });
    await runSweep();
    expect((await sweepAudits())[0].metadata.candidates).toBe(0);
  });

  it('excludes a Test Pool by its persisted simRunId, not by doc id', async () => {
    // Sim pool ids are server-generated, so an id-prefix check alone excludes
    // NOTHING — the persisted field is the real marker.
    await seedPool('ordinary-looking-id', { simRunId: 'run-abc' });
    await runSweep();
    expect((await sweepAudits())[0].metadata.candidates).toBe(0);
  });

  it('excludes a pool that has never been scored', async () => {
    await seedPool('unscored', { scoredThroughWeek: 0 });
    await runSweep();
    expect((await sweepAudits())[0].metadata.candidates).toBe(0);
  });

  it('a dry run finalizes NOTHING even with live candidates present', async () => {
    await seedPool('p1');
    await runSweep();
    expect((await db.collection('pools').doc('p1').get()).data()?.finalizedAt.toMillis()).toBe(1_000);
  });
});

describe('nflFinalizeSweepJob — live scoping', () => {
  it('processes only pools inside liveSeasonTypes and counts the rest out-of-scope', async () => {
    // The scope-before-cap property: a preseason-only arm against a mostly
    // regular-season pool list must not let out-of-scope pools occupy the
    // prefix and starve the pools the operator actually armed.
    await seedPool('pre-1', { seasonType: 1 });
    await seedPool('reg-1', { seasonType: 2 });
    await seedPool('reg-2', { seasonType: 2 });
    await setGate({ enabled: true, dryRun: false, liveSeasonTypes: [1] });

    await runSweep();

    const [audit] = await sweepAudits();
    expect(audit.metadata.dryRun).toBe(false);
    expect(audit.metadata.candidates).toBe(3);
    expect(audit.metadata.processed).toBe(1);
    expect(audit.metadata.outOfScope).toBe(2);
    // The audit's own arithmetic must reconcile, or the report is unreadable.
    expect(audit.metadata.processed + audit.metadata.outOfScope + audit.metadata.deferred)
      .toBe(audit.metadata.candidates);
  });

  it('a pool that THREW during finalize makes the whole run unhealthy', async () => {
    // The per-pool catch keeps one bad pool from ending the sweep. That meant a
    // run where every pool threw still stamped ok:true — the silent-success bug
    // sweepRunVerdict exists to stop. This pool is missing the fields
    // maybeFinalizeNFLPool needs, so it throws and is counted as errored.
    await seedPool('pre-1', { seasonType: 1 });
    await setGate({ enabled: true, dryRun: false, liveSeasonTypes: [1] });

    await runSweep();

    const hb = await sweepHeartbeat();
    expect(hb.ok).toBe(false);
    expect(hb.error).toMatch(/threw during finalization/);
    expect(hb.detail).toMatchObject({ finalized: 0, skipped: 1, errored: 1 });
  });

  it('stamps a heartbeat even when the sweep is disabled — the schedule fired', async () => {
    // The whole point of the wrapper: proving the SCHEDULE ran is separate from
    // the job doing work. This is the signal that was missing for ten days.
    await setGate({ enabled: false });
    await runSweep();

    const hb = await sweepHeartbeat();
    expect(hb.ok).toBe(true);
    expect(hb.detail).toEqual({ enabled: false });
  });
});

describe('replayFeedSnapshot', () => {
  const SEASON = '2026';
  const WEEK = 1;

  /** One ESPN-shaped event, gzipped exactly as the snapshot writer stores it. */
  async function seedSnapshot(id: string, over: Record<string, unknown> = {}) {
    const payload = {
      events: [{
        id: '401873271',
        status: { type: { id: '3', name: 'STATUS_FINAL', state: 'post' }, displayClock: '0:00', period: 4 },
        competitions: [{
          date: '2026-08-07T00:00Z',
          competitors: [
            { homeAway: 'home', score: '21', team: { id: '22', name: 'Cardinals', abbreviation: 'ARI', logo: 'h.png' } },
            { homeAway: 'away', score: '17', team: { id: '29', name: 'Panthers', abbreviation: 'CAR', logo: 'a.png' } },
          ],
          odds: [{ details: 'CAR -1.5' }],
        }],
      }],
    };
    await db.collection('nfl_feed_snapshots').doc(id).set({
      season: SEASON,
      seasonType: 1,
      week: WEEK,
      slate: `${SEASON}/1/${WEEK}`,
      fetchedAt: 1_700_000_000_000,
      // The SAME encoder the live snapshot writer uses; a Buffer maps to a
      // Firestore Bytes field exactly as feedSnapshotStore.ts stores it.
      payloadGzip: encodeSnapshot(payload).gzipped,
      ...over,
    });
  }

  async function replayAudits() {
    const snap = await db.collection('admin_audit').where('action', '==', 'NFL_FEED_REPLAY').get();
    return snap.docs.map((d) => d.data() as any);
  }

  beforeEach(async () => {
    await seedUser('admin-1', 'SUPER_ADMIN');
  });

  it('defaults to DRY RUN and writes no game rows', async () => {
    // dryRun defaults true at the SCHEMA layer; omitting it must not go live.
    await seedSnapshot('snap-1');
    const res: any = await runReplay({ data: { snapshotId: 'snap-1' }, auth: superAdmin } as never);

    expect(res.dryRun).toBe(true);
    expect(res.games).toBe(1);
    expect((await db.collection('nfl_games').get()).size).toBe(0);
    expect((await replayAudits())[0].metadata.dryRun).toBe(true);
  });

  it('a LIVE run rebuilds nfl_games from the stored payload', async () => {
    await seedSnapshot('snap-1');
    const res: any = await runReplay({
      data: { snapshotId: 'snap-1', dryRun: false }, auth: superAdmin,
    } as never);

    expect(res.dryRun).toBe(false);
    const games = await db.collection('nfl_games').get();
    expect(games.size).toBe(1);
    expect(games.docs[0].data()).toMatchObject({ season: SEASON, week: WEEK });
    // The operator is told what to do next — replay restores GAMES, not scores.
    expect(res.nextStep).toMatch(/Re-score week 1/);
  });

  it('a failed attempt is still attributable — missing snapshot writes an error audit', async () => {
    // "Every run is attributable" is only true if the FAILURE paths audit too.
    await expect(runReplay({ data: { snapshotId: 'nope' }, auth: superAdmin } as never))
      .rejects.toThrow(/not found/i);

    const audits = await replayAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].status).toBe('error');
    expect(audits[0].metadata.snapshotId).toBe('nope');
  });

  it('refuses a snapshot that parses to zero games rather than wiping the slate', async () => {
    await seedSnapshot('empty', {
      payloadGzip: encodeSnapshot({ events: [] }).gzipped,
    });
    await expect(runReplay({ data: { snapshotId: 'empty', dryRun: false }, auth: superAdmin } as never))
      .rejects.toThrow(/zero games/i);
    expect((await db.collection('nfl_games').get()).size).toBe(0);
  });

  it('refuses a snapshot with no stored payload', async () => {
    await db.collection('nfl_feed_snapshots').doc('bare').set({ season: SEASON, seasonType: 1, week: WEEK });
    await expect(runReplay({ data: { snapshotId: 'bare' }, auth: superAdmin } as never))
      .rejects.toThrow(/no stored payload/i);
  });

  it('rejects a non-SUPER_ADMIN caller', async () => {
    await seedSnapshot('snap-1');
    await seedUser('c-1', 'COMMISSIONER');
    const commissioner = { uid: 'c-1', token: { role: 'COMMISSIONER' } } as any;
    await expect(runReplay({ data: { snapshotId: 'snap-1' }, auth: commissioner } as never))
      .rejects.toThrow();
    expect((await db.collection('nfl_games').get()).size).toBe(0);
  });
});
