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
 * Ordering (codex r1 P2 / r2 P2). Two quick edits produce two events that may
 * run out of order or at once. The handler re-reads the profile and stands
 * down unless it STILL carries this event's name, and every write chunk is a
 * transaction on the profile that commits only while that stays true — so an
 * older handler cannot commit after a newer edit.
 *
 * Retries (codex r1 P3; qodo #690 finding 3). `retry: true`, and EVERY failure
 * is rethrown so the platform re-delivers the event. The writes are idempotent
 * (a copy already equal to the profile is skipped), so a retry after a
 * transient query or batch failure is safe. That includes the one failure
 * that is not transient on a given day — the collection-group index missing
 * (FAILED_PRECONDITION) — because swallowing it ACKNOWLEDGES the event and
 * nothing can replay it once the index exists; the copies would stay stale
 * until the next edit. Retrying costs a handful of backed-off invocations
 * during the index rollout window and nothing after it. The index lives in
 * firestore.indexes.json and ships with `npx firebase deploy`.
 */
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isCurrentProfileName, propagateUserName, stampSearchName, userNameChanged } from './lib/displayName';

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
    const result = await propagateUserName(db, uid, name);
    const searchStamped = await stampSearchName(db, uid, name);
    logger.info(`[userNameSync] ${uid}: name -> ${JSON.stringify(name)}; members=${result.members} entries=${result.entries} superseded=${result.superseded} searchName=${searchStamped ? 'updated' : 'unchanged'}`);
  } catch (error) {
    logger.error(`[userNameSync] ${uid}: propagation failed; rethrowing so the event is retried`, error);
    throw error;
  }
});
