import { describe, it, expect } from 'vitest';
import { bracketReminderTrigger, type BracketTrigger } from '../reminders';

/**
 * Guards the bracket-reminder cadence fix (#265).
 *
 * runReminders dropped from every-5-min to every-15-min polling. Each bracket
 * trigger fires at most once (createNotificationOnce dedupe), so a reminder
 * window narrower than the poll interval can fall entirely between two polls
 * and NEVER be sent. codex review of #265 caught that the original 12-minute
 * windows were missable at 15-minute polling. The windows were widened to 24
 * minutes; these tests prove that survives 15-minute polling and that the old
 * width did not — the guard must FAIL if the windows are narrowed back.
 */

const POLL_MIN = 15;

/** The OLD (pre-#265) 12-minute windows, kept here only to prove the bite. */
function oldTrigger(hoursUntilLock: number): BracketTrigger {
    if (hoursUntilLock <= 24 && hoursUntilLock > 23.8) return '24h';
    if (hoursUntilLock <= 1 && hoursUntilLock > 0.8) return '1h';
    if (hoursUntilLock <= 0 && hoursUntilLock > -0.2) return 'locked';
    return null;
}

/**
 * Simulate polling every POLL_MIN minutes across the whole lock timeline, at a
 * given phase offset (which minute of the interval the polls happen to land
 * on), and collect every trigger that fired. Both auto flags on.
 */
function triggersSeen(
    fn: (h: number) => BracketTrigger,
    pollMin: number,
    phaseMin: number,
): Set<BracketTrigger> {
    const seen = new Set<BracketTrigger>();
    const stepH = pollMin / 60;
    const phaseH = phaseMin / 60;
    // hoursUntilLock walks from 25h before lock to 1h after, one poll per step.
    for (let h = 25 - phaseH; h >= -1; h -= stepH) {
        const t = fn(h);
        if (t) seen.add(t);
    }
    return seen;
}

const withFlags = (h: number) => bracketReminderTrigger(h, { auto24h: true, auto1h: true });

describe('bracketReminderTrigger — window semantics', () => {
    it('fires 24h near the 24-hour mark, gated on auto24h', () => {
        expect(bracketReminderTrigger(23.7, { auto24h: true })).toBe('24h');
        expect(bracketReminderTrigger(23.7, { auto24h: false })).toBeNull();
    });

    it('fires 1h near the 1-hour mark, gated on auto1h', () => {
        expect(bracketReminderTrigger(0.7, { auto1h: true })).toBe('1h');
        expect(bracketReminderTrigger(0.7, { auto1h: false })).toBeNull();
    });

    it('fires locked just after lock, NOT gated on a flag', () => {
        expect(bracketReminderTrigger(-0.1, {})).toBe('locked');
        expect(bracketReminderTrigger(-0.1, undefined)).toBe('locked');
    });

    it('sends nothing in the quiet bands (well before 24h, between 1h and lock)', () => {
        expect(bracketReminderTrigger(30, { auto24h: true, auto1h: true })).toBeNull();
        expect(bracketReminderTrigger(0.4, { auto24h: true, auto1h: true })).toBeNull();
    });
});

describe('15-minute polling never skips a bracket reminder', () => {
    // Every phase alignment of the poll clock must still hit all three windows.
    it('hits 24h, 1h AND locked at EVERY 15-minute poll phase', () => {
        for (let phase = 0; phase < POLL_MIN; phase++) {
            const seen = triggersSeen(withFlags, POLL_MIN, phase);
            expect(
                ['24h', '1h', 'locked'].every((t) => seen.has(t as BracketTrigger)),
                `phase ${phase}min missed one of 24h/1h/locked; saw ${[...seen].join(',')}`,
            ).toBe(true);
        }
    });

    // The bite: the OLD 12-minute windows were missable. If someone narrows the
    // windows back under the poll interval, the test above starts failing — this
    // one documents WHY by showing the old width fails for at least one phase.
    it('proves the OLD 12-minute windows WERE missable at 15-minute polling', () => {
        const phasesThatMiss: number[] = [];
        for (let phase = 0; phase < POLL_MIN; phase++) {
            const seen = triggersSeen(oldTrigger, POLL_MIN, phase);
            if (!['24h', '1h', 'locked'].every((t) => seen.has(t as BracketTrigger))) {
                phasesThatMiss.push(phase);
            }
        }
        expect(
            phasesThatMiss.length,
            'the old 12-min windows should be missable at some 15-min poll phase — ' +
                'if this is 0 the simulation is not exercising the gap it claims to',
        ).toBeGreaterThan(0);
    });
});
