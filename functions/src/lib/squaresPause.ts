/**
 * The pause switch for squares winner records (qodo, PR #759).
 *
 * Winner records are written by a job that runs every minute, by two
 * commissioner callables and by two repair tools. If the payout math is ever
 * found to be wrong on a live game, the only way to stop it writing used to be
 * a code deploy. This is one field:
 *
 *     system/config   →   squaresWinners: { paused: true }
 *
 * While it is set: the SCORES are still kept up to date; no quarter winner is
 * recorded or changed and no prize amount is set; "Record winners" and the
 * final-prize draw are refused with a message that says why.
 *
 * 🛑 IT IS READ INSIDE THE TRANSACTION THAT WOULD WRITE THE WINNERS. The first
 * version read it once, outside, and handed the answer down — so the simulator
 * and "Fix Sync", which reach the same writer by another road, were never told;
 * and a pause set while a run was under way was not seen by the pools that run
 * had not reached yet (qodo, round 4). Read in the transaction, every road to
 * the writer passes it, and a pause that lands while a write is being prepared
 * makes that write retry and see it.
 *
 * NOTHING IS LOST, HOWEVER LONG IT IS SET. A pool whose winners were held back
 * is marked (`squaresWinnersHeld`). When the switch is cleared the sync finds
 * the marked pools and records what was held — including a game that finished,
 * and dropped out of the sync's own window, while the switch was on. (A marked
 * pool that has since been put on Manual Score Override is the one exception:
 * its winners wait for the commissioner's "Record winners" button, like every
 * hand-typed score, and the manage page says what is waiting.)
 *
 * ONE THING IT DOES NOT STOP, on purpose. An Every-Score-Pays pool still notes
 * each scoring event as it happens — which square the score landed on and who
 * owned it, at $0. An event is only visible while the feed is reporting it;
 * one that is not noted then cannot be rebuilt from the final score. The PRIZE
 * for each event is worked out by the reconcile, which is paused.
 *
 * IF THE CONFIG CANNOT BE READ, NOTHING IS WRITTEN. The read is part of the
 * transaction: when it fails the transaction fails, that pool is left exactly
 * as it was, and the next pass tries again. It neither "fails open" (writing
 * through a switch nobody could read) nor latches shut.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

/** Set on a pool whose winner records the pause held back; cleared when they are recorded. */
export const WINNERS_HELD_FIELD = "squaresWinnersHeld";

const configRef = (db: FirebaseFirestore.Firestore) => db.collection("system").doc("config");

const pausedIn = (data: FirebaseFirestore.DocumentData | undefined): boolean =>
    (data as { squaresWinners?: { paused?: unknown } } | undefined)?.squaresWinners?.paused === true;

/** Is the switch set? Read in `transaction` — call it before the transaction's first write. */
export async function squaresWinnersPausedIn(
    transaction: FirebaseFirestore.Transaction,
    db: FirebaseFirestore.Firestore = admin.firestore(),
): Promise<boolean> {
    const snap = await transaction.get(configRef(db));
    return snap.exists && pausedIn(snap.data());
}

/** For the commissioner callables: refuse, in words, while the switch is set. */
export async function assertSquaresWinnersNotPaused(
    transaction: FirebaseFirestore.Transaction,
    db?: FirebaseFirestore.Firestore,
): Promise<void> {
    if (await squaresWinnersPausedIn(transaction, db)) {
        throw new HttpsError(
            "failed-precondition",
            "Winner recording is paused by the site administrator. Scores are still being kept; nothing is lost. Try again later.",
        );
    }
}

/**
 * A cheap look, outside any transaction — ONLY to decide whether the catch-up
 * is worth starting. It decides nothing about a write; the transaction does.
 */
export async function squaresWinnersPausedHint(db: FirebaseFirestore.Firestore = admin.firestore()): Promise<boolean> {
    const snap = await configRef(db).get();
    return snap.exists && pausedIn(snap.data());
}
