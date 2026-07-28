import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { newDeliveryTally, recordDelivery, recordPoolError } from '../lib/deliveryTally';

/**
 * `runReminders` could not see delivery failures its helpers swallowed. A run
 * where every email failed to queue reported zero failed pools and a healthy
 * heartbeat — on the path that is the last thing standing between a member and
 * a missed lock. `DeliveryTally` is the accounting that closes it.
 *
 * The behavioural tests below pin the counters. The SOURCE RATCHET at the
 * bottom is the one that matters over time: the tally is threaded by hand
 * through the reminder pass, so a new sender added later would silently not be
 * counted, and no behavioural test would notice. Same idiom as
 * heartbeat.test.ts and index-exports.test.ts.
 */
describe('DeliveryTally counters', () => {
  it('starts at zero on every axis', () => {
    expect(newDeliveryTally()).toEqual({ queued: 0, skipped: 0, failed: 0, poolErrors: 0 });
  });

  it('counts each outcome on its own axis and returns it unchanged', () => {
    const t = newDeliveryTally();
    expect(recordDelivery(t, 'queued')).toBe('queued');
    recordDelivery(t, 'skipped');
    recordDelivery(t, 'skipped');
    recordDelivery(t, 'failed');
    expect(t).toEqual({ queued: 1, skipped: 2, failed: 1, poolErrors: 0 });
  });

  it("treats an SMS 'skipped' as a config state, not a fault", () => {
    // sendCourierSMS returns 'skipped' when Courier is not configured. Counting
    // that as a failure would mark every reminder pass unhealthy forever on a
    // project that simply does not send SMS.
    const t = newDeliveryTally();
    recordDelivery(t, 'skipped');
    expect(t).toMatchObject({ failed: 0, skipped: 1 });
  });

  it('counts a swallowed pool error apart from a failed send', () => {
    const t = newDeliveryTally();
    recordPoolError(t);
    // Not folded into `failed`: a swallowed pool error means the pool was never
    // evaluated, which is a different loss from a send that was tried and lost.
    expect(t).toEqual({ queued: 0, skipped: 0, failed: 0, poolErrors: 1 });
  });

  it('is a no-op without a tally — every sender outside the pass keeps working', () => {
    // sendEmail is called from 20+ modules (invites, receipts, announcements…)
    // that pass no tally. Throwing here would take down those paths.
    expect(() => {
      recordDelivery(undefined, 'failed');
      recordPoolError(undefined);
    }).not.toThrow();
    expect(recordDelivery(undefined, 'queued')).toBe('queued');
  });
});

describe('the reminder pass threads the tally through EVERY send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'reminders.ts'), 'utf8');

  // Send calls that belong to the scheduled pass. `onWinnerComputed` is a
  // Firestore trigger, not part of the pass, and has no tally to write to — so
  // it is excluded by name rather than by accident.
  const passSendCalls = src
    .split(/\r?\n/)
    .filter((l) => /\bsendEmail\(|\bsendCourierSMS\(/.test(l))
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    // the definition line of sendEmail itself
    .filter((l) => !/export async function sendEmail/.test(l));

  it('finds the send sites it is supposed to be checking', () => {
    // If a refactor moves the sends elsewhere this count changes and the whole
    // ratchet becomes vacuous, so the count is pinned deliberately.
    // 10 sendEmail call sites + 2 sendCourierSMS.
    expect(passSendCalls.length).toBe(12);
  });

  it('every email send in the pass passes a tally', () => {
    const untallied = passSendCalls
      .filter((l) => /\bsendEmail\(/.test(l))
      .filter((l) => !/, tally\)/.test(l))
      // onWinnerComputed's results email — a trigger, outside the pass.
      .filter((l) => !/subject, html, \{ category: 'results' \}\)/.test(l));
    expect(untallied, `untallied sendEmail sites:\n${untallied.join('\n')}`).toEqual([]);
  });

  it('runReminders BINDS the Courier secret — Gen 2 sees only what it binds', () => {
    // Without this the job's courierAuthToken.value() is empty and every SMS
    // reminder it tries to send silently is not sent. It went unnoticed for the
    // life of the job because sendCourierSMS's boolean had no reader. Deleting
    // the binding restores that exact silence, and nothing else in CI notices.
    expect(src).toContain('{ schedule: "every 15 minutes", secrets: [courierAuthToken] }');
  });

  it('the post-send audit write has its OWN catch, so it cannot fake a lost reminder', () => {
    // logAudit runs after every email is sent. Left under the handler's outer
    // catch, a failed audit write increments poolErrors and marks a successful
    // delivery pass unhealthy — a false alarm on the signal this file exists to
    // make trustworthy. Source-level because driving the real handler to its
    // send stage needs a full Firestore fake; same idiom as heartbeat.test.ts.
    const guarded = /try \{\s*await logAudit\([\s\S]{0,400}?\} catch \(auditErr\)/.test(src);
    expect(guarded, 'logAudit is no longer wrapped in its own try/catch').toBe(true);
  });

  it('every SMS send in the pass is recorded', () => {
    // sendCourierSMS returns a DeliveryOutcome, so it feeds recordDelivery
    // directly — and its 'skipped' (Courier not configured) stays a config
    // state rather than being graded as a delivery failure.
    const unrecorded = passSendCalls
      .filter((l) => /\bsendCourierSMS\(/.test(l))
      .filter((l) => !/recordDelivery\(tally, await sendCourierSMS\(/.test(l));
    expect(unrecorded, `unrecorded SMS sites:\n${unrecorded.join('\n')}`).toEqual([]);
  });
});
