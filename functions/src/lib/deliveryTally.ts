/**
 * Per-run accounting for member-facing notification delivery.
 *
 * WHY THIS EXISTS. `runReminders` counted only pools whose handler THREW. Every
 * delivery failure underneath that was invisible: `sendEmail` caught its own
 * queue failures and returned nothing, `sendCourierSMS` returned a boolean
 * nobody read, and `checkNFLNonPickerReminders` swallowed its own errors
 * wholesale. **A run where every single email failed to queue reported zero
 * failed pools and a healthy heartbeat** — on the path that is the last thing
 * standing between a member and a missed lock.
 *
 * Same shape as `correctionReportFailures` in `ScoreSyncResult`
 * (`nflSchedule.ts`): counters accumulated through the run, folded into the
 * heartbeat detail, and graded by a pure verdict function.
 *
 * THE DISTINCTION THAT MATTERS, and the reason this is three counters and not
 * one. Not every non-delivery is a fault:
 *
 *   - `queued` — the mail document was written. Success.
 *   - `skipped` — deliberately not sent: no address, an invalid address, an
 *     unsubscribe, or a per-category opt-out. **Never a failure.** Counting
 *     these would make a healthy pool with unsubscribed members page forever,
 *     which is the crying-wolf failure mode `heartbeatVerdicts.ts` exists to
 *     avoid.
 *   - `failed` — the send was attempted and did not get through: the queue
 *     write threw, or the SMS provider refused. This is the signal.
 *
 * `poolErrors` is separate again: a per-pool handler swallowed its own error,
 * so that pool's reminders may not have been evaluated at all. Distinct from a
 * failed *send*, and distinct from `failedPools` (handlers that threw out to
 * the run loop) — three different ways to lose a reminder, counted apart so the
 * heartbeat says which one happened.
 */
export type DeliveryOutcome = 'queued' | 'skipped' | 'failed';

export interface DeliveryTally {
  queued: number;
  skipped: number;
  failed: number;
  poolErrors: number;
}

export const newDeliveryTally = (): DeliveryTally => ({
  queued: 0,
  skipped: 0,
  failed: 0,
  poolErrors: 0,
});

/**
 * Record an email outcome. Returns the outcome so a call site can stay a
 * one-liner. `tally` is optional throughout: every sender outside the reminder
 * pass (invites, receipts, announcements…) calls the same helpers with no tally
 * and is unaffected.
 */
export function recordDelivery(tally: DeliveryTally | undefined, outcome: DeliveryOutcome): DeliveryOutcome {
  if (tally) tally[outcome]++;
  return outcome;
}

/**
 * Record an SMS result. `sendCourierSMS` already returned a boolean — this is
 * the reader it never had. A `false` from it means the provider refused or the
 * request threw; an unconfigured Courier token also returns false and is
 * counted as a failure on purpose, because a reminder pass that believes it is
 * sending SMS and is not should not look healthy.
 */
export function recordSms(tally: DeliveryTally | undefined, ok: boolean): boolean {
  if (tally) tally[ok ? 'queued' : 'failed']++;
  return ok;
}

/** A pool whose handler swallowed its own error — its reminders may never have run. */
export function recordPoolError(tally: DeliveryTally | undefined): void {
  if (tally) tally.poolErrors++;
}
