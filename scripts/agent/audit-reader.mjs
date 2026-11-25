// The production reader for the audit sweep: the ONLY code in scripts/agent
// that touches Firestore.
//
// 🛑 THIS FILE NEVER WRITES, AND THAT IS A PROPERTY OF THE FILE, NOT OF THE KEY.
//
// The credential it uses is whatever the operator already has for the census
// script (`.claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs`).
// That is usually an admin service-account key, which CAN write. Nothing in
// Google stops a write made with it. What stops one is that this file calls
// four read methods and nothing else: `.count().get()`, `.get()` on a query,
// `.get()` on a limit-1 query, and `getAll()`.
//
// `tests/agent-audit-sweep.test.ts` reads this source and fails if a write
// method name appears in it (`set`, `update`, `delete`, `add`, `create`,
// `batch`, `runTransaction`, `bulkWriter`, `recursiveDelete`). If you need one
// of those here, this is the wrong file.
//
// The model never reaches this code path with an argument of its own: the four
// tools that call it take no input (audit-tools.mjs), so there is no query,
// path or id a model could supply.
//
// A viewer-only service account (`roles/datastore.viewer`) would make Google
// enforce the same thing. It is the safer setup and it is not required.
//
// firebase-admin is resolved from functions/node_modules, like the census
// script does, so run `npm --prefix functions ci` first.

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ID_DEFAULT = 'gridiron-gamble-uzuqo';
const COLLECTION = 'admin_audit';

/** How to fix a missing credential. Thrown text ends up in the BLOCKED row. */
export const NO_CREDENTIAL =
  'no Firestore credential: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file kept OUTSIDE the repo ' +
  '(or FIRESTORE_EMULATOR_HOST for the emulator). The audit sweep reads production and runs on the Windows box only';

/**
 * Open a read-only handle on Firestore.
 *
 * Credentials, in the census script's order:
 *   1. FIRESTORE_EMULATOR_HOST            -> the emulator, no key
 *   2. GOOGLE_APPLICATION_CREDENTIALS     -> that key file
 *   3. <repoRoot>/scripts/service-account.json (legacy, gitignored)
 *
 * @returns {{ describe: string, reader: object, close: () => Promise<void> }}
 */
export async function openAuditReader({ repoRoot, env }) {
  let admin;
  try {
    admin = createRequire(path.join(repoRoot, 'functions', 'package.json'))('firebase-admin');
  } catch {
    throw new Error('firebase-admin is not installed under functions/. Run: npm --prefix functions ci');
  }
  const projectId = env.GCLOUD_PROJECT || PROJECT_ID_DEFAULT;
  let options;
  let describe;
  if (env.FIRESTORE_EMULATOR_HOST) {
    options = { projectId };
    describe = `the EMULATOR at ${env.FIRESTORE_EMULATOR_HOST} (project ${projectId})`;
  } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (!existsSync(env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error('GOOGLE_APPLICATION_CREDENTIALS names a file that does not exist');
    options = { credential: admin.credential.applicationDefault(), projectId };
    describe = `PRODUCTION (project ${projectId}) with the key in GOOGLE_APPLICATION_CREDENTIALS`;
  } else {
    const legacy = path.join(repoRoot, 'scripts', 'service-account.json');
    if (!existsSync(legacy)) throw new Error(NO_CREDENTIAL);
    options = { credential: admin.credential.cert(JSON.parse(readFileSync(legacy, 'utf8'))), projectId };
    describe = `PRODUCTION (project ${projectId}) with scripts/service-account.json`;
  }

  // A named app, so this never collides with a default app another script made.
  const app = admin.initializeApp(options, `mmp-audit-reader-${Date.now()}`);
  const db = app.firestore();
  const { Timestamp } = admin.firestore;
  const since = (iso) => Timestamp.fromDate(new Date(iso));
  const windowQuery = (iso) => db.collection(COLLECTION).where('at', '>=', since(iso));

  const reader = {
    /** Rows whose `at` is a Timestamp at or after `sinceIso`. One aggregation read per 1000 rows. */
    async countWindow(sinceIso) {
      const snap = await windowQuery(sinceIso).count().get();
      return snap.data().count;
    },

    /**
     * Up to `limit` rows of the window, oldest first, as plain objects.
     *
     * `at` becomes an ISO string, or null when the stored value is not a
     * Timestamp. (A row with no Timestamp in `at` cannot match the window
     * query at all, so in practice this never returns null: such rows are
     * invisible to a windowed read. The sweep says so in its skill.)
     */
    async readWindow(sinceIso, limit) {
      const snap = await windowQuery(sinceIso).orderBy('at').limit(limit).get();
      return snap.docs.map((doc) => {
        const data = doc.data();
        return { ...data, id: doc.id, at: data.at instanceof Timestamp ? data.at.toDate().toISOString() : null };
      });
    },

    /** True when ANY row, of any date, carries this action. A single-field equality: no composite index. */
    async actionEverWritten(action) {
      const snap = await db.collection(COLLECTION).where('action', '==', action).limit(1).get();
      return !snap.empty;
    },

    /** The subset of `ids` that exist under /pools. Reads no field of them. */
    async existingPoolIds(ids) {
      const found = [];
      for (let i = 0; i < ids.length; i += 100) {
        const refs = ids.slice(i, i + 100).map((id) => db.collection('pools').doc(id));
        if (!refs.length) continue;
        const snaps = await db.getAll(...refs, { fieldMask: ['status'] });
        for (const snap of snaps) if (snap.exists) found.push(snap.id);
      }
      return found;
    },
  };

  // Releases the Firestore client's sockets so the process can exit. It writes nothing.
  const close = async () => {
    await db.terminate().catch(() => {});
  };
  return { describe, reader, close };
}
