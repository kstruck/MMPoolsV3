// Pure rules for the automated NFL non-picker reminder (runReminders →
// checkNFLNonPickerReminders). No firebase-admin import so both rules can be
// unit-tested directly, the same reason lib/reminderTargets.ts exists.

import { resolveReminderTargets } from "./reminderTargets";

/**
 * Which reminder is due, given hours until the week's FIRST game locks.
 *
 * Two tiers:
 *   '24H' — one day out (T-24h .. T-18h). Kevin, 2026-09-10: "send users a
 *           reminder email automatically 1 day before the pool locks the 1st
 *           game." Replaces the T-36h tier, which landed at ~8 AM the day
 *           before a Thursday-night kickoff — a morning-of-the-day-before
 *           nudge, not "the night before".
 *   '4H'  — last call (T-4h .. T-0).
 *
 * WINDOW WIDTH IS LOAD-BEARING (same rule as bracketReminderTrigger): each tier
 * fires at most once per member per week (createNotificationOnce dedupe), so a
 * window narrower than the 15-minute poll is a reminder never sent. Both
 * windows are hours wide, so a missed poll or a cold start cannot lose one.
 */
export type NFLReminderTier = '24H' | '4H';

export function nflReminderTier(hoursUntilLock: number): NFLReminderTier | null {
    if (hoursUntilLock <= 24 && hoursUntilLock > 18) return '24H';
    if (hoursUntilLock <= 4 && hoursUntilLock > 0) return '4H';
    return null;
}

export interface NonPickerMember {
    id: string;
    role?: string;
    userName?: string;
    /** REQUIRED and explicit — see resolveReminderTargets for why. */
    joinedAt: unknown;
}

export interface NonPickerEntry {
    id: string;
    ownerUid?: string;
    userName?: string;
    /** Pick'em: keyed by game id. Survivor/Margin: keyed by week. */
    picks?: Record<string, unknown> | null;
    /** Survivor only. */
    status?: string;
}

export interface NonPickerInputs {
    poolType: string | undefined;
    week: number;
    weekGameIds: string[];
    members: NonPickerMember[];
    entries: NonPickerEntry[];
}

/** Has this ENTRY got its picks in for the week? */
export function entryHasPicked(poolType: string | undefined, entry: NonPickerEntry, week: number, weekGameIds: string[]): boolean {
    const picks = (entry.picks ?? {}) as Record<string, unknown>;
    if (poolType === 'NFL_PICKEM') return weekGameIds.every(id => !!picks[id]);
    // Firestore map keys arrive as strings; a JS object index coerces a number
    // the same way, but be explicit so a `Map`-shaped fake cannot fool this.
    return !!(picks[String(week)] ?? picks[week as unknown as string]);
}

/**
 * Who still owes picks for the week — resolved from the ROSTER, not the
 * entries collection.
 *
 * WHY THIS EXISTS. An NFL entry document is created by the member's FIRST
 * `submitNFLPicks`; `joinNFLPool` writes participantIds, the participation doc
 * and the Member Record, but no entry. The reminder used to iterate entries
 * alone, so a member who joined and never picked — the person the reminder is
 * for — did not exist to it. Measured on 2026 regular-season Week 1: four live
 * NFL pools, 28 clean runReminders passes inside the T-36h window and 16 inside
 * the T-4h window, zero `NFL_NONPICK_*` notifications written, while Donkeys
 * 2026 had at least five members who had joined days earlier and whose entry
 * was first written on the day of the lock. Every preseason reminder that DID
 * go out went to a member with a prior week's entry. `sendManualReminder` was
 * fixed to read the roster in #338 (lib/reminderTargets.ts); this is the same
 * fix on the automated path.
 *
 * Rules, per roster uid:
 *  - no entry at all → non-picker, UNLESS the Member Record says MANAGER:
 *    hosting is not playing (ADR 0005; `nflPools.ts` seeds owners
 *    `hasPlayableEntry: false`), and a weekly "you haven't picked" to a
 *    hosting-only commissioner is a false chase. A manager who does play has
 *    an entry and is judged on it like everyone else.
 *  - has entries → non-picker if ANY live entry lacks the week's picks. A
 *    Survivor entry that is ELIMINATED is not live; a uid whose every entry is
 *    eliminated owes nothing.
 *
 * Targets come from `resolveReminderTargets` (canonical Member Records ∪
 * entries; participantIds deliberately excluded — it is client-writable), so
 * the automated reminder cannot reach anyone the manual nudge cannot.
 */
export function nflNonPickerUids(input: NonPickerInputs): Set<string> {
    const { poolType, week, weekGameIds, members, entries } = input;
    const targets = resolveReminderTargets(members, entries, undefined, []);

    const entriesByUid = new Map<string, NonPickerEntry[]>();
    for (const e of entries) {
        const uid = e.ownerUid || e.id;
        if (!uid) continue;
        const list = entriesByUid.get(uid);
        if (list) list.push(e); else entriesByUid.set(uid, [e]);
    }
    const roleByUid = new Map(members.map(m => [m.id, m.role]));

    const nonPickers = new Set<string>();
    for (const t of targets) {
        const own = entriesByUid.get(t.uid) ?? [];
        if (own.length === 0) {
            if (roleByUid.get(t.uid) === 'MANAGER') continue; // hosting is not playing
            nonPickers.add(t.uid);
            continue;
        }
        const live = poolType === 'NFL_SURVIVOR' ? own.filter(e => e.status !== 'ELIMINATED') : own;
        if (live.length === 0) continue;
        if (live.some(e => !entryHasPicked(poolType, e, week, weekGameIds))) nonPickers.add(t.uid);
    }
    return nonPickers;
}
