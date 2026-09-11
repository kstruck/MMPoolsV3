/**
 * `onUserNameChanged` — when a profile's `name` changes, every pool copy of it
 * follows (`pools/{*}/members/{uid}.userName`, `pools/{*}/entries/*.userName`),
 * and the super-admin search index (`users/{uid}.searchName`) with it.
 *
 * Fires on every `users/{uid}` write, which includes the `lastLogin` stamp on
 * each sign-in — so the gate (`userNameChanged`) runs first and costs no reads.
 * The work itself lives in lib/displayName.ts, where the emulator suite can
 * drive it without a trigger harness.
 *
 * Ordering (codex r1 P2). Two quick edits produce two events that may run out
 * of order or at once. Before writing anything the handler re-reads the
 * profile and stands down unless it STILL carries this event's name — the
 * newer event is the one that applies. `stampSearchName` repeats that check
 * inside its transaction.
 *
 * Retries (codex r1 P3). `retry: true`, and a failure is RETHROWN so the
 * platform re-delivers the event: the writes are idempotent (a copy already
 * equal to the profile is skipped), so a retry after a transient query or
 * batch failure is safe and is the only thing that stops a transient fault
 * from leaving pool copies stale until the next edit. The one failure that is
 * NOT transient — the collection-group index missing (FAILED_PRECONDITION) —
 * is logged and swallowed, because retrying it for the retry window would
 * burn invocations for nothing; the index lives in firestore.indexes.json and
 * ships with `npx firebase deploy`.
 */
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isCurrentProfileName, propagateUserName, stampSearchName, userNameChanged } from './lib/displayName';

/** gRPC FAILED_PRECONDITION — what Firestore returns for a query with no index. */
const FAILED_PRECONDITION = 9;

export function isMissingIndexError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.code === FAILED_PRECONDITION) return true;
  return typeof e.message === 'string' && /requires an index/i.test(e.message);
}

export const onUserNameChanged = onDocumentWritten({ document: 'users/{uid}', retry: true }, async (event) => {
  const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : undefined;
  const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : undefined;
  const name = userNameChanged(before, after);
  if (name === null) return;

  const uid = event.params.uid;
  const db = admin.firestore();

  if (!(await isCurrentProfileName(db, uid, name))) {
    logger.info(`[userNameSync] ${uid}: event name ${JSON.stringify(name)} superseded; skipping`);
    return;
  }

  try {
    const [result, searchStamped] = await Promise.all([
      propagateUserName(db, uid, name),
      stampSearchName(db, uid, name),
    ]);
    logger.info(`[userNameSync] ${uid}: name -> ${JSON.stringify(name)}; members=${result.members} entries=${result.entries} searchName=${searchStamped ? 'updated' : 'unchanged'}`);
  } catch (error) {
    if (isMissingIndexError(error)) {
      logger.error(`[userNameSync] ${uid}: collection-group index missing — deploy firestore.indexes.json; not retrying`, error);
      return;
    }
    logger.error(`[userNameSync] ${uid}: propagation failed; rethrowing for retry`, error);
    throw error;
  }
});
