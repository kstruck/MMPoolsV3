/**
 * `onUserNameChanged` — when a profile's `name` changes, every pool copy of it
 * follows (`pools/{*}/members/{uid}.userName`, `pools/{*}/entries/*.userName`).
 *
 * Fires on every `users/{uid}` write, which includes the `lastLogin` stamp on
 * each sign-in — so the gate (`userNameChanged`) runs first and costs no reads.
 * The work itself lives in lib/displayName.ts, where the emulator suite can
 * drive it without a trigger harness.
 *
 * No retry: the two collection-group reads and the batched updates are
 * idempotent (a copy already equal to the profile is skipped), so a failed
 * invocation is safe to lose — the NEXT profile write, or the next pick, will
 * re-stamp. A throw here would be retried against the same transient fault.
 */
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { propagateUserName, stampSearchName, userNameChanged } from './lib/displayName';

export const onUserNameChanged = onDocumentWritten('users/{uid}', async (event) => {
  const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : undefined;
  const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : undefined;
  const name = userNameChanged(before, after);
  if (name === null) return;

  const uid = event.params.uid;
  try {
    const db = admin.firestore();
    const [result, searchStamped] = await Promise.all([
      propagateUserName(db, uid, name),
      stampSearchName(db, uid, name),
    ]);
    logger.info(`[userNameSync] ${uid}: name -> ${JSON.stringify(name)}; members=${result.members} entries=${result.entries} searchName=${searchStamped ? 'updated' : 'unchanged'}`);
  } catch (error) {
    logger.error(`[userNameSync] ${uid}: propagation failed`, error);
  }
});
