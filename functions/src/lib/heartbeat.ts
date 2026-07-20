import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Scheduled-job heartbeats — "did this job actually run?"
 *
 * WHY THIS EXISTS. Twice in one week a scheduled job was armed, deployed, and
 * completely dead, silently:
 *   - A5 feed snapshots: a missing composite index, the error swallowed by the
 *     catch that stops a snapshot failure breaking score sync.
 *   - nflFinalizeSweepJob: a missing composite index made its candidate query
 *     throw FAILED_PRECONDITION every day from 2026-07-10 to 2026-07-20. Ten
 *     days, zero audit entries, nobody noticed.
 *
 * In both cases "ran fine" and "never ran" were INDISTINGUISHABLE, because a
 * job that produces nothing when there is nothing to do looks exactly like a
 * job that is broken. Neither was findable by reading code.
 *
 * A heartbeat makes absence meaningful: every wrapped job stamps
 * `system/heartbeats` on completion, so a stale or missing entry is a signal
 * rather than a shrug.
 *
 * ONE DOC, not an audit entry per run: these jobs run as often as every minute,
 * so per-run audit rows would be noise and cost. A single doc keyed by job name
 * answers "when did each job last run?" at a glance.
 */

export const HEARTBEAT_DOC = "system/heartbeats";

export interface JobHeartbeat {
    /** Epoch ms of the last COMPLETED run. */
    at: number;
    /** false when the run threw — the job ran but did not finish its work. */
    ok: boolean;
    /** Truncated error message when ok === false. */
    error?: string;
    /** Optional per-job detail, e.g. how many records were processed. */
    detail?: Record<string, unknown>;
}

/**
 * Stamp a job's heartbeat. Best-effort and NEVER throws: a heartbeat is
 * observability, and losing one must not break the job it observes. That is the
 * same principle as the ops-alert dispatcher — but note the lesson from A5,
 * where a well-intentioned catch hid a real failure. Here the swallowed error
 * is logged at error level precisely so it cannot vanish.
 */
export async function recordHeartbeat(
    db: Firestore,
    jobName: string,
    beat: Omit<JobHeartbeat, "at">,
): Promise<void> {
    try {
        await db.doc(HEARTBEAT_DOC).set(
            { [jobName]: { at: Date.now(), ...beat } },
            { merge: true },
        );
    } catch (e) {
        console.error(`[heartbeat] FAILED to record ${jobName} — liveness for this job is now unknown:`, e);
    }
}

/**
 * Wrap a scheduled handler so it stamps a heartbeat however it finishes.
 *
 * Wrapping rather than calling `recordHeartbeat` inline is deliberate:
 *  - several of these jobs `return` early (e.g. syncWinProbabilityJob bails when
 *    no game is live), so an end-of-body call would be skipped on exactly the
 *    runs that are most normal;
 *  - a throw must still record, marked `ok: false`, or a persistently failing
 *    job looks identical to one that never ran — the failure this whole module
 *    exists to prevent.
 *
 * The original error is always re-thrown, so Cloud Functions still records the
 * failure and retries/alerting behave exactly as before.
 */
export function withHeartbeat(
    jobName: string,
    handler: () => Promise<void>,
): () => Promise<void> {
    return async () => {
        const db = admin.firestore();
        try {
            await handler();
            await recordHeartbeat(db, jobName, { ok: true });
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            await recordHeartbeat(db, jobName, { ok: false, error: error.slice(0, 500) });
            throw e;
        }
    };
}

/** What we expect of a job, for staleness evaluation. */
export interface JobExpectation {
    /** How often the job is scheduled, in minutes. */
    everyMinutes: number;
}

export interface StaleJob {
    jobName: string;
    reason: "never-ran" | "stale" | "failing";
    /** Minutes since the last completed run; null when it has never run. */
    ageMinutes: number | null;
    error?: string;
}

/**
 * Which jobs look dead? Pure, so the thresholds are unit-tested rather than
 * discovered in production.
 *
 * A job is stale once it has missed MORE THAN `toleranceMultiplier` of its own
 * interval. The multiplier exists because Cloud Scheduler is not punctual to the
 * second and a cold start can push a run late; flagging at exactly 1x would cry
 * wolf constantly, and an alarm that cries wolf gets ignored — which is how the
 * real outage gets missed.
 */
export function findStaleJobs(
    heartbeats: Record<string, JobHeartbeat | undefined>,
    expectations: Record<string, JobExpectation>,
    nowMs: number,
    toleranceMultiplier = 3,
): StaleJob[] {
    const stale: StaleJob[] = [];
    for (const [jobName, exp] of Object.entries(expectations)) {
        const hb = heartbeats[jobName];
        if (!hb || typeof hb.at !== "number") {
            stale.push({ jobName, reason: "never-ran", ageMinutes: null });
            continue;
        }
        const ageMinutes = (nowMs - hb.at) / 60_000;
        if (ageMinutes > exp.everyMinutes * toleranceMultiplier) {
            stale.push({ jobName, reason: "stale", ageMinutes: Math.round(ageMinutes) });
        } else if (hb.ok === false) {
            // Ran recently but threw — distinct from stale, and needs a different fix.
            stale.push({ jobName, reason: "failing", ageMinutes: Math.round(ageMinutes), error: hb.error });
        }
    }
    return stale;
}
