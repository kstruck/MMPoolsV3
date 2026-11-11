/**
 * Squares commissioner actions that decide money or fairness, done on the
 * server (PLAN-SQUARES-REOPEN B2 / B4 / K3).
 *
 *   recomputeSquaresWinners — bring the winner records in line with the scores.
 *   drawSquaresFinalPrize   — the "random draw" for an unclaimed final prize.
 *   unlockSquaresPool       — reopen a grid before kickoff; discards the numbers.
 *   linkSquaresPoolGame     — link the pool to a game the SERVER looked up.
 *
 * Each used to be a raw client write (or nothing at all). Since
 * PLAN-SQUARES-SERVER-FIELDS, firestore.rules refuses a squares commissioner a
 * direct write of `isLocked`, `randomWinner`, `quarterlyNumbers`, the game link
 * and — once locked — the prize terms and feed scores
 * (`squaresServerFieldsUnchanged()`), so for those these callables ARE the
 * boundary. They also make the outcome RECORDED, AUDITED and, for the draw,
 * not re-rollable.
 */
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { assertPoolOwnerOrSuperAdmin, isPoolCommissioner } from "./poolOps";
import { confirmedAdminClaim } from "./lib/confirmedRole";
import { assertNotBannedLive } from "./lib/systemGuards";
import { writeAuditEvent } from "./audit";
import {
    drawSquaresFinalPrizeSchema,
    linkSquaresPoolGameSchema,
    recomputeSquaresWinnersSchema,
    unlockSquaresPoolSchema,
} from "./schemas/squaresAdmin";
import { firestoreFixtureReader, lookupSquaresGame, squaresFeedGameHasStarted, type SquaresFeedGame } from "./lib/squaresFeedGame";
import { squaresGameLink } from "./shared/squaresDefaults";
import { applyWinnerPlan, finalScoresOf, isEventWinnerId, PERIOD_WINNER_IDS, planWinnerWrites, recordedEntry, type StoredWinner } from "./lib/squaresWinners";
import { writeAdminAudit } from "./lib/adminAudit";
import { squaresGameHasStarted, squaresScoresShowPlay } from "./lib/squaresGame";
import { computePeriodPayouts, PERIODS, ROLLOVER, scoreEventStrategy, usesCurrentWinnerRules, type PayoutPool, type Period, type RecordedWinners } from "./shared/squaresPayouts";
import { WINNERS_HELD_FIELD, assertSquaresWinnersNotPaused } from "./lib/squaresPause";

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
        if (PERIOD_WINNER_IDS.has(w.id)) out[w.id] = recordedEntry(w);
    }
    return out;
};

/** Are the stored quarter scores exactly the ones the page showed? Quarter by quarter. */
function sameFinalScores(
    stored: Partial<Record<Period, { home: number; away: number }>>,
    expected: Record<Period, { home: number; away: number } | null>,
): boolean {
    return PERIODS.every((p) => {
        const s = stored[p];
        const e = expected[p];
        if (!s || !e) return !s && !e;
        return s.home === e.home && s.away === e.away;
    });
}

/**
 * A SUPER_ADMIN acting on a pool they do not run also leaves a row in
 * `admin_audit`, the SUPER_ADMIN actor log. A commissioner acting on their own
 * pool does not: that belongs in the pool's own audit trail, which every
 * callable here already writes, the same as `lockPool` and `toggleWinnerPaid`.
 * Best-effort and after the commit — an audit write must not undo the action.
 */
async function auditIfActingAsAdmin(
    pool: PoolDoc,
    request: { auth?: { uid: string; token: { email?: string } } },
    adminClaim: string | undefined,
    action: string,
    poolId: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    const uid = request.auth!.uid;
    if (adminClaim !== 'SUPER_ADMIN' || isPoolCommissioner(pool, uid)) return;
    await writeAdminAudit({
        actorUid: uid, actorEmail: request.auth!.token.email, action,
        targetType: 'pool', targetId: poolId, metadata, status: 'success',
    }).catch((e) => console.error(`[squaresAdmin] admin audit failed for ${action}`, e));
}

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
    async ({ poolId, expectedScores }, request) => {
        const uid = request.auth!.uid;
        await assertNotBannedLive(uid);
        const adminClaim = await confirmedAdminClaim(request);
        const db = admin.firestore();
        const poolRef = db.collection('pools').doc(poolId);

        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as PoolDoc;
            assertPoolOwnerOrSuperAdmin(pool, uid, adminClaim);
            if (!isSquares(pool)) throw new HttpsError('failed-precondition', 'This is not a squares pool.');
            assertCurrentRules(pool);
            await assertSquaresWinnersNotPaused(t, db);

            // THE SCORES THE COMMISSIONER WAS LOOKING AT. A typed score is saved
            // by one request and recorded by this one; if this one arrives
            // first it would record the winner for the score that was there
            // BEFORE the edit, and say it had worked (qodo, PR #759).
            if (expectedScores && !sameFinalScores(finalScoresOf(pool.scores), expectedScores)) {
                throw new HttpsError(
                    'failed-precondition',
                    'The scores are still being saved. Wait a moment, check the scores shown, and press Record winners again.',
                );
            }

            const winnersSnap = await t.get(poolRef.collection('winners'));
            const stored = winnersSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
            const plan = planWinnerWrites(pool as PayoutPool, finalScoresOf(pool.scores), stored, { gameFinal: gameIsFinal(pool) });
            await applyWinnerPlan(t, poolId, plan, { uid, role: 'ADMIN', label: 'Recompute winners' });
            // Recorded by hand, so a mark left by an earlier pause comes off:
            // there is nothing left for the catch-up to do on this pool.
            if ((pool as Record<string, unknown>)[WINNERS_HELD_FIELD] === true) {
                t.update(poolRef, { [WINNERS_HELD_FIELD]: FieldValue.delete() });
            }

            // EVERY SCORE PAYS, SCORED BY HAND. Scoring-event records are made
            // as the live feed reports each score; four quarter-end scores
            // cannot be turned back into them, and guessing would be paying on
            // a guess. So a finished Every-Score-Pays game with no event
            // records is REPORTED, not papered over (qodo, PR #759).
            const eventsNotRecorded = scoreEventStrategy(pool as PayoutPool) !== null
                && gameIsFinal(pool)
                && !stored.some((w) => isEventWinnerId(w.id));
            return { pool, changed: plan.filter((w) => w.kind !== 'audit').length, eventsNotRecorded };
        });
        await auditIfActingAsAdmin(result.pool, request, adminClaim, 'SQUARES_RECOMPUTE_WINNERS', poolId, { changed: result.changed });
        return { success: true, changed: result.changed, eventsNotRecorded: result.eventsNotRecorded };
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

        const drawn = await db.runTransaction(async (t) => {
            const snap = await t.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as PoolDoc;
            assertPoolOwnerOrSuperAdmin(pool, uid, adminClaim);
            if (!isSquares(pool)) throw new HttpsError('failed-precondition', 'This is not a squares pool.');
            assertCurrentRules(pool);
            await assertSquaresWinnersNotPaused(t, db);

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
                // What the draw CHOSE, kept apart from `owner` / `squareId`,
                // which a later change of rule can overwrite.
                drawnOwner: claim.owner,
                drawnSquareId: claim.squareId,
            };
            t.set(winnersRef.doc('final_rollover'), record, { merge: true });

            // Everything else is brought up to date in the same transaction.
            const known = [...stored.filter((w) => w.id !== 'final_rollover'), { id: 'final_rollover', data: record }];
            const plan = planWinnerWrites(pool as PayoutPool, scores, known, { gameFinal: gameIsFinal(pool) });
            await applyWinnerPlan(t, poolId, plan, { uid, role: 'ADMIN', label: 'Recompute winners' });

            // Mirrored on the pool for the admin page; the winner record is the money.
            t.update(poolRef, {
                randomWinner: { squareId: claim.squareId, owner: claim.owner, amount: claim.amount, timestamp: drawnAt.toMillis() },
                // The whole plan was just applied, so a mark left by a pause comes off.
                [WINNERS_HELD_FIELD]: FieldValue.delete(),
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

            return { pool, squareId: claim.squareId, owner: claim.owner, amount: claim.amount, drawnFrom: sold.length };
        });
        await auditIfActingAsAdmin(drawn.pool, request, adminClaim, 'SQUARES_FINAL_PRIZE_DRAW', poolId, { squareId: drawn.squareId, winner: drawn.owner, amount: drawn.amount, drawnFrom: drawn.drawnFrom });
        return { success: true, squareId: drawn.squareId, owner: drawn.owner, amount: drawn.amount };
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

        const unlocked = await db.runTransaction(async (t) => {
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
            return { pool, numbersDiscarded: hadNumbers };
        });
        await auditIfActingAsAdmin(unlocked.pool, request, adminClaim, 'SQUARES_UNLOCK', poolId, { numbersDiscarded: unlocked.numbersDiscarded });
        return { success: true, numbersDiscarded: unlocked.numbersDiscarded };
    },
);

/**
 * Link a squares pool to a game — or unlink it — with the game looked up in the
 * score feed BY THE SERVER (PLAN-SQUARES-SERVER-FIELDS §2b; plan K11).
 *
 * The manage page used to write the link straight onto the pool: the game id,
 * league, teams and kickoff all as the browser described them. A crafted write
 * could pair one game's scores with another game's teams and kickoff, or link a
 * game already under way — and a grid linked to a game under way locks within
 * the minute on whatever numbers it has. The picker greyed such a game out, but
 * a greyed-out button was the only thing that refused it.
 *
 * Now the browser sends only the event id. The feed is asked first, outside the
 * transaction (it is a network call); then the pool is re-read and written in a
 * transaction, through the same shared `squaresGameLink` the create path uses,
 * so a pool linked here is shaped exactly like one linked at creation.
 *
 * Refused, writing nothing:
 *   - the caller is not the pool's owner (or a confirmed SUPER_ADMIN);
 *   - the pool is not squares, or its grid is locked — reopen it first;
 *   - the feed cannot be reached (`unavailable` — try again), or does not have
 *     that game (`not-found`);
 *   - the game has started, by the feed's state or the server's clock.
 *
 * Unlinking clears the link and switches off the kickoff auto-lock the link
 * switched on; the lock time itself is kept, so re-linking puts it back.
 */
export const linkSquaresPoolGame = validated(
    { schema: linkSquaresPoolGameSchema, label: "linkSquaresPoolGame", appCheck: "monitor" },
    async ({ poolId, gameId, league }, request) => {
        const uid = request.auth!.uid;
        await assertNotBannedLive(uid);
        const adminClaim = await confirmedAdminClaim(request);
        const leagueKey = league === 'college' ? 'college' : 'nfl';

        let game: SquaresFeedGame | null = null;
        if (gameId !== null) {
            const found = await lookupSquaresGame(gameId, leagueKey, { readFixture: firestoreFixtureReader });
            if (found === 'unreachable') {
                throw new HttpsError('unavailable', 'Could not reach the schedule. Nothing was changed — try again in a minute.');
            }
            if (found === 'not-found') {
                throw new HttpsError('not-found', 'That game was not found on the schedule. Pick it from the list again.');
            }
            if (squaresFeedGameHasStarted(found, Date.now())) {
                throw new HttpsError('failed-precondition', 'That game has already kicked off. Pick a game that has not started.');
            }
            game = found;
        }

        const db = admin.firestore();
        const poolRef = db.collection('pools').doc(poolId);
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(poolRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Pool not found.');
            const pool = snap.data() as PoolDoc;
            assertPoolOwnerOrSuperAdmin(pool, uid, adminClaim);
            if (!isSquares(pool)) throw new HttpsError('failed-precondition', 'This is not a squares pool.');
            if (pool.isLocked === true) {
                throw new HttpsError('failed-precondition', 'The grid is locked. Reopen it before changing its game.');
            }

            const actor = { uid, role: 'ADMIN' as const, label: request.auth!.token.name || 'Owner' };
            if (game === null) {
                const hadLink = typeof pool.gameId === 'string' && pool.gameId !== '';
                if (!hadLink) return { pool, linked: false as const, changed: false };
                t.update(poolRef, {
                    gameId: FieldValue.delete(),
                    gameTime: FieldValue.delete(),
                    league: FieldValue.delete(),
                    'reminders.lock.enabled': false,
                    updatedAt: Timestamp.now(),
                });
                await writeAuditEvent({
                    poolId, type: 'POOL_GAME_LINKED', severity: 'INFO',
                    message: `Game unlinked (was ${pool.gameId})`,
                    actor, payload: { unlinked: pool.gameId },
                }, t);
                return { pool, linked: false as const, changed: true };
            }

            // The kickoff check above ran before this transaction. Kickoff can
            // pass while it waits, so the clock is asked again here, right before
            // the write (qodo #765, 8).
            if (squaresFeedGameHasStarted(game, Date.now())) {
                throw new HttpsError('failed-precondition', 'That game has just kicked off. Pick a game that has not started.');
            }

            // A DIFFERENT game starts from nothing (qodo #765, 1). The score sync
            // keeps a period score it already holds, and its event records and
            // de-duplication markers are kept per pool, not per game, so a grid
            // carrying another game's play would be scored partly from that game.
            // A grid that has PLAYED one cannot be moved to another; that is a
            // new pool. Re-linking the SAME game keeps what it has.
            //
            // "Played" is read from what only the server writes, as well as the
            // scores (qodo #765 round 2): an unlinked pool's scores are the
            // commissioner's to clear, so unlink → clear → link would otherwise
            // pass. The sync's score-step and event-winner markers in
            // `audit_dedupe` (no client access in firestore.rules) and the
            // winner records stay. Reminder jobs write other keys there, so only
            // the play keys are looked for.
            const changingGame = pool.gameId !== game.id;
            if (changingGame) {
                const dedupes = poolRef.collection('audit_dedupe');
                const keyed = (prefix: string) => dedupes
                    .orderBy(admin.firestore.FieldPath.documentId())
                    .startAt(prefix).endAt(`${prefix}\uf8ff`).limit(1);
                const [winners, steps, events] = await Promise.all([
                    t.get(poolRef.collection('winners').limit(1)),
                    t.get(keyed('SCORE_STEP:')),
                    t.get(keyed('WINNER_EVENT')),
                ]);
                const played = squaresScoresShowPlay(pool.scores as Parameters<typeof squaresScoresShowPlay>[0])
                    || !winners.empty || !steps.empty || !events.empty;
                if (played) {
                    throw new HttpsError('failed-precondition', 'This grid already has scores or winners from a game. Its game cannot be changed — start a new pool for another game.');
                }
            }
            // The shared link keeps the scores only for the SAME game (#760's
            // codex fix): it is told the pool's current game, and decides.
            const patch = squaresGameLink(game, leagueKey, {
                reminders: pool.reminders,
                scores: pool.scores,
                gameId: pool.gameId,
            });
            if (!patch) throw new HttpsError('not-found', 'That game cannot be linked. Pick it from the list again.');
            // Badges, season type and week belong to ONE game. The link writes
            // the ones the feed gives; any it does not give are cleared, so the
            // previous game's are not left showing (qodo #765, 9).
            const staleGameFields = {
                homeTeamLogo: FieldValue.delete(),
                awayTeamLogo: FieldValue.delete(),
                seasonType: FieldValue.delete(),
                week: FieldValue.delete(),
            };
            t.update(poolRef, {
                ...staleGameFields,
                ...patch,
                // The score history shown on the pool belongs to the game too.
                ...(changingGame ? { scoreEvents: [] } : {}),
                updatedAt: Timestamp.now(),
            });
            await writeAuditEvent({
                poolId, type: 'POOL_GAME_LINKED', severity: 'INFO',
                message: `Linked to ${game.awayTeam} @ ${game.homeTeam}`,
                actor,
                payload: { gameId: game.id, league: leagueKey, homeTeam: game.homeTeam, awayTeam: game.awayTeam, kickoff: game.kickoff },
            }, t);
            return { pool, linked: true as const, changed: true };
        });

        await auditIfActingAsAdmin(result.pool, request, adminClaim, 'SQUARES_LINK_GAME', poolId, { gameId, league: leagueKey });
        return result.linked && game
            ? { linked: true, gameId: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam, kickoff: game.kickoff }
            : { linked: false, changed: result.changed };
    },
);
