/**
 * Per-job heartbeat verdicts: "given what this run counted, was it healthy?"
 *
 * WHY THESE ARE HERE AND NOT IN THE JOB FILES. Every one of these decisions
 * used to be inline in a scheduled handler, where nothing could test it. The
 * only guard was the source-level ratchet in `__tests__/heartbeat.test.ts`,
 * which asks whether a handler has SOME path that reports failure — it cannot
 * ask whether the verdict is RIGHT. Deleting `autoLock`'s failure count
 * produced no build error and no test failure; that was verified, not assumed.
 *
 * They live in `lib/` rather than beside each job because the job modules call
 * `admin.firestore()` at module scope, so importing one into a unit test needs
 * an initialized Firebase app. `lib/billingAccess.ts` and `lib/nflLockWatch.ts`
 * already set this precedent for the same reason. `sweepRunVerdict` remains in
 * `nflFinalize.ts` — it depends on that module's SWEEP_ERROR_PREFIX and has its
 * own passing tests, so moving it would be churn for no gain.
 *
 * Every helper here is PURE: counts in, verdict out, no I/O.
 *
 * THE TWO FAILURE MODES, both of which have bitten this repo:
 *
 *   1. Silent success — a run where everything failed still reports `ok: true`,
 *      because per-item catches kept the loop alive and the handler returned
 *      nothing. This is what the `ok: false` branches exist for.
 *   2. Crying wolf — a normal, quiet run reports degraded, so the signal gets
 *      ignored and the real alert is missed later. This is why "zero pools due"
 *      and "the cap deferred some work" are deliberately NOT failures.
 *
 * Both directions are tested in `__tests__/heartbeatVerdicts.test.ts`.
 */
import type { HeartbeatVerdict } from './heartbeat';

// ---------------------------------------------------------------- autoClose

/**
 * Did a DRY run of the auto-close sweep actually produce its report?
 *
 * The audit entry is the dry run's only output, and `writeAdminAudit` swallows
 * its own failures — losing it leaves a run that examined real pools, wrote
 * nothing a human can read, and stamped a healthy beat.
 */
export function autoCloseDryRunVerdict(wouldClose: number, audited: boolean): HeartbeatVerdict {
  const detail = { dryRun: true, wouldClose };
  return audited ? { detail } : { ok: false, error: 'dry-run report not written', detail };
}

/**
 * Did a LIVE auto-close run close what it set out to close?
 *
 * `failed` counts pools whose close threw. The per-pool catch stops one bad
 * pool from ending the sweep, which meant a run where EVERY close failed still
 * reported healthy.
 *
 * `overflow` is deliberately NOT a failure: it means more pools were eligible
 * than MAX_PER_RUN and the rest roll to the next run — the safety cap working
 * as designed. Marking that unhealthy would page nightly during a genuine
 * backlog. It stays in `detail` so the backlog is still visible.
 */
export function autoCloseVerdict(
  run: { closed: number; failed: number; overflow: number },
): HeartbeatVerdict {
  return run.failed > 0
    ? {
        ok: false,
        error: `${run.failed} pool(s) failed to close`,
        detail: { closed: run.closed, failed: run.failed, overflow: run.overflow },
      }
    : { detail: { closed: run.closed, overflow: run.overflow } };
}

// ----------------------------------------------------------------- autoLock

/**
 * Did the minute's auto-lock pass lock what was due?
 *
 * Two independent failure modes, reported together because either one leaves
 * picks open past a deadline:
 *
 *   - `failed`: a due pool's lock transaction threw. The per-pool catch stops
 *     one failure taking the batch down, which meant a run where NONE of the
 *     due pools locked still reported healthy.
 *   - `invalidDeadlines`: a pool was selected for auto-lock but its `lockAt` is
 *     unparseable, so it can never lock — silently skipped every minute,
 *     forever. Counted separately because it is a data problem that will not
 *     clear itself on the next run.
 *
 * Zero due pools is HEALTHY, not idle-suspicious: this job fires every minute
 * and most minutes have nothing to do.
 */
export function autoLockVerdict(
  run: { duePools: number; failed: number; invalidDeadlines: number },
): HeartbeatVerdict {
  const problems: string[] = [];
  if (run.failed > 0) problems.push(`${run.failed} of ${run.duePools} due pool(s) failed to lock`);
  if (run.invalidDeadlines > 0) {
    problems.push(`${run.invalidDeadlines} pool(s) have an unparseable lockAt and can never auto-lock`);
  }
  return problems.length > 0
    ? {
        ok: false,
        error: problems.join('; '),
        detail: { duePools: run.duePools, failed: run.failed, invalidDeadlines: run.invalidDeadlines },
      }
    : { detail: { duePools: run.duePools } };
}

// ------------------------------------------------------------------ billing

/**
 * Did the nightly billing sweep apply every transition it decided on?
 *
 * A MONEY path. The per-pool catches keep one bad pool from stopping
 * enforcement, which meant a run where every transition failed still stamped a
 * healthy beat — and a pool that should have locked but silently did not is
 * free access nobody is told about.
 *
 * Zero transitions is HEALTHY: most nights nothing is due.
 */
export function billingEnforceVerdict(
  run: { trialToGrace: number; graceToLocked: number; failedTransitions: number },
): HeartbeatVerdict {
  return run.failedTransitions > 0
    ? {
        ok: false,
        error: `${run.failedTransitions} billing transition(s) failed`,
        detail: {
          trialToGrace: run.trialToGrace,
          graceToLocked: run.graceToLocked,
          failedTransitions: run.failedTransitions,
        },
      }
    : { detail: { trialToGrace: run.trialToGrace, graceToLocked: run.graceToLocked } };
}

// ------------------------------------------------------- monetization alerts

/** Did a DRY monetization-alert run produce its report? It is the only output. */
export function monetizationDryRunVerdict(wouldWrite: number, audited: boolean): HeartbeatVerdict {
  const detail = { dryRun: true, wouldWrite };
  return audited ? { detail } : { ok: false, error: 'dry-run report not written', detail };
}

/**
 * Did a LIVE monetization-alert run write the alerts it decided on, and record
 * what it did?
 *
 * `failedUpserts` counts alerts whose write threw; the per-candidate catch
 * keeps one bad alert from ending the run, which meant a run where every upsert
 * failed still reported healthy. `audited` covers the run summary, which
 * `writeAdminAudit` can lose silently.
 *
 * All-zero counts are HEALTHY — nothing currently looks like abuse, which is
 * the normal state.
 */
export function monetizationVerdict(
  run: { created: number; refreshed: number; reopened: number; failedUpserts: number; audited: boolean },
): HeartbeatVerdict {
  const problems: string[] = [];
  if (run.failedUpserts > 0) problems.push(`${run.failedUpserts} alert upsert(s) failed`);
  if (!run.audited) problems.push('run summary not written');
  return problems.length > 0
    ? {
        ok: false,
        error: problems.join('; '),
        detail: {
          created: run.created,
          refreshed: run.refreshed,
          reopened: run.reopened,
          failedUpserts: run.failedUpserts,
        },
      }
    : { detail: { created: run.created, refreshed: run.refreshed, reopened: run.reopened } };
}

// ---------------------------------------------------------------- reminders

/**
 * Did the reminder pass get through its pools?
 *
 * `failedPools` counts pools whose handler THREW. The per-pool catches stop one
 * bad pool from silencing reminders for all the others, which meant a run where
 * every pool threw still reported healthy — and reminders are the last thing
 * standing between a member and a missed lock.
 *
 * KNOWN GAP, carried over from the inline version rather than quietly dropped:
 * this cannot see failures the nested helpers swallow on their own.
 * `checkNFLNonPickerReminders` catches its own query errors, `sendEmail`
 * catches queue failures, and `sendCourierSMS` returns a boolean nobody reads.
 * A run where every email failed to queue still reports zero failed pools.
 * Closing that means plumbing an outcome back through each helper — a real
 * change to the delivery path, and its own PR.
 */
export function reminderPassVerdict(run: { failedPools: number }): HeartbeatVerdict {
  return run.failedPools > 0
    ? {
        ok: false,
        error: `${run.failedPools} pool(s) failed during the reminder pass`,
        detail: { failedPools: run.failedPools },
      }
    : { detail: { failedPools: 0 } };
}

// ------------------------------------------------- webhook durability sweep

/**
 * Did the sweep's findings actually reach anyone?
 *
 * This job exists to SHOUT about stuck Stripe webhooks — money a customer paid
 * that the system never applied. Both of its outputs swallow their own
 * failures, so a run that FOUND stuck events and then reached nobody is the
 * worst possible silent success.
 *
 * Note what is NOT a failure: finding stuck events and successfully reporting
 * them is a HEALTHY run. The job's contract is "tell someone", not "find
 * nothing" — grading a successful alert as unhealthy would conflate the monitor
 * breaking with the thing it monitors breaking. `stuckCount` stays in `detail`
 * either way.
 */
export function webhookSweepVerdict(
  run: { stuckCount: number; delivery: string; audited: boolean },
): HeartbeatVerdict {
  const lost: string[] = [];
  if (run.delivery === 'failed') lost.push('ops page undelivered');
  if (!run.audited) lost.push('audit entry not written');
  return lost.length > 0
    ? {
        ok: false,
        error: `${run.stuckCount} stuck event(s) found but ${lost.join(' and ')}`,
        detail: { stuckCount: run.stuckCount },
      }
    : { detail: { stuckCount: run.stuckCount } };
}
