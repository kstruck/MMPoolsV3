/**
 * The pause switch for squares winner records (qodo, PR #759).
 *
 * Winner records are written by a job that runs every minute and by two
 * commissioner callables. If the payout math is ever found to be wrong on a
 * live game, the only way to stop it writing used to be a code deploy. This is
 * one field:
 *
 *     system/config   →   squaresWinners: { paused: true }
 *
 * While it is set: the score sync keeps the SCORES up to date, records no
 * quarter winner, changes none, and sets no prize amount; "Record winners" and
 * the final-prize draw are refused with a message that says why. Nothing is
 * lost — clear the field and the next sync pass (or the next press of "Record
 * winners") reconciles every record from the scores, exactly as it would have.
 *
 * ONE THING IT DOES NOT STOP, on purpose. An Every-Score-Pays pool still notes
 * each scoring event as it happens — which square the score landed on and who
 * owned it, at $0. An event is only visible while the feed is reporting it;
 * one that is not noted then cannot be rebuilt from the final score. The PRIZE
 * for each event is worked out by the reconcile, which is paused.
 *
 * FAILS OPEN, the same as every other read of `system/config`
 * (`lib/systemGuards.ts`): if the document cannot be read, recording carries
 * on. The switch exists to stop a known-bad run; an unreadable config must not
 * silently stop every pool's winners being recorded on game day.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

export async function squaresWinnersPaused(db: FirebaseFirestore.Firestore = admin.firestore()): Promise<boolean> {
    try {
        const snap = await db.collection("system").doc("config").get();
        return snap.exists && (snap.data() as { squaresWinners?: { paused?: unknown } })?.squaresWinners?.paused === true;
    } catch (e) {
        console.error("[squaresPause] could not read system/config; treating as NOT paused", e);
        return false;
    }
}

/** For the commissioner callables: refuse, in words, while the switch is set. */
export async function assertSquaresWinnersNotPaused(db?: FirebaseFirestore.Firestore): Promise<void> {
    if (await squaresWinnersPaused(db)) {
        throw new HttpsError(
            "failed-precondition",
            "Winner recording is paused by the site administrator. Scores are still being kept; nothing is lost. Try again later.",
        );
    }
}
