import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { validated } from './lib/validated';
import { setPoolCoCommissionerSchema } from './schemas/coCommissioners';
import { assertNotBannedLive } from './lib/systemGuards';
import { isCanonicalMemberRecord } from './shared/memberRecord';
import { writeAuditEvent } from './audit';
import { isCoCommissionerPoolType, isPoolOwnerOrManager } from './poolOps';

/** K5: enough for a big pool, small enough that "who can score my pool" is a short list. */
export const MAX_CO_COMMISSIONERS = 3;

/**
 * setPoolCoCommissioner — the ONLY writer of `pools/{id}.coManagers`
 * (PLAN-CO-COMMISSIONERS D2, deploy step 3). The field is server-owned
 * (rules lock, #444); this is where the owner names or un-names a
 * co-commissioner, one uid at a time, inside a transaction.
 *
 * Gates, in order:
 *   1. STRICT owner (`isPoolOwnerOrManager` — owner or legacy managerUid, never
 *      a co-commissioner: C10, delegation does not delegate itself) or SUPER_ADMIN.
 *   2. `assertNotBannedLive` — same placement as recordPoolPayouts: after the
 *      ownership check so an unauthorized call costs no users/ read.
 *   3. NFL-only, ENFORCED (C13): any other pool type is refused, so a
 *      `coManagers` array can only ever exist on a pool where the readers honour it.
 *   4. `add`: target must hold a CANONICAL Member Record (the evidence
 *      getPoolPicks accepts — K6); not the owner themself; cap (K5); and the
 *      caller's `revision` must equal the pool's `coManagersRevision` (absent = 0)
 *      or the call fails `failed-precondition` — a stale tab cannot re-add a uid
 *      that a concurrent remove just took out (codex r2). `remove` needs no
 *      revision and always wins.
 *   5. Every successful call increments `coManagersRevision` and writes a
 *      typed pool audit event CO_COMMISSIONER_CHANGED {op, uid, before, after, revision}.
 *
 * A malformed legacy array (non-strings, duplicates) is not honoured — the
 * transaction rebuilds it from the string entries it can trust.
 */
export const setPoolCoCommissioner = validated(
    { schema: setPoolCoCommissionerSchema, label: 'setPoolCoCommissioner', appCheck: 'monitor' },
    async (input, request) => {
        const db = admin.firestore();
        const actorUid = request.auth!.uid;
        const claimRole = request.auth!.token.role as string | undefined;
        const { poolId, uid: targetUid, op } = input;
        const poolRef = db.collection('pools').doc(poolId);

        // Read outside the transaction ONLY for the ownership gate, so an
        // unauthorized caller costs one read and no transaction; the
        // transaction re-reads and re-checks everything it writes against.
        const preSnap = await poolRef.get();
        if (!preSnap.exists) throw new HttpsError('not-found', 'Pool not found.');
        const pre = preSnap.data() as any;
        if (claimRole !== 'SUPER_ADMIN' && !isPoolOwnerOrManager(pre, actorUid)) {
            throw new HttpsError('permission-denied', 'Only the pool owner can name co-commissioners.');
        }
        await assertNotBannedLive(actorUid);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as any;
            if (!isCoCommissionerPoolType(pool.type)) {
                throw new HttpsError('failed-precondition', 'Co-commissioners are available on NFL pools only.');
            }
            const before: string[] = Array.isArray(pool.coManagers)
                ? Array.from(new Set(pool.coManagers.filter((v: unknown): v is string => typeof v === 'string')))
                : [];
            const currentRevision = Number.isInteger(pool.coManagersRevision) ? Number(pool.coManagersRevision) : 0;

            let after: string[];
            if (op === 'add') {
                if (input.revision !== currentRevision) {
                    throw new HttpsError('failed-precondition', 'The roster changed — reload and try again.');
                }
                if (targetUid === (pool.ownerId || pool.createdByUid) || targetUid === pool.managerUid) {
                    throw new HttpsError('failed-precondition', 'The owner is already a commissioner.');
                }
                if (before.includes(targetUid)) {
                    throw new HttpsError('already-exists', 'That member is already a co-commissioner.');
                }
                if (before.length >= MAX_CO_COMMISSIONERS) {
                    throw new HttpsError('failed-precondition', `A pool can have at most ${MAX_CO_COMMISSIONERS} co-commissioners.`);
                }
                const memberSnap = await tx.get(poolRef.collection('members').doc(targetUid));
                if (!isCanonicalMemberRecord(memberSnap.data())) {
                    throw new HttpsError('failed-precondition', 'A co-commissioner must be a member of the pool.');
                }
                after = [...before, targetUid];
            } else {
                if (!before.includes(targetUid)) {
                    throw new HttpsError('not-found', 'That member is not a co-commissioner.');
                }
                after = before.filter((u) => u !== targetUid);
            }

            const revision = currentRevision + 1;
            tx.update(poolRef, {
                coManagers: after,
                coManagersRevision: revision,
                updatedAt: FieldValue.serverTimestamp(),
            });
            return { before, after, revision };
        });

        await writeAuditEvent({
            poolId,
            type: 'CO_COMMISSIONER_CHANGED',
            message: op === 'add'
                ? `Co-commissioner added: ${targetUid}`
                : `Co-commissioner removed: ${targetUid}`,
            severity: 'INFO',
            actor: { uid: actorUid, role: 'ADMIN', label: claimRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Owner' },
            payload: { op, uid: targetUid, before: result.before, after: result.after, revision: result.revision },
        });

        return { success: true, coManagers: result.after, coManagersRevision: result.revision };
    },
);
