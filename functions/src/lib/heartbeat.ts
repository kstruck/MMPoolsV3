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
 *
 * SCOPE — this is a LAST-RUN signal, not an incident log. Each beat replaces the
 * previous one, so a one-shot failure (say, a stat-correction report that could
 * not be delivered) is erased by the next healthy run. That is deliberate:
 * latching a failure until someone acknowledges it needs an acknowledgement
 * mechanism that does not exist, and a job stuck at `ok: false` from one old
 * blip is a worse signal than a fresh one. Incidents that must survive belong in
 * `admin_audit` (durable, per-event) or an ops page (immediate) — both of which
 * the affected paths already write. Raised by codex review on PR #245 and
 * deliberately not built here.
 *
 * ROLLOUT NOTE — `findStaleJobs` reports a job with no beat as `never-ran`
 * immediately, with no grace period. For a WEEKLY job that is correct but
 * momentarily misleading: `lockNFLSpreadsJob` will read `never-ran` in Ops
 * Health from the moment this deploys until its first Tuesday run, up to seven
 * days, without anything actually being wrong. Modelling deploy time would mean
 * persisting a monitoring-start timestamp for one cosmetic case on a
 * SUPER_ADMIN-only card that pages nobody, so it is documented instead of built.
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
        // `mergeFields`, NOT `merge: true`. Plain merge combines nested maps leaf
        // by leaf, so anything omitted this run SURVIVES from the last one: a job
        // that failed yesterday and recovered today keeps yesterday's `error`, and
        // a finalizer going from disabled to live keeps `detail.enabled: false`
        // sitting next to its live counters. A stale error on a healthy job is
        // worse than no error at all — it is a false alarm, and false alarms are
        // how the real one gets ignored.
        //
        // Naming this job's field in `mergeFields` REPLACES that field wholesale
        // while leaving every other job's entry untouched, which is exactly the
        // semantics wanted, in one write. FieldPath rather than a bare string so a
        // job name is never parsed as a dotted path.
        await db.doc(HEARTBEAT_DOC).set(
            {
                [jobName]: {
                    at: Date.now(),
                    ok: beat.ok,
                    ...(beat.error ? { error: beat.error } : {}),
                    ...(beat.detail ? { detail: beat.detail } : {}),
                },
            },
            { mergeFields: [new admin.firestore.FieldPath(jobName)] },
        );
    } catch (e) {
        console.error(`[heartbeat] FAILED to record ${jobName} — liveness for this job is now unknown:`, e);
    }
}

/**
 * What a handler may report about its own run, beyond "it did not throw".
 *
 * Returning nothing means "ok" — the common case, and what every job that has
 * no swallowed-failure problem should keep doing.
 */
export type HeartbeatVerdict = void | {
    ok?: boolean;
    error?: string;
    detail?: Record<string, unknown>;
};

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
 * NOT THROWING IS NOT THE SAME AS BEING HEALTHY. Several jobs here depend on
 * helpers that deliberately swallow their own errors so a side concern cannot
 * break the main one — the ESPN fetcher returns an empty slate, the snapshot
 * writer returns "skipped". A wrapper that only watched for throws would stamp
 * `ok: true` straight through those outages, recreating the blind spot in the
 * one place built to close it. So a handler may RETURN a verdict, and a
 * returned `ok: false` is recorded exactly like a throw — minus the rethrow,
 * because a degraded run is not a crashed one.
 *
 * The original error is always re-thrown, so Cloud Functions still records the
 * failure and retries/alerting behave exactly as before.
 */
export function withHeartbeat(
    jobName: string,
    handler: () => Promise<HeartbeatVerdict>,
): () => Promise<void> {
    return async () => {
        const db = admin.firestore();
        try {
            const verdict = await handler();
            await recordHeartbeat(db, jobName, {
                ok: verdict?.ok !== false,
                error: verdict?.error ? verdict.error.slice(0, 500) : undefined,
                detail: verdict?.detail,
            });
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            await recordHeartbeat(db, jobName, { ok: false, error: error.slice(0, 500) });
            throw e;
        }
    };
}

/**
 * The verdict for a job whose kill-switch config could not be READ.
 *
 * Every gated job catches that read and falls back to "disabled", which is the
 * right fail-safe — but it makes an unreachable config indistinguishable from a
 * switch someone deliberately left off. One is normal; the other means the job
 * has silently stopped doing its work and will keep looking fine forever. The
 * fallback stays; only the reporting changes.
 */
export function configReadFailedVerdict(jobName: string, e: unknown): HeartbeatVerdict {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[${jobName}] config read failed — job stayed disabled and is NOT healthy:`, e);
    return {
        ok: false,
        error: `config read failed: ${message.slice(0, 300)}`,
        detail: { phase: "config-read" },
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

/**
 * What each wrapped job's schedule actually is, so staleness is measured against
 * reality rather than a guess. Keep in step with the `onSchedule(...)` cron in
 * each job — a wrong number here makes the check either useless or noisy.
 */
export const SCHEDULED_JOB_EXPECTATIONS: Record<string, JobExpectation> = {
    consensusRefreshJob: { everyMinutes: 10 },            // '*/10 * * * *'
    syncWinProbabilityJob: { everyMinutes: 5 },           // '*/5 * * * *'
    syncExpertPicksJob: { everyMinutes: 60 },             // '15 * * * *'
    gradeExpertProfilesJob: { everyMinutes: 24 * 60 },    // '0 3 * * *' ET
    aggregateRevenueDaily: { everyMinutes: 24 * 60 },     // '30 0 * * *' ET
    scheduledHealthCheck: { everyMinutes: 60 },           // every 60 minutes
    releaseStaleCouponReservations: { everyMinutes: 30 }, // every 30 minutes
    scheduledBracketSync: { everyMinutes: 10 },           // every 10 minutes
    nflDeepScoreSweepJob: { everyMinutes: 24 * 60 },      // '30 11 * * *' ET

    // The NFL fleet. These were the LAST jobs to get heartbeats and the FIRST
    // that should have had them: nflFinalizeSweepJob threw FAILED_PRECONDITION
    // every day for ten days without anyone noticing, and A5's snapshot writes
    // died silently inside syncNFLScoresJob. Both were invisible precisely
    // because a job with nothing to do and a job that is broken look identical.
    syncNFLScoresJob: { everyMinutes: 5 },                // '*/5 * * * *'
    nflFinalizeSweepJob: { everyMinutes: 24 * 60 },       // '30 4 * * *' ET
    nflLockWatchJob: { everyMinutes: 60 },                // 'every 60 minutes'
    nflAutoScoreJob: { everyMinutes: 5 },                 // '*/5 * * * *' ET
    // Weekly. The tolerance multiplier makes this ~3 weeks before it is called
    // stale, which is deliberate — a weekly job that ran late is not an outage,
    // and preseason is the only window where a missed run would matter.
    lockNFLSpreadsJob: { everyMinutes: 7 * 24 * 60 },     // '0 9 * * 2' ET
    authBackupJob: { everyMinutes: 7 * 24 * 60 },         // '15 3 * * 0' ET

    // The legacy fleet, wrapped last. Several of these sit on money-adjacent
    // paths — billing enforcement, the Stripe webhook durability sweep, the
    // score updates that decide squares winners — and every one of them could
    // have been dead for weeks with nothing to say so. Intervals are copied
    // from each job's own onSchedule() and must be kept in step with it.
    autoClosePools: { everyMinutes: 24 * 60 },            // '0 4 * * *' ET
    autoLockPools: { everyMinutes: 1 },                   // 'every 1 minutes'
    enforceBillingStatus: { everyMinutes: 24 * 60 },      // '0 23 * * *' ET
    monetizationAlerts: { everyMinutes: 6 * 60 },         // 'every 6 hours'
    checkPlayoffScores: { everyMinutes: 30 },             // 'every 30 minutes'
    runReminders: { everyMinutes: 15 },                   // 'every 15 minutes' (#265)
    syncGameStatus: { everyMinutes: 1 },                  // 'every 1 minutes'
    siteAveragesJob: { everyMinutes: 24 * 60 },           // '30 3 * * *' ET
    webhookDurabilitySweep: { everyMinutes: 24 * 60 },    // '15 5 * * *' ET
    // Keeps the world-readable stats/global from rotting: onPoolLocked never
    // fires for NFL season pools, so without this the public money figures are
    // correct exactly once (PLAN-STATS-INTEGRITY §8.3 step 2, codex R3 (h)).
    recomputeGlobalStatsDaily: { everyMinutes: 24 * 60 }, // '45 5 * * *' ET
};
