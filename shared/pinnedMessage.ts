/**
 * The pinned-post id is a FIRESTORE DOCUMENT ID, and it is used to build a path.
 *
 * `updatePoolSettings` takes an open `Record<string, unknown>` — the editability
 * matrix decides which KEYS may be written, never what their values are — so
 * without this check a commissioner could store an object, or an id containing
 * `/`, and the pool home page would then call
 * `doc(db, 'pools', poolId, 'messages', <that>)`, which THROWS synchronously.
 * That throw is inside the subscription effect every member runs, so one bad
 * value from one authorized commissioner would break the pool home page for the
 * whole pool. (codex r1 [P2].)
 *
 * The empty string is valid and means UNPIN — it never reaches `doc()`.
 *
 * Deliberately NOT an existence check. A pinned post can be deleted at any time
 * afterwards, so a dangling id has to render as "nothing pinned" regardless;
 * paying for a read here would buy a guarantee that expires immediately.
 */
export const PINNED_MESSAGE_ID_MAX = 200;

/** Firestore auto-ids are alphanumeric; `_` and `-` cover hand-made ones. */
const SAFE_MESSAGE_ID = /^[A-Za-z0-9_-]*$/;

export function isPinnableMessageId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= PINNED_MESSAGE_ID_MAX
    && SAFE_MESSAGE_ID.test(value);
}
