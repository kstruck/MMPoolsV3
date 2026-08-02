// Pure target-resolution for commissioner "nudge" reminders.
//
// Lives in lib/ with NO firebase-admin import so it can be unit tested directly.
// `manualReminders.ts` cannot be imported from a test: its import chain reaches
// billing.ts, which calls admin.firestore() at module load and throws without an
// initialised app. Same reason lib/weekCompletion.ts is separate from the scorer.

import { isCanonicalMemberRecord, memberDues } from "../shared/memberRecord";
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
 *
 * `members` is "a Member Record document plus its id", with `joinedAt` widened
 * to `unknown`. Two reasons, both learned the hard way on #344:
 *  - a narrow `{ id; userName? }` made it a COMPILE ERROR to write the forged
 *    shape the §4a filter exists to refuse, i.e. the type declared the most
 *    important input impossible;
 *  - `joinedAt` is not reliably a number — `backfillMemberRecords` stamps
 *    `pool.createdAt`, which on a legacy pool may be a Firestore Timestamp.
 */
export function resolveReminderTargets(
    members: Array<Omit<Partial<MemberRecord>, 'joinedAt'> & { id: string; joinedAt?: unknown }>,
    entries: Array<{ id: string; ownerUid?: string; userName?: string; ownerName?: string }>,
    targetUids?: string[],
    participantIds: string[] = [],
    outstandingByUid?: Map<string, number>,
): ReminderTarget[] {
    const targets = new Map<string, ReminderTarget>();

    // ⛔ participantIds is deliberately NOT a target source, even though the
    // client's buildPoolRoster unions it. It is CLIENT-WRITABLE: firestore.rules
    // `protectedFieldsUnchanged()` protects 'participants' but not
    // 'participantIds', so a pool manager can append any Firebase UID they know
    // while the pool is editable. Using it here would make this callable an
    // arbitrary-email primitive — the manager appends a uid, the callable
    // resolves users/{uid}.email and sends them mail from the platform.
    //
    // Member Records and entries are both written only by server callables, so
    // they are the authorization boundary. The entries-only version was safe by
    // accident; this is safe on purpose.
    //
    // The cost is a real one and worth naming: a member present ONLY in
    // participantIds is listed by the roster UI and cannot be emailed, which is
    // the disagreement codex flagged in round 1. It is accepted rather than
    // fixed here because the alternative is to trust a client-writable field.
    // The durable fix is to add 'participantIds' to protectedFieldsUnchanged(),
    // which is a rules change and its own PR.
    void participantIds;

    // Plain set, not a merge: participantIds entries above carry no name, so
    // there is never a name here to preserve. A merge branch was written first
    // and mutation testing showed it was equivalent code — it could not be
    // made to fail, because the state it defended against cannot occur at this
    // point in the order. Deleted rather than guarded.
    for (const m of members) {
        if (!m.id || m.id === 'guest') continue;
        // ⛔ CANONICAL records only (PLAN-SETPAIDSTATUS-MEMBERSHIP §4a).
        //
        // Until 2026-08-02 the `setPaidStatus` claim branch would CREATE
        // `pools/{anyPool}/members/{caller}` for any authenticated caller (#344).
        // #344 shuts that door, but it does not delete the documents already
        // minted — and this resolver used to accept EVERY document in the
        // collection and resolve its uid to an email address.
        //
        // So without this line, a non-member who exploited the bug before today
        // still receives that pool's pick and payment reminders, which is the
        // exact exposure this PR exists to close. Neither PR closes it alone.
        //
        // Fail-CLOSED on the reminder side, and it needs no production write —
        // the forged document keeps existing, it just stops being a target. A
        // cleanup sweep is a prod-data mutation under Rule 1 and stays out of
        // scope (§7).
        //
        // Cost, named rather than discovered later: a member whose record has no
        // `joinedAt` and who has no entry is dropped. Every server path that
        // CREATES a record stamps `joinedAt`, so the only documents this can
        // reach are forgeries — and anyone with an entry is still unioned in
        // below, which is where the pre-#338 resolver found them anyway.
        if (!isCanonicalMemberRecord(m)) continue;
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

/**
 * The REBUY portion of a member's outstanding dues, keyed by uid.
 *
 * Companion to `outstandingDuesByUid`, deliberately separate rather than folded
 * into its value type: that map is the owes-anything gate and is asserted on by
 * a lot of tests, and widening it to an object would churn all of them to answer
 * a question only the email copy asks.
 *
 * Uses the SAME legacy fallback as `outstandingDuesByUid` — an unstamped
 * `rebuyOwed` falls back to the entry's `rebuysUsed x rebuyCost` — so the two
 * cannot disagree about how much of a debt is rebuy.
 */
export function rebuyPortionByUid(
    pool: { settings?: { entryFee?: number; rebuyCost?: number } },
    members: Array<Partial<MemberRecord> & { id: string }>,
    rebuysUsedByUid: Map<string, number> = new Map(),
): Map<string, number> {
    const rebuyCost = pool.settings?.rebuyCost ?? pool.settings?.entryFee ?? 0;
    const out = new Map<string, number>();
    for (const rec of members) {
        const owed = rec.rebuyOwed !== undefined
            ? rec.rebuyOwed
            : (rebuysUsedByUid.get(rec.id) ?? 0) * rebuyCost;
        out.set(rec.id, Math.max(0, owed - (rec.rebuyPaid ?? 0)));
    }
    return out;
}
