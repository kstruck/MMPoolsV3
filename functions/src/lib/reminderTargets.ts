// Pure target-resolution for commissioner "nudge" reminders.
//
// Lives in lib/ with NO firebase-admin import so it can be unit tested directly.
// `manualReminders.ts` cannot be imported from a test: its import chain reaches
// billing.ts, which calls admin.firestore() at module load and throws without an
// initialised app. Same reason lib/weekCompletion.ts is separate from the scorer.

import { memberDues } from "../shared/memberRecord";
import type { MemberRecord } from "../shared/memberRecord";

export interface ReminderTarget {
    uid: string;
    displayName?: string;
    /**
     * PAYMENT only: this member owes nothing, so a "payment due" email would be
     * a false chase. FLAGGED rather than filtered out — the caller must be able
     * to tell "owes nothing" from "not on the roster", because the UI reports
     * an empty result as the latter.
     */
    owesNothing?: boolean;
}

/**
 * Resolve who a manual reminder should reach.
 *
 * Extracted as a pure function so the rule is testable without a Firestore
 * double: the callable it serves is wrapped in `validated`, and mocking that
 * whole path would test the mock more than the rule.
 *
 * Callers pass plain shapes, not snapshots, deliberately.
 */
export function resolveReminderTargets(
    members: Array<{ id: string; userName?: string }>,
    entries: Array<{ id: string; ownerUid?: string; userName?: string; ownerName?: string }>,
    targetUids?: string[],
    participantIds: string[] = [],
    outstandingByUid?: Map<string, number>,
): ReminderTarget[] {
    const targets = new Map<string, ReminderTarget>();

    // THREE sources, matching `src/utils/poolRoster.ts` exactly. The client's
    // roster unions participantIds + members + entries, so anything narrower
    // here lists a member in the UI that the callable then refuses to email —
    // which is the same defect this change exists to fix, one source along.
    //
    // participantIds carries no name; members and entries fill that in below.
    // 'guest' is the unclaimed-square sentinel, never a person (poolRoster.ts).
    for (const uid of participantIds) {
        if (uid && uid !== 'guest') targets.set(uid, { uid });
    }

    // Plain set, not a merge: participantIds entries above carry no name, so
    // there is never a name here to preserve. A merge branch was written first
    // and mutation testing showed it was equivalent code — it could not be
    // made to fail, because the state it defended against cannot occur at this
    // point in the order. Deleted rather than guarded.
    for (const m of members) {
        if (!m.id || m.id === 'guest') continue;
        targets.set(m.id, { uid: m.id, displayName: m.userName });
    }

    for (const entry of entries) {
        // Entry doc id == owner uid for NFL pools; ownerUid wins where present.
        const entryUid = entry.ownerUid || entry.id;
        if (!entryUid || entryUid === 'guest') continue;
        const entryName = entry.userName || entry.ownerName;
        const existing = targets.get(entryUid);
        if (!existing) {
            targets.set(entryUid, { uid: entryUid, displayName: entryName });
        } else if (!existing.displayName) {
            // Member Record wins on name; the entry only fills a blank.
            existing.displayName = entryName;
        }
    }

    const list = [...targets.values()];

    // PAYMENT only: never chase someone for money they do not owe.
    //
    // The bulk "Remind all unpaid" action selects on `paidStatus !== 'PAID'`,
    // and a hosting-only commissioner is UNPAID with `feeOwed: 0` — hosting is
    // not playing (ADR 0005). Before targets came from the roster they had no
    // entry and were dropped by accident; now they must be dropped on purpose.
    //
    // A uid ABSENT from the map is unknown, not zero, and is kept: legacy pools
    // have no Member Record to compute liability from, and silently not
    // reminding a real debtor is the worse failure.
    if (outstandingByUid) {
        for (const t of list) {
            const outstanding = outstandingByUid.get(t.uid);
            // Absent means UNKNOWN, not zero: legacy pools have no Member
            // Record to compute liability from, and silently not chasing a real
            // debtor is the worse failure.
            if (outstanding !== undefined && outstanding <= 0) t.owesNothing = true;
        }
    }

    if (targetUids && targetUids.length > 0) {
        const targetSet = new Set(targetUids);
        return list.filter((t) => targetSet.has(t.uid));
    }
    return list;
}

/**
 * Outstanding dues per member, for PAYMENT reminders only.
 *
 * Mirrors lib/rosterSummary.ts's duesInputs so one pool produces one answer.
 * Members WITHOUT a record are simply absent from the map, which the resolver
 * reads as unknown rather than zero.
 */
export function outstandingDuesByUid(
    pool: {
        ownerId?: string;
        createdByUid?: string;
        managerUid?: string;
        type?: string;
        costPerSquare?: number;
        settings?: { entryFee?: number; costPerSquare?: number; rebuyCost?: number };
    },
    members: Array<Partial<MemberRecord> & { id: string }>,
    entryUids: Set<string>,
    rebuysUsedByUid: Map<string, number> = new Map(),
): Map<string, number> {
    const inputs = {
        poolType: pool.type || "",
        entryFee: pool.settings?.entryFee ?? 0,
        costPerSquare: pool.costPerSquare ?? pool.settings?.costPerSquare,
    };
    // Any of the three owner fields identifies the host. poolOps resolves
    // `createdByUid || ownerId || managerUid` and backfillMemberRecords resolves
    // `ownerId || createdByUid || managerUid` — the two disagree on precedence,
    // so a single-field check here would miss a legacy pool that stores its
    // commissioner in one of the others and charge them the pool fee. Erring
    // toward exemption is the safe direction: the cost is not chasing someone
    // named as the pool's manager, versus emailing a commissioner a demand for
    // money they never owed.
    const hostUids = new Set(
        [pool.createdByUid, pool.ownerId, pool.managerUid].filter((u): u is string => !!u),
    );

    const out = new Map<string, number>();

    // A pre-backfill pool can carry `participantIds: [ownerId]` with NO member
    // document and no entry. Such a host is absent from `members`, so without
    // this they fall through as "unknown liability" and get chased. Seed them
    // at zero first; a real member record below overwrites this.
    for (const host of hostUids) {
        if (!entryUids.has(host)) out.set(host, 0);
    }

    for (const rec of members) {
        const m = { ...rec, uid: rec.id } as MemberRecord;

        // Hosting is not playing (ADR 0005). A seeded owner carries feeOwed: 0,
        // but records written BEFORE that stamp existed have no feeOwed at all,
        // and memberDues then falls back to the pool entry fee - so a legacy
        // host-only owner reads as owing a full entry fee they never incurred.
        // Entry evidence settles it: owner, no entry, no stamp => owes nothing
        // beyond rebuy dues, which are stamped separately and still count.
        const unstamped = rec.feeOwed === undefined;
        const hostOnly = hostUids.has(rec.id) && !entryUids.has(rec.id);
        if (unstamped && hostOnly) {
            out.set(rec.id, (rec.rebuyOwed ?? 0) - (rec.rebuyPaid ?? 0));
            continue;
        }

        const { expected, collected } = memberDues(m, inputs);

        // Legacy rebuy debt. `rebuyOwed` is a stamp that older records lack, and
        // memberDues reads a missing stamp as zero — so a legacy Survivor member
        // marked PAID with rebuysUsed on their entry looked settled and would
        // have been filtered out of payment reminders entirely.
        //
        // This mirrors setPaidStatus's fallback (rebuysUsed x rebuyCost) but
        // deliberately does NOT read each member's REBUY_DUE ledger, which
        // setPaidStatus prefers when present: that is a subcollection query per
        // member, and this runs for a whole roster on one click. The estimate is
        // only ever used to decide whether to SEND A REMINDER; the settlement
        // path still computes the real figure from the ledger.
        let owed = expected - collected;
        if (rec.rebuyOwed === undefined) {
            const rebuysUsed = rebuysUsedByUid.get(rec.id) ?? 0;
            const rebuyCost = pool.settings?.rebuyCost ?? pool.settings?.entryFee ?? 0;
            // NOT `- rebuyPaid`: memberDues already added rebuyPaid to
            // `collected` unconditionally, so `expected - collected` above has
            // netted it once. Subtracting again understated the debt and could
            // zero it out, marking a member who still owes rebuy money as
            // owesNothing and silently skipping their reminder. (qodo)
            owed += rebuysUsed * rebuyCost;

            // Price drift. REBUY_DUE ledger events retain the amount actually
            // charged, and setPaidStatus prefers them for exactly this reason;
            // this path deliberately does not read them (a subcollection query
            // per member, on a whole-roster click). So if the commissioner has
            // since set rebuyCost to 0, a real debt would compute as 0 and the
            // member would be marked owesNothing, suppressing a valid reminder.
            //
            // Rebuys were taken, so the debt is UNKNOWN rather than zero. This
            // file already has a meaning for unknown — ABSENT from the map — so
            // the member is left out rather than given a sentinel value. They
            // stay eligible for a reminder and the settlement path computes the
            // real figure from the ledger.
            if (rebuysUsed > 0 && owed <= 0) {
                out.delete(rec.id);
                continue;
            }
        }
        out.set(rec.id, owed);
    }
    return out;
}
