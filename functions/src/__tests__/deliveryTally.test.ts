import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  newDeliveryTally,
  recordDelivery,
  recordSms,
  recordPoolError,
} from '../lib/deliveryTally';

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

  it('maps an SMS boolean onto queued/failed and passes the boolean through', () => {
    const t = newDeliveryTally();
    expect(recordSms(t, true)).toBe(true);
    expect(recordSms(t, false)).toBe(false);
    expect(t).toMatchObject({ queued: 1, failed: 1 });
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
      recordSms(undefined, false);
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

  it('every SMS send in the pass goes through recordSms', () => {
    const unrecorded = passSendCalls
      .filter((l) => /\bsendCourierSMS\(/.test(l))
      .filter((l) => !/recordSms\(tally, await sendCourierSMS\(/.test(l));
    expect(unrecorded, `unrecorded SMS sites:\n${unrecorded.join('\n')}`).toEqual([]);
  });
});
