import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reminderChecksFor, type ReminderRoutedPool } from '../reminders';

/**
 * Which reminder checks `runReminders` runs for a pool, and which a FINISHED
 * pool does not get.
 *
 * #723 stopped pick reminders on a finished NFL pool but read only two of the
 * six reminder paths. The other four had no finished-pool question at all, so a
 * cancelled bracket or playoff pool with its lock time still ahead emailed
 * every member "it locks soon" on schedule.
 *
 * The two SQUARES checks are pinned as UNCHANGED on a finished pool: they also
 * write to the pool (auto-lock + digit draw, auto-release), so gating them is a
 * production-data change that takes a plan (qodo #1 on #726).
 */

const ON = { payment: { enabled: true }, lock: { enabled: true } };

/** Every way `poolIsOver` says a pool is over. */
const OVER: [string, Partial<ReminderRoutedPool>][] = [
    ['status CANCELED', { status: 'CANCELED' }],
    ['status COMPLETED', { status: 'COMPLETED' }],
    ['status ARCHIVED', { status: 'ARCHIVED' }],
    ['lowercase archived', { status: 'archived' }],
    ['closedVia ADMIN_CLOSE on an open status', { status: 'OPEN', closedVia: 'ADMIN_CLOSE' }],
    ['closedVia SETTLED', { status: 'COMPLETED', closedVia: 'SETTLED' }],
    ['finalizedAt set', { status: 'OPEN', finalizedAt: 1760000000000 }],
];

describe('reminderChecksFor — a pool still in play keeps every check it had', () => {
    it('SQUARES with both reminders on gets payment then lock', () => {
        expect(reminderChecksFor({ type: 'SQUARES', reminders: ON })).toEqual(['SQUARES_PAYMENT', 'SQUARES_LOCK']);
    });

    it('SQUARES gets only the reminder that is enabled', () => {
        expect(reminderChecksFor({ type: 'SQUARES', reminders: { payment: { enabled: true } } })).toEqual(['SQUARES_PAYMENT']);
        expect(reminderChecksFor({ type: 'SQUARES', reminders: { lock: { enabled: true } } })).toEqual(['SQUARES_LOCK']);
        expect(reminderChecksFor({ type: 'SQUARES', reminders: { payment: { enabled: false }, lock: { enabled: false } } })).toEqual([]);
    });

    it('SQUARES with no reminders config gets nothing', () => {
        expect(reminderChecksFor({ type: 'SQUARES' })).toEqual([]);
        expect(reminderChecksFor({ type: 'SQUARES', reminders: null })).toEqual([]);
    });

    it('a legacy pool with no type gets the lock check but never the payment check', () => {
        expect(reminderChecksFor({ reminders: ON })).toEqual(['SQUARES_LOCK']);
    });

    it('PROPS gets neither, as before', () => {
        expect(reminderChecksFor({ type: 'PROPS', reminders: ON })).toEqual([]);
    });

    it('NFL_PLAYOFFS and BRACKET get their one check with no reminders config', () => {
        expect(reminderChecksFor({ type: 'NFL_PLAYOFFS' })).toEqual(['PLAYOFF']);
        expect(reminderChecksFor({ type: 'BRACKET', status: 'OPEN' })).toEqual(['BRACKET']);
    });

    it.each(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'])('%s gets the non-picker check', (type) => {
        expect(reminderChecksFor({ type })).toEqual(['NFL_NON_PICKER']);
    });

    it('an unknown type gets nothing', () => {
        expect(reminderChecksFor({ type: 'SOMETHING_NEW', reminders: ON })).toEqual([]);
    });
});

describe('reminderChecksFor — a finished pool gets no "it locks soon" notice', () => {
    it.each(OVER)('BRACKET, %s: no check', (_label, over) => {
        expect(reminderChecksFor({ type: 'BRACKET', ...over })).toEqual([]);
    });

    it.each(OVER)('NFL_PLAYOFFS, %s: no check', (_label, over) => {
        expect(reminderChecksFor({ type: 'NFL_PLAYOFFS', ...over })).toEqual([]);
    });
});

describe('reminderChecksFor — the checks this rule deliberately leaves alone', () => {
    // Both SQUARES checks write to the pool as well as emailing. Unchanged here.
    it.each(OVER)('SQUARES, %s: payment and lock checks both still run', (_label, over) => {
        expect(reminderChecksFor({ type: 'SQUARES', reminders: ON, ...over })).toEqual(['SQUARES_PAYMENT', 'SQUARES_LOCK']);
    });

    it.each(OVER)('a legacy untyped pool, %s: the lock check still runs', (_label, over) => {
        expect(reminderChecksFor({ reminders: ON, ...over })).toEqual(['SQUARES_LOCK']);
    });

    it.each(OVER)('an NFL season pool, %s: still dispatched — checkNFLNonPickerReminders owns its own guard', (_label, over) => {
        expect(reminderChecksFor({ type: 'NFL_SURVIVOR', ...over })).toEqual(['NFL_NON_PICKER']);
    });
});

describe('runReminders reaches the gated checks only through reminderChecksFor', () => {
    const text = readFileSync(join(__dirname, '..', 'reminders.ts'), 'utf8');

    // A second, direct call site would send the reminder this rule withholds.
    it.each(['checkPlayoffReminders', 'checkBracketReminders'])(
        '%s has exactly one call site, inside the reminderChecksFor loop',
        (fn) => {
            const calls = text.split(`await ${fn}(`).length - 1;
            expect(calls).toBe(1);

            const loopStart = text.indexOf('for (const check of reminderChecksFor(');
            expect(loopStart).toBeGreaterThan(-1);
            const loopEnd = text.indexOf('} catch (poolError', loopStart);
            expect(loopEnd).toBeGreaterThan(loopStart);
            const callAt = text.indexOf(`await ${fn}(`);
            expect(callAt).toBeGreaterThan(loopStart);
            expect(callAt).toBeLessThan(loopEnd);
        },
    );

    it('the non-picker check keeps its own finished-pool return', () => {
        const start = text.indexOf('export async function checkNFLNonPickerReminders(');
        expect(start).toBeGreaterThan(-1);
        expect(text.slice(start, start + 1500)).toContain('poolIsOver(pool as SettleablePool)) return;');
    });
});
