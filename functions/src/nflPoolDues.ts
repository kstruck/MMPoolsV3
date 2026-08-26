/**
 * `getPoolDues` — serve the per-entry payment map to the COMMISSIONER, and to
 * nobody else (PLAN-MULTI-ENTRY-DUES D1 as amended 2026-08-26, P2-T5).
 *
 * 🛑 WHY A CALLABLE EXISTS AT ALL. `paidEntries` used to sit on the Member
 * Record, where the ledger could read it directly — and that was the bug: a
 * Member Record is readable by every participant, and the map's keys name
 * entries that have COMMITTED A PICK. Kevin ruled it into
 * `pools/{poolId}/private/dues__{uid}`, which `firestore.rules` seals to every
 * principal including SUPER_ADMIN. Sealed means sealed: the only way back out is
 * a callable holding Admin SDK credentials, which is the same posture
 * `getPoolPicks` takes for commissioner-only pick data.
 *
 * ⚠️ THE `private/` SUBCOLLECTION ALSO HOLDS THE POOL PASSWORD RECORD
 * (`private/access`, a PBKDF2 hash). This callable reads that collection, so it
 * must never hand back a document it did not mean to. Two independent
 * precautions, because one typo here leaks credential material:
 *   1. only ids with the `dues__` prefix are considered, and
 *   2. only the `paidEntries` field is ever copied out — the document is never
 *      spread, so a field added to it later cannot ride along by accident.
 */
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { validated } from './lib/validated';
import { assertCallerRole } from './lib/assertRole';
import { assertNotBannedLive } from './lib/systemGuards';
import { getPoolDuesSchema } from './schemas/poolCore';
import { isPoolCommissioner } from './poolOps';
import type { PaidEntryMap } from './lib/poolDues';
import { entryHasPick } from './lib/multiEntry';
import { liableEntryIds } from './shared/memberRecord';

/** The NFL pool types that have per-entry dues at all. */
const NFL_ENTRY_POOL_TYPES = new Set(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);

/** The `private/` document-id prefix that marks a member's dues record. */
const DUES_PREFIX = 'dues__';

/**
 * The EXCLUSIVE upper bound of the `dues__*` id range — the prefix with its last
 * character incremented, so `dues__` becomes `dues_` + backtick.
 *
 * 🛑 NOT `dues__` + U+F8FF, WHICH IS THE CONVENTIONAL FIREBASE SENTINEL AND IS
 * WRONG HERE (codex). U+F8FF is the top of a private-use block, not the top of
 * Unicode: a document id beginning above it — `dues__` followed by an emoji,
 * say — sorts AFTER that bound and is silently skipped. The consequence is a
 * money bug in the quiet direction: that member's payments never appear in the
 * ledger, so a commissioner re-collects dues that were already paid.
 *
 * The successor bound has no codepoint ceiling. Derived FROM `DUES_PREFIX`
 * rather than written out, so the two cannot drift apart.
 */
const DUES_PREFIX_END = DUES_PREFIX.slice(0, -1)
  + String.fromCharCode(DUES_PREFIX.charCodeAt(DUES_PREFIX.length - 1) + 1);

export interface PoolDuesResult {
  /** uid → that member's per-entry payment rows. Members with no record are absent. */
  dues: Record<string, PaidEntryMap>;
  /**
   * uid → the entry ids that member is LIABLE for — the rows the ledger charges.
   *
   * 🛑 THE CLIENT CANNOT DERIVE THIS, AND THAT IS THE POINT. Liability is "this
   * entry has committed a pick", and the Member Record deliberately carries the
   * COUNT (`playableEntryCount`) and never WHICH — a participant-readable
   * document must not say which entry has a pick for an unrevealed week.
   *
   * Without it the ledger has to guess, and both guesses are wrong: charging
   * every entry in the roster map overstates "Owed in" for a member holding an
   * entry that has not picked yet, and charging the first N by index
   * mis-attributes when entry 2 picked and entry 1 did not. It also renders a
   * checkbox whose write `setPaidStatus` refuses with ENTRY_NOT_FOUND.
   *
   * Same commissioner-only boundary as `dues`, so it costs no new exposure.
   */
  liable: Record<string, string[]>;
  /**
   * Entry ids whose ENTRY DOCUMENT carries `paidStatus: 'PAID'`.
   *
   * The delete callable refuses on ANY of three payment sources, and this is the
   * third — it can diverge from the member record on a legacy row. The
   * commissioner ledger cannot read it for other members (raw entries are
   * own-entry-only pre-reveal), so without this the UI cannot honestly mirror
   * that refusal and offers a button the server rejects.
   */
  paidMirrors: string[];
}

export async function getPoolDuesInternal(
  db: admin.firestore.Firestore,
  ctx: { actorUid: string; verifiedSuperAdmin?: boolean },
  payload: { poolId: string },
): Promise<PoolDuesResult> {
  const poolRef = db.collection('pools').doc(payload.poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
  const pool = poolSnap.data() as Record<string, unknown>;
  // Scope, matching `deleteNFLEntry`: per-entry dues are an NFL concept, and a
  // callable that answers for pool types it was never designed around is a
  // surface nobody is reasoning about.
  if (!NFL_ENTRY_POOL_TYPES.has(String(pool.type))) {
    throw new HttpsError('failed-precondition',
      'NOT_AN_NFL_POOL: per-entry dues only exist in NFL pools.');
  }
  // 🛑 `verifiedSuperAdmin`, NOT the raw token claim (codex, HIGH).
  //
  // A demoted-but-not-yet-refreshed token keeps its old `role` claim until it
  // expires, and this callable returns EVERY member's per-entry map — which
  // names the entries that have committed a pick. Trusting the claim would
  // leave a stale token with full access to the one store the D1 amendment
  // built to seal. The wrapper proves the claim against `users/{uid}.role`
  // before setting this, exactly as `getPoolPicks` does (`nflPickReveal.ts:185`).
  if (!isPoolCommissioner(pool, ctx.actorUid) && ctx.verifiedSuperAdmin !== true) {
    throw new HttpsError('permission-denied', 'Only the commissioner can read per-entry dues.');
  }

  // Only the `dues__*` id RANGE, not the whole subcollection (codex, LOW).
  // Cheaper, and it means `private/access` is never even fetched — the prefix
  // check below is then a second lock rather than the only one.
  const snap = await poolRef.collection('private')
    .orderBy(FieldPath.documentId())
    .startAt(DUES_PREFIX)
    .endBefore(DUES_PREFIX_END)
    .get();
  // The liable set, computed from the ENTRY documents — the same rule
  // `liableEntryIds` applies server-side, and the only place it can be applied.
  const [entriesSnap, membersSnap] = await Promise.all([
    poolRef.collection('entries').get(),
    poolRef.collection('members').get(),
  ]);
  const pickedByOwner = new Map<string, string[]>();
  const paidMirrors: string[] = [];
  for (const e of entriesSnap.docs) {
    const data = e.data() as Record<string, unknown>;
    const owner = typeof data.ownerUid === 'string' ? data.ownerUid : e.id;   // legacy: entry #1's id IS the uid
    if (data.paidStatus === 'PAID') paidMirrors.push(e.id);
    if (!entryHasPick(data)) continue;
    pickedByOwner.set(owner, [...(pickedByOwner.get(owner) ?? []), e.id]);
  }
  const liable: Record<string, string[]> = {};
  for (const m of membersSnap.docs) {
    const rec = m.data() as unknown as Parameters<typeof liableEntryIds>[0];
    liable[m.id] = liableEntryIds(rec, m.id, pickedByOwner.get(m.id) ?? []);
  }

  const dues: Record<string, PaidEntryMap> = {};
  for (const doc of snap.docs) {
    // Precaution 1: the id prefix. `private/access` and anything else added to
    // this subcollection later is skipped without ever being inspected.
    if (!doc.id.startsWith(DUES_PREFIX)) continue;
    const uid = doc.id.slice(DUES_PREFIX.length);
    if (!uid) continue;
    // Precaution 2: ONE field, named. Never `...doc.data()` — a field added to
    // the dues document later must not become part of this response by default.
    const map = doc.get('paidEntries');
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      dues[uid] = map as PaidEntryMap;
    }
  }
  return { dues, liable, paidMirrors };
}

export const getPoolDues = validated(
  { schema: getPoolDuesSchema, label: 'getPoolDues', appCheck: 'monitor' },
  async (input, request) => {
    const uid = request.auth!.uid;
    // A banned commissioner is still a commissioner to `isPoolCommissioner`, so
    // without this a banned owner keeps reading the map (codex, MEDIUM). Same
    // guard `deleteNFLEntry` takes before privileged work.
    await assertNotBannedLive(uid);
    // The claim is only a hint; `assertCallerRole` proves it against
    // `users/{uid}.role`. A failure is NOT fatal — a demoted admin who still
    // owns this pool keeps the commissioner path below. Demotion costs the
    // elevated read, not the pool they own.
    let verifiedSuperAdmin = false;
    if ((request.auth!.token as { role?: string })?.role === 'SUPER_ADMIN') {
      try {
        await assertCallerRole(request, 'SUPER_ADMIN');
        verifiedSuperAdmin = true;
      } catch { /* fall through to the commissioner test */ }
    }
    return getPoolDuesInternal(admin.firestore(), { actorUid: uid, verifiedSuperAdmin }, input);
  },
);
