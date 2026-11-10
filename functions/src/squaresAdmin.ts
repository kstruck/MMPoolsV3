/**
 * Squares commissioner actions that decide money or fairness, done on the
 * server (PLAN-SQUARES-REOPEN B2 / B4 / K3).
 *
 *   recomputeSquaresWinners — bring the winner records in line with the scores.
 *   drawSquaresFinalPrize   — the "random draw" for an unclaimed final prize.
 *   unlockSquaresPool       — reopen a grid before kickoff; discards the numbers.
 *
 * Each used to be a raw client write (or nothing at all). A pool's `scores`,
 * `isLocked` and `randomWinner` are all commissioner-writable under
 * firestore.rules, so none of this is an authorization boundary against the
 * commissioner — it is what makes the outcome RECORDED, AUDITED and, for the
 * draw, not re-rollable.
 */
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { assertPoolOwnerOrSuperAdmin } from "./poolOps";
import { confirmedAdminClaim } from "./lib/confirmedRole";
import { assertNotBannedLive } from "./lib/systemGuards";
import { writeAuditEvent } from "./audit";
import {
    drawSquaresFinalPrizeSchema,
    recomputeSquaresWinnersSchema,
    unlockSquaresPoolSchema,
} from "./schemas/squaresAdmin";
import { applyWinnerPlan, finalScoresOf, PERIOD_WINNER_IDS, planWinnerWrites, type StoredWinner } from "./lib/squaresWinners";
import { squaresGameHasStarted } from "./lib/squaresGame";
import { computePeriodPayouts, ROLLOVER, usesCurrentWinnerRules, type PayoutPool, type RecordedWinners } from "./shared/squaresPayouts";

type PoolDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const isSquares = (pool: PoolDoc) => !pool.type || pool.type === 'SQUARES';

/** Refuse a pool whose winner records are history (see SQUARES_RULES_SINCE_MS). */
const assertCurrentRules = (pool: PoolDoc) => {
    if (!usesCurrentWinnerRules(pool)) {
        throw new HttpsError(
            'failed-precondition',
            'This pool was played under the previous payout rules. Its winner records are kept exactly as they were recorded.',
        );
    }
};

const gameIsFinal = (pool: PoolDoc) => pool.scores?.gameStatus === 'post' || !!pool.scores?.final;

const recordedOf = (stored: ReadonlyArray<StoredWinner>): RecordedWinners => {
    const out: Record<string, { squareId: number; owner: string | null; drawn?: boolean }> = {};
    for (const w of stored) {
        if (!PERIOD_WINNER_IDS.has(w.id)) continue;
        out[w.id] = {
            squareId: Number(w.data.squareId),
            owner: typeof w.data.owner === 'string' ? w.data.owner : null,
            drawn: !!w.data.drawnAt,
        };
    }
    return out;
};

/**
 * Recompute the winner records from the scores on the pool.
 *
 * WHY IT EXISTS. The scheduled sync only reaches a pool linked to an ESPN game.
 * A commissioner who scores by hand (a game not on the feed, or Manual Score
 * Override) writes the scores from the admin page — and until now that produced
 * no winner record at all, so "Mark Paid" failed with not-found and the winner
 * email never went out. The admin page calls this after a manual score change.
 *
 * It grants nothing new: the scores it reads are already the commissioner's to
 * write, and it derives the same records the sync would.
 */
export const recomputeSquaresWinners = validated(
    { schema: recomputeSquaresWinnersSchema, label: "recomputeSquaresWinners", appCheck: "monitor" },
    async ({ poolId }, request) => {
        const uid = request.auth!.uid;
        await assertNotBannedLive(uid);
        const adminClaim = await confirmedAdminClaim(request);
        const db = admin.firestore();
        const poolRef = db.collection('pools').doc(poolId);

        return db.runTransaction(async (t) => {
            const snap = await t.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as PoolDoc;
            assertPoolOwnerOrSuperAdmin(pool, uid, adminClaim);
            if (!isSquares(pool)) throw new HttpsError('failed-precondition', 'This is not a squares pool.');
            assertCurrentRules(pool);

            const winnersSnap = await t.get(poolRef.collection('winners'));
            const stored = winnersSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
            const plan = planWinnerWrites(pool as PayoutPool, finalScoresOf(pool.scores), stored, { gameFinal: gameIsFinal(pool) });
            await applyWinnerPlan(t, poolId, plan, { uid, role: 'ADMIN', label: 'Recompute winners' });
            return { success: true, changed: plan.filter((w) => w.kind !== 'audit').length };
        });
    },
);

/**
 * The random draw for an unclaimed final prize.
 *
 * It used to run in the commissioner's browser: `Math.random()` over all 100
 * squares (empty ones included), written to the pool by the client, with a
 * "reset" link beside the result. So the outcome could be re-rolled until it
 * suited, and nothing recorded that it had been.
 *
 * Here: one draw, by the server's CSPRNG, among SOLD squares only (each sold
 * square is one ticket), refused unless the scores say an unclaimed final prize
 * is actually waiting, refused a second time, and audited with what it chose
 * from.
 */
export const drawSquaresFinalPrize = validated(
    { schema: drawSquaresFinalPrizeSchema, label: "drawSquaresFinalPrize", appCheck: "monitor" },
    async ({ poolId }, request) => {
        const uid = request.auth!.uid;
        await assertNotBannedLive(uid);
        const adminClaim = await confirmedAdminClaim(request);
        const db = admin.firestore();
        const poolRef = db.collection('pools').doc(poolId);

        return db.runTransaction(async (t) => {
            const snap = await t.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as PoolDoc;
            assertPoolOwnerOrSuperAdmin(pool, uid, adminClaim);
            if (!isSquares(pool)) throw new HttpsError('failed-precondition', 'This is not a squares pool.');
            assertCurrentRules(pool);

            const winnersRef = poolRef.collection('winners');
            const winnersSnap = await t.get(winnersRef);
            const stored: StoredWinner[] = winnersSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

            if (stored.find((w) => w.id === 'final_rollover')?.data.drawnAt) {
                throw new HttpsError('already-exists', 'The draw has already been made. It cannot be made again.');
            }

            const scores = finalScoresOf(pool.scores);
            const claimsBefore = computePeriodPayouts(pool as PayoutPool, scores, recordedOf(stored)).flatMap((r) => r.claims);
            const pending = claimsBefore.find((c) => c.docId === 'final_rollover');
            if (!pending || pending.owner !== ROLLOVER) {
                throw new HttpsError('failed-precondition', 'There is no unclaimed final prize waiting for a draw.');
            }

            const sold = (Array.isArray(pool.squares) ? pool.squares : [])
                .filter((s: PoolDoc | null) => !!s && typeof s.owner === 'string' && s.owner.length > 0);
            if (sold.length === 0) {
                throw new HttpsError('failed-precondition', 'No squares were sold, so there is nobody to draw.');
            }
            const pick = sold[crypto.randomInt(sold.length)];
            const squareId = Number(pick.id);

            // Re-run the math with the draw on record: it yields the full claim
            // (amount included) exactly as every later pass will compute it.
            const drawnAt = Timestamp.now();
            const withDraw: StoredWinner[] = [
                ...stored.filter((w) => w.id !== 'final_rollover'),
                { id: 'final_rollover', data: { squareId, owner: pick.owner, drawnAt } },
            ];
            const claim = computePeriodPayouts(pool as PayoutPool, scores, recordedOf(withDraw))
                .flatMap((r) => r.claims).find((c) => c.docId === 'final_rollover');
            if (!claim || claim.owner !== pick.owner) {
                throw new HttpsError('internal', 'The draw could not be recorded.');
            }

            const record = {
                period: claim.period,
                squareId: claim.squareId,
                owner: claim.owner,
                amount: claim.amount,
                homeDigit: claim.homeDigit,
                awayDigit: claim.awayDigit,
                isReverse: claim.isReverse,
                isRollover: claim.isRollover,
                description: claim.description,
                drawnAt,
                drawnByUid: uid,
                drawnFrom: sold.length,
            };
            t.set(winnersRef.doc('final_rollover'), record, { merge: true });

            // Everything else is brought up to date in the same transaction.
            const known = [...stored.filter((w) => w.id !== 'final_rollover'), { id: 'final_rollover', data: record }];
            const plan = planWinnerWrites(pool as PayoutPool, scores, known, { gameFinal: gameIsFinal(pool) });
            await applyWinnerPlan(t, poolId, plan, { uid, role: 'ADMIN', label: 'Recompute winners' });

            // Mirrored on the pool for the admin page; the winner record is the money.
            t.update(poolRef, {
                randomWinner: { squareId: claim.squareId, owner: claim.owner, amount: claim.amount, timestamp: drawnAt.toMillis() },
                updatedAt: Timestamp.now(),
            });

            await writeAuditEvent({
                poolId,
                type: 'WINNER_COMPUTED',
                severity: 'INFO',
                message: `Final prize random draw: square #${claim.squareId} (${claim.owner}) wins $${claim.amount.toFixed(2)} — drawn from ${sold.length} sold square(s)`,
                actor: { uid, role: 'ADMIN', label: request.auth!.token.name || 'Owner' },
                payload: { docId: 'final_rollover', squareId: claim.squareId, winner: claim.owner, amount: claim.amount, drawnFrom: sold.length, rng: 'crypto.randomInt' },
            }, t);

            return { success: true, squareId: claim.squareId, owner: claim.owner, amount: claim.amount };
        });
    },
);

/**
 * Reopen a grid for sales — before kickoff only — and DISCARD its numbers.
 *
 * Unlocking used to be a client write of `isLocked: false` that left the drawn
 * numbers on the grid. Anyone buying a square after that chooses it knowing
 * which digits it carries, which is the one thing a squares pool exists to
 * prevent. So reopening sales throws the numbers away; new ones are drawn when
 * the grid locks again. Once the game has started the grid cannot be reopened
 * at all.
 */
export const unlockSquaresPool = validated(
    { schema: unlockSquaresPoolSchema, label: "unlockSquaresPool", appCheck: "monitor" },
    async ({ poolId }, request) => {
        const uid = request.auth!.uid;
        await assertNotBannedLive(uid);
        const adminClaim = await confirmedAdminClaim(request);
        const db = admin.firestore();
        const poolRef = db.collection('pools').doc(poolId);

        return db.runTransaction(async (t) => {
            const snap = await t.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as PoolDoc;
            assertPoolOwnerOrSuperAdmin(pool, uid, adminClaim);
            if (!isSquares(pool)) throw new HttpsError('failed-precondition', 'This is not a squares pool.');
            if (squaresGameHasStarted(pool, Date.now())) {
                throw new HttpsError('failed-precondition', 'The game has started. The grid can no longer be reopened.');
            }

            const hadNumbers = !!pool.axisNumbers;
            t.update(poolRef, {
                isLocked: false,
                lockGrid: false,
                axisNumbers: FieldValue.delete(),
                quarterlyNumbers: FieldValue.delete(),
                updatedAt: Timestamp.now(),
            });
            await writeAuditEvent({
                poolId,
                type: 'POOL_UNLOCKED',
                severity: hadNumbers ? 'WARNING' : 'INFO',
                message: hadNumbers
                    ? 'Grid reopened by owner — the drawn numbers were discarded and will be re-drawn at the next lock'
                    : 'Grid reopened by owner',
                actor: { uid, role: 'ADMIN', label: request.auth!.token.name || 'Owner' },
                payload: { numbersDiscarded: hadNumbers },
            }, t);
            return { success: true, numbersDiscarded: hadNumbers };
        });
    },
);
