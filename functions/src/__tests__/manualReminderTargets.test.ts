import { describe, it, expect } from "vitest";
import { resolveReminderTargets, outstandingDuesByUid } from "../lib/reminderTargets";

// The defect this guards: `sendManualReminder` used to resolve its targets from
// the ENTRIES collection alone, so a member who had never submitted an entry
// matched nothing. The commissioner got `sent: 0, skipped: 0` — no error — and
// the one person a nudge exists for was the one person it could not reach.
//
// The rule is now: the roster is the truth, entries are UNIONed in for pools
// written before Member Records existed (and for partially backfilled pools).

describe("resolveReminderTargets", () => {
    describe("the defect itself", () => {
        it("reaches a member who has NEVER submitted an entry", () => {
            const targets = resolveReminderTargets(
                [{ id: "never-submitted", userName: "Dana" }],
                [], // no entries at all — this is the HOF-night case
            );

            expect(targets).toEqual([{ uid: "never-submitted", displayName: "Dana" }]);
        });

        it("reaches the non-submitters in a pool where others HAVE submitted", () => {
            const targets = resolveReminderTargets(
                [
                    { id: "submitted", userName: "Ada" },
                    { id: "not-yet", userName: "Bo" },
                ],
                [{ id: "submitted", ownerUid: "submitted", userName: "Ada" }],
            );

            expect(targets.map((t) => t.uid).sort()).toEqual(["not-yet", "submitted"]);
        });
    });

    describe("legacy and partially-backfilled pools", () => {
        it("falls back to entries when the pool has NO Member Records at all", () => {
            const targets = resolveReminderTargets(
                [],
                [{ id: "legacy-uid", ownerUid: "legacy-uid", userName: "Cyd" }],
            );

            expect(targets).toEqual([{ uid: "legacy-uid", displayName: "Cyd" }]);
        });

        // This is why the union exists rather than an if/else on "are there any
        // members?". A pool part-way through `backfillMemberRecords` has both,
        // and a "members exist, so ignore entries" branch would silently drop
        // everyone still represented only by an entry.
        it("keeps entry-only members in a PARTIALLY backfilled pool", () => {
            const targets = resolveReminderTargets(
                [{ id: "has-record", userName: "Ada" }],
                [{ id: "entry-only", ownerUid: "entry-only", userName: "Bo" }],
            );

            expect(targets.map((t) => t.uid).sort()).toEqual(["entry-only", "has-record"]);
        });

        it("uses the entry doc id when ownerUid is absent", () => {
            const targets = resolveReminderTargets([], [{ id: "doc-id-is-uid", userName: "Cyd" }]);

            expect(targets).toEqual([{ uid: "doc-id-is-uid", displayName: "Cyd" }]);
        });

        it("prefers ownerUid over the doc id when they disagree", () => {
            const targets = resolveReminderTargets(
                [],
                [{ id: "entry-doc-123", ownerUid: "real-owner", userName: "Cyd" }],
            );

            expect(targets).toEqual([{ uid: "real-owner", displayName: "Cyd" }]);
        });
    });

    describe("one email per member", () => {
        it("does not duplicate a member who also has an entry", () => {
            const targets = resolveReminderTargets(
                [{ id: "both", userName: "Ada" }],
                [{ id: "both", ownerUid: "both", userName: "Ada" }],
            );

            expect(targets).toHaveLength(1);
        });

        it("does not duplicate a member with MULTIPLE entries", () => {
            const targets = resolveReminderTargets(
                [{ id: "multi", userName: "Ada" }],
                [
                    { id: "entry-a", ownerUid: "multi" },
                    { id: "entry-b", ownerUid: "multi" },
                ],
            );

            expect(targets).toHaveLength(1);
            expect(targets[0].uid).toBe("multi");
        });
    });

    describe("display name resolution", () => {
        it("prefers the Member Record name over the entry name", () => {
            const targets = resolveReminderTargets(
                [{ id: "u1", userName: "Roster Name" }],
                [{ id: "u1", ownerUid: "u1", userName: "Stale Entry Name" }],
            );

            expect(targets[0].displayName).toBe("Roster Name");
        });

        it("falls back to the entry name when the Member Record has none", () => {
            const targets = resolveReminderTargets(
                [{ id: "u1" }],
                [{ id: "u1", ownerUid: "u1", userName: "Entry Name" }],
            );

            expect(targets[0].displayName).toBe("Entry Name");
        });

        it("falls back to ownerName when userName is absent", () => {
            const targets = resolveReminderTargets([], [{ id: "u1", ownerName: "Owner Name" }]);

            expect(targets[0].displayName).toBe("Owner Name");
        });

        it("leaves displayName undefined when nothing carries a name", () => {
            // The caller substitutes "there"; this function must not invent one.
            const targets = resolveReminderTargets([{ id: "u1" }], []);

            expect(targets[0].displayName).toBeUndefined();
        });
    });

    describe("explicit target filtering", () => {
        it("narrows to the requested uids", () => {
            const targets = resolveReminderTargets(
                [
                    { id: "a", userName: "Ada" },
                    { id: "b", userName: "Bo" },
                    { id: "c", userName: "Cyd" },
                ],
                [],
                ["b"],
            );

            expect(targets).toEqual([{ uid: "b", displayName: "Bo" }]);
        });

        it("can single out a member who has no entry — the Nudge button's case", () => {
            const targets = resolveReminderTargets(
                [
                    { id: "submitted", userName: "Ada" },
                    { id: "not-yet", userName: "Bo" },
                ],
                [{ id: "submitted", ownerUid: "submitted" }],
                ["not-yet"],
            );

            expect(targets).toEqual([{ uid: "not-yet", displayName: "Bo" }]);
        });

        it("returns nothing when the requested uid is on neither list", () => {
            // Must NOT fabricate a target from the uid the caller asked for —
            // that would email whatever users/{uid} happens to exist.
            const targets = resolveReminderTargets([{ id: "a" }], [], ["stranger"]);

            expect(targets).toEqual([]);
        });

        it("treats an EMPTY targetUids array as 'everyone', not 'nobody'", () => {
            // The callable's schema allows an absent or empty list; both mean
            // the whole roster. A `.length > 0` check is load-bearing here.
            const targets = resolveReminderTargets([{ id: "a" }, { id: "b" }], [], []);

            expect(targets).toHaveLength(2);
        });
    });

    // codex r1 [P2]: the client's buildPoolRoster unions THREE sources
    // (participantIds + members + entries, minus 'guest'). Resolving from only
    // two here meant the dashboard listed a participantIds-only member and
    // enabled Nudge for them, while the callable filtered them out and returned
    // sent: 0, skipped: 0 — the exact defect this change exists to fix, one
    // source along.
    describe("participantIds as a roster source", () => {
        it("reaches a member present ONLY in participantIds", () => {
            const targets = resolveReminderTargets([], [], undefined, ["only-participant"]);

            expect(targets).toEqual([{ uid: "only-participant" }]);
        });

        it("lets a Member Record supply the name for a participantIds uid", () => {
            const targets = resolveReminderTargets(
                [{ id: "u1", userName: "Ada" }],
                [],
                undefined,
                ["u1"],
            );

            expect(targets).toEqual([{ uid: "u1", displayName: "Ada" }]);
        });

        it("lets an entry supply the name for a participantIds uid", () => {
            const targets = resolveReminderTargets(
                [],
                [{ id: "u1", ownerUid: "u1", userName: "Bo" }],
                undefined,
                ["u1"],
            );

            expect(targets).toEqual([{ uid: "u1", displayName: "Bo" }]);
        });

        it("does not duplicate a uid present in all three sources", () => {
            const targets = resolveReminderTargets(
                [{ id: "u1", userName: "Ada" }],
                [{ id: "u1", ownerUid: "u1" }],
                undefined,
                ["u1"],
            );

            expect(targets).toHaveLength(1);
            expect(targets[0].displayName).toBe("Ada");
        });

        it("excludes the 'guest' unclaimed-square sentinel from every source", () => {
            // 'guest' is not a person (src/utils/poolRoster.ts). Emailing it
            // would mean resolving users/guest, whatever that happens to be.
            const targets = resolveReminderTargets(
                [{ id: "guest" }],
                [{ id: "guest", ownerUid: "guest" }],
                undefined,
                ["guest", ""],
            );

            expect(targets).toEqual([]);
        });
    });

    // codex r2 [P2]: "Remind all unpaid" selects on `paidStatus !== 'PAID'`, and
    // a hosting-only commissioner is UNPAID with feeOwed: 0 — hosting is not
    // playing (ADR 0005). The entry-only resolver dropped them by accident;
    // the roster resolver must drop them on purpose, or it emails the
    // commissioner "your entry payment is still due" for money they do not owe.
    describe("PAYMENT reminders and zero liability", () => {
        it("drops a member whose outstanding dues are zero", () => {
            const targets = resolveReminderTargets(
                [{ id: "host", userName: "Commish" }],
                [],
                undefined,
                ["host"],
                new Map([["host", 0]]),
            );

            expect(targets.map((t) => [t.uid, t.owesNothing])).toEqual([["host", true]]);
        });

        it("keeps a member who actually owes", () => {
            const targets = resolveReminderTargets(
                [{ id: "debtor", userName: "Ada" }],
                [],
                undefined,
                [],
                new Map([["debtor", 25]]),
            );

            expect(targets.map((t) => t.uid)).toEqual(["debtor"]);
        });

        it("drops an OVERPAID member (negative outstanding)", () => {
            const targets = resolveReminderTargets(
                [{ id: "overpaid" }],
                [],
                undefined,
                [],
                new Map([["overpaid", -10]]),
            );

            expect(targets[0].owesNothing).toBe(true);
        });

        it("KEEPS a member absent from the map — unknown is not zero", () => {
            // Legacy pools have no Member Record to compute liability from.
            // Silently not reminding a real debtor is the worse failure.
            const targets = resolveReminderTargets(
                [],
                [{ id: "legacy", ownerUid: "legacy" }],
                undefined,
                [],
                new Map([["someone-else", 0]]),
            );

            // Presence alone is NOT the assertion. Since the resolver flags
            // rather than filters, a mutant reading `undefined` as 0 would keep
            // the member in the list AND mark them as owing nothing, so the
            // send loop would skip them. The flag is what must stay unset.
            expect(targets.map((t) => t.uid)).toEqual(["legacy"]);
            expect(targets[0].owesNothing).toBeUndefined();
        });

        it("does not filter at all when no map is passed (PICKS)", () => {
            // A PICKS reminder must reach a paid-up member who has not picked.
            const targets = resolveReminderTargets([{ id: "paid-up" }], [], undefined, []);

            expect(targets.map((t) => t.uid)).toEqual(["paid-up"]);
        });

        it("applies the liability filter BEFORE the explicit target list", () => {
            // Nudging one member by uid must not bypass the zero-liability rule,
            // or the single-row Remind button re-opens what the bulk one closed.
            const targets = resolveReminderTargets(
                [{ id: "host" }],
                [],
                ["host"],
                [],
                new Map([["host", 0]]),
            );

            expect(targets.map((t) => [t.uid, t.owesNothing])).toEqual([["host", true]]);
        });

        it("leaves owesNothing UNSET for a member who owes", () => {
            const targets = resolveReminderTargets([{ id: "d" }], [], undefined, [], new Map([["d", 5]]));

            expect(targets[0].owesNothing).toBeUndefined();
        });

        // codex r4 [P2]: filtering these out made the response {sent:0,skipped:0},
        // which handleRemindOne reports as "not found on this pool's roster" —
        // a wrong and alarming thing to say about a member plainly on screen.
        it("FLAGS rather than removes, so the caller can tell it apart from 'not on the roster'", () => {
            const targets = resolveReminderTargets(
                [{ id: "host", userName: "Commish" }],
                [],
                ["host"],
                [],
                new Map([["host", 0]]),
            );

            expect(targets).toHaveLength(1);
            expect(targets[0]).toEqual({ uid: "host", displayName: "Commish", owesNothing: true });
        });
    });

    it("returns an empty list for a pool with no members and no entries", () => {
        expect(resolveReminderTargets([], [])).toEqual([]);
    });
});

// codex r3 [P2]: legacy Member Records predate the feeOwed stamp, so memberDues
// falls back to the pool entry fee. A host-only owner in a backfilled pool then
// reads as owing a full entry fee they never incurred — and the roster-based
// resolver would have emailed them a payment-due reminder the entries-only one
// never could.
describe("outstandingDuesByUid", () => {
    const pool = { ownerId: "host", type: "NFL_PICKEM", settings: { entryFee: 50 } };

    it("charges a legacy host-only owner NOTHING despite no feeOwed stamp", () => {
        const out = outstandingDuesByUid(pool, [{ id: "host", paidStatus: "UNPAID" }], new Set());

        expect(out.get("host")).toBe(0);
    });

    it.each(["createdByUid", "managerUid"])(
        "exempts a legacy host identified only by %s",
        (field) => {
            // poolOps resolves createdByUid || ownerId || managerUid; the
            // backfill resolves ownerId || createdByUid || managerUid. An
            // ownerId-only check here charged a legacy commissioner the pool fee
            // and emailed them a false payment-due reminder. (codex r7)
            const out = outstandingDuesByUid(
                { type: "NFL_PICKEM", settings: { entryFee: 50 }, [field]: "host" },
                [{ id: "host", paidStatus: "UNPAID" }],
                new Set(),
            );

            expect(out.get("host")).toBe(0);
        },
    );

    it("still charges a legacy owner who DID play", () => {
        // Entry evidence is what distinguishes them; without it the fallback
        // would let a playing commissioner off their own entry fee.
        const out = outstandingDuesByUid(
            pool,
            [{ id: "host", paidStatus: "UNPAID" }],
            new Set(["host"]),
        );

        expect(out.get("host")).toBe(50);
    });

    it("still charges a legacy ordinary member with no stamp", () => {
        const out = outstandingDuesByUid(pool, [{ id: "member", paidStatus: "UNPAID" }], new Set());

        expect(out.get("member")).toBe(50);
    });

    it("does NOT exempt a host whose feeOwed is stamped NONZERO", () => {
        // feeOwed is a one-way stamp: an owner who played carries it even if
        // the entry is later removed. The exemption is for UNSTAMPED records
        // only, and a test using feeOwed: 0 cannot tell the two paths apart —
        // both return 0. Mutation testing caught exactly that.
        const out = outstandingDuesByUid(
            pool,
            [{ id: "host", paidStatus: "UNPAID", feeOwed: 50 }],
            new Set(),
        );

        expect(out.get("host")).toBe(50);
    });

    it("respects an explicit feeOwed: 0 stamp on a modern host record", () => {
        const out = outstandingDuesByUid(
            pool,
            [{ id: "host", paidStatus: "UNPAID", feeOwed: 0 }],
            new Set(),
        );

        expect(out.get("host")).toBe(0);
    });

    it("counts LEGACY rebuy debt from the entry when rebuyOwed was never stamped", () => {
        // A legacy Survivor member marked PAID with rebuysUsed on their entry
        // has rebuyOwed undefined, which memberDues reads as zero — so they
        // looked settled and would never be reminded about real rebuy money.
        const out = outstandingDuesByUid(
            { ...pool, settings: { entryFee: 50, rebuyCost: 20 } },
            [{ id: "m", paidStatus: "PAID", feeOwed: 50 }],
            new Set(["m"]),
            new Map([["m", 2]]),
        );

        expect(out.get("m")).toBe(40);
    });

    it("deducts a legacy rebuyPaid exactly ONCE", () => {
        // qodo: memberDues already nets rebuyPaid into `collected`, so the
        // legacy fallback must not subtract it again. Two rebuys at $20 with
        // $20 already paid leaves $20 owing, not $0 — and $0 would have marked
        // them owesNothing and skipped a reminder for money genuinely due.
        const out = outstandingDuesByUid(
            { ...pool, settings: { entryFee: 50, rebuyCost: 20 } },
            [{ id: "m", paidStatus: "PAID", feeOwed: 50, rebuyPaid: 20 }],
            new Set(["m"]),
            new Map([["m", 2]]),
        );

        expect(out.get("m")).toBe(20);
    });

    it("does not double-count rebuys once rebuyOwed IS stamped", () => {
        const out = outstandingDuesByUid(
            { ...pool, settings: { entryFee: 50, rebuyCost: 20 } },
            [{ id: "m", paidStatus: "PAID", feeOwed: 50, rebuyOwed: 20, rebuyPaid: 20 }],
            new Set(["m"]),
            new Map([["m", 2]]),
        );

        expect(out.get("m")).toBe(0);
    });

    it("still collects REBUY dues from a legacy host-only owner", () => {
        // Hosting excuses the base entry fee, not a rebuy they actually took.
        const out = outstandingDuesByUid(
            pool,
            [{ id: "host", paidStatus: "UNPAID", rebuyOwed: 20, rebuyPaid: 0 }],
            new Set(),
        );

        expect(out.get("host")).toBe(20);
    });

    it("reports zero outstanding for a member who has paid", () => {
        const out = outstandingDuesByUid(
            pool,
            [{ id: "m", paidStatus: "PAID", feeOwed: 50 }],
            new Set(["m"]),
        );

        expect(out.get("m")).toBe(0);
    });

    it("exempts a host with NO member record and no entry", () => {
        // A pre-backfill pool can carry participantIds: [ownerId] with no member
        // document at all. Absent from `members`, such a host would fall through
        // as unknown liability and be chased. (codex r8)
        const out = outstandingDuesByUid(pool, [], new Set());

        expect(out.get("host")).toBe(0);
    });

    it("does NOT exempt a record-less host who has an entry", () => {
        const out = outstandingDuesByUid(pool, [], new Set(["host"]));

        expect(out.has("host")).toBe(false);
    });

    it("treats legacy rebuy debt as UNKNOWN when rebuyCost has drifted to 0", () => {
        // REBUY_DUE events keep the amount actually charged; this path does not
        // read them. If the commissioner later sets rebuyCost to 0, a real debt
        // would compute as 0 and suppress a valid reminder. Rebuys were taken,
        // so the answer is unknown — absent from the map — not zero. (codex r8)
        const out = outstandingDuesByUid(
            { type: "NFL_SURVIVOR", settings: { entryFee: 0, rebuyCost: 0 } },
            [{ id: "m", paidStatus: "PAID", feeOwed: 0 }],
            new Set(["m"]),
            new Map([["m", 2]]),
        );

        expect(out.has("m")).toBe(false);
    });

    it("omits members it was not given — absent means unknown, not zero", () => {
        const out = outstandingDuesByUid(pool, [], new Set());

        expect(out.has("anyone")).toBe(false);
    });
});
