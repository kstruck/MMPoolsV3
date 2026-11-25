import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adminAuditDoc, writeAdminAudit } from '../../lib/adminAudit';

/**
 * THE AUDIT SWEEP'S READER, AGAINST A REAL FIRESTORE (the emulator).
 *
 * `scripts/agent/audit-reader.mjs` is the only code in scripts/agent that
 * touches Firestore, and the root suite can only test it as text. This file
 * runs its four reads for real: the count aggregation, the windowed ordered
 * query, the limit-1 equality query and the `getAll` existence check.
 *
 * It also closes the loop the root suite cannot: rows are written here by the
 * PRODUCTION writer (`writeAdminAudit`), read back by the reader, and judged
 * by the sweep's own shape check. If `adminAuditDoc` ever gains or renames a
 * field, the sweep would call every new row malformed, and this is the test
 * that says so first.
 *
 * The two scripts are loaded by path at run time. They live outside
 * `functions/src`, and a static import would pull them into this TypeScript
 * program (TS6059 under `rootDir: "src"`).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const load = (rel: string) => import(pathToFileURL(path.join(REPO_ROOT, rel)).href);

const db = admin.firestore();
const NOW = new Date();
const daysAgo = (n: number) => Timestamp.fromDate(new Date(NOW.getTime() - n * 86_400_000));

async function wipe() {
  for (const coll of ['admin_audit', 'pools']) {
    const snap = await db.collection(coll).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/** A row written as production writes it, then moved to a chosen time. */
async function seed(action: string, at: Timestamp, over: Record<string, unknown> = {}) {
  const ref = db.collection('admin_audit').doc();
  await ref.set({ ...adminAuditDoc({ actorUid: 'system', action, status: 'success' }), at, ...over });
  return ref.id;
}

let opened: { describe: string; reader: Record<string, (...a: unknown[]) => Promise<unknown>>; close: () => Promise<void> };
let lib: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(async () => {
  await wipe();
  lib ??= await load('scripts/agent/audit-lib.mjs');
  if (!opened) {
    const { openAuditReader } = await load('scripts/agent/audit-reader.mjs');
    opened = await openAuditReader({ repoRoot: REPO_ROOT, env: process.env });
  }
});
afterAll(async () => {
  await opened?.close();
});

describe('audit-reader.mjs against the emulator', () => {
  it('opens the emulator, not production', () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    expect(opened.describe).toMatch(/^the EMULATOR at /);
  });

  it('countWindow and readWindow agree, keep to the window, and return rows oldest first', async () => {
    const old = await seed('ROLE_CHANGED', daysAgo(45));
    const a = await seed('POOL_CLOSED', daysAgo(20));
    const b = await seed('AUTO_CLOSE_SWEEP', daysAgo(2));
    const since = daysAgo(30).toDate().toISOString();

    expect(await opened.reader.countWindow(since)).toBe(2);
    const rows = (await opened.reader.readWindow(since, 100)) as { id: string; at: string }[];
    expect(rows.map((r) => r.id)).toEqual([a, b]);
    expect(rows.map((r) => r.id)).not.toContain(old);
    // `at` arrives as an ISO string, which is what the shape check expects.
    for (const r of rows) expect(Number.isFinite(Date.parse(r.at))).toBe(true);
  });

  it('readWindow honours its limit', async () => {
    for (let i = 0; i < 5; i++) await seed('EMAIL_SENT', daysAgo(i + 1));
    const rows = (await opened.reader.readWindow(daysAgo(30).toDate().toISOString(), 3)) as unknown[];
    expect(rows).toHaveLength(3);
  });

  it('a row whose `at` is not a Timestamp is invisible to the window — the limit the skill states', async () => {
    await db.collection('admin_audit').doc('bad-at').set({ ...adminAuditDoc({ actorUid: 'x', action: 'ROLE_CHANGED', status: 'success' }), at: 'yesterday' });
    const since = daysAgo(30).toDate().toISOString();
    expect(await opened.reader.countWindow(since)).toBe(0);
    expect(await opened.reader.readWindow(since, 10)).toEqual([]);
  });

  it('actionEverWritten looks at the whole collection, not the window', async () => {
    await seed('AUTH_BACKUP', daysAgo(200));
    expect(await opened.reader.actionEverWritten('AUTH_BACKUP')).toBe(true);
    expect(await opened.reader.actionEverWritten('NFL_FINALIZE_SWEEP')).toBe(false);
  });

  it('existingPoolIds returns the pools that exist, across more than one batch of 100', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `pool-${i}`);
    const real = ids.filter((_, i) => i % 3 === 0);
    for (let i = 0; i < real.length; i += 50) {
      const batch = db.batch();
      for (const id of real.slice(i, i + 50)) batch.set(db.collection('pools').doc(id), { status: 'OPEN', name: 'x' });
      await batch.commit();
    }
    const found = (await opened.reader.existingPoolIds(ids)) as string[];
    expect(found.sort()).toEqual([...real].sort());
    expect(await opened.reader.existingPoolIds([])).toEqual([]);
  });

  it('reading changes nothing: every document is as it was before the reads', async () => {
    await seed('ROLE_CHANGED', daysAgo(3), { targetType: 'pool', targetId: 'p1' });
    await db.collection('pools').doc('p1').set({ status: 'OPEN' });
    const snapshot = async () => {
      const out: Record<string, string> = {};
      for (const coll of ['admin_audit', 'pools']) {
        for (const d of (await db.collection(coll).get()).docs) out[d.ref.path] = `${d.updateTime.toMillis()}:${JSON.stringify(d.data())}`;
      }
      return out;
    };
    const before = await snapshot();
    const since = daysAgo(30).toDate().toISOString();
    await opened.reader.countWindow(since);
    await opened.reader.readWindow(since, 100);
    await opened.reader.actionEverWritten('ROLE_CHANGED');
    await opened.reader.existingPoolIds(['p1', 'p2']);
    expect(await snapshot()).toEqual(before);
  });
});

describe('the whole sweep, with the real reader and rows the production writer wrote', () => {
  it('a row from writeAdminAudit passes the sweep\'s own shape check, for every optional field', async () => {
    expect(await writeAdminAudit({ actorUid: 'u1', action: 'ROLE_CHANGED', status: 'success' })).toBe(true);
    expect(
      await writeAdminAudit({
        actorUid: 'u1',
        actorEmail: 'person@example.com',
        action: 'POOL_CLOSED',
        targetType: 'pool',
        targetId: 'p1',
        metadata: { reason: 'x', nested: { a: 1 }, token: 'secret' },
        status: 'error',
        error: 'boom',
      }),
    ).toBe(true);
    const rows = (await opened.reader.readWindow(daysAgo(1).toDate().toISOString(), 10)) as unknown[];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(lib.auditRowErrors(r)).toEqual([]);
  });

  it('a clean trail is CLEAN, end to end', async () => {
    for (const action of lib.RECURRING_ACTIONS) await seed(action, daysAgo(2));
    await seed('POOL_CLOSED', daysAgo(5), { targetType: 'pool', targetId: 'p1' });
    await db.collection('pools').doc('p1').set({ status: 'COMPLETED' });

    const session = lib.createAuditSession({ reader: opened.reader, now: NOW });
    await lib.runAuditChecks(session);
    const { verdict, row } = lib.summarizeAuditRun({ ledger: session.ledger, now: NOW, mode: 'offline' });
    expect(row).toContain('5 rows: 0 malformed, 0 silent');
    expect(verdict).toBe('CLEAN');
  });

  it('a malformed row, a silent job and a missing pool are each reported, with no personal data in the row', async () => {
    // AUTO_CLOSE_SWEEP logged 60 days ago and not since: it went silent.
    await seed('AUTO_CLOSE_SWEEP', daysAgo(60));
    for (const action of lib.RECURRING_ACTIONS.filter((a: string) => a !== 'AUTO_CLOSE_SWEEP')) await seed(action, daysAgo(2));
    const badId = await seed('ROLE_CHANGED', daysAgo(4), { status: 'maybe', actorEmail: 'person@example.com', actorUid: 'uid-PERSON' });
    await seed('POOL_CLOSED', daysAgo(5), { targetType: 'pool', targetId: 'pool-GONE' });

    const session = lib.createAuditSession({ reader: opened.reader, now: NOW });
    await lib.runAuditChecks(session);
    const { verdict, row } = lib.summarizeAuditRun({ ledger: session.ledger, now: NOW, mode: 'offline' });
    expect(verdict).toBe('FINDING');
    expect(row).toContain('5 rows: 1 malformed, 1 silent');
    expect(row).toContain(`status x1]; ids: ${badId}`);
    expect(row).toContain('AUTO_CLOSE_SWEEP');
    expect(row).toContain('1 row(s) name 1 pool(s) that no longer exist');
    for (const poison of ['person@example.com', 'uid-PERSON', 'pool-GONE']) expect(row).not.toContain(poison);
  });
});
