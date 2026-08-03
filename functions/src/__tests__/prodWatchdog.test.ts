import { describe, it, expect } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { computeWatchdogReport, WATCHDOG_SIGNAL_CAP, WATCHDOG_RAW_READ_CAP } from "../prodWatchdog";

/**
 * The watchdog's only non-trivial logic is the mixed-type time window, so the
 * fake Firestore below MODELS FIRESTORE'S TYPE ORDERING rather than just
 * filtering by value. Without that, a single-query implementation would pass
 * these tests and still miss half the signups in production — which is the
 * exact defect the two-query helper exists to prevent.
 *
 * Firestore orders values by TYPE first: number < timestamp < string. So
 * `where(f,'>=', <number>)` matches every timestamp-typed value regardless of
 * date, and `where(f,'>=', <Timestamp>)` matches no numeric value at all.
 */

type Row = { id: string; data: Record<string, unknown> };

const NOW = 1_760_000_000_000; // fixed clock — no Date.now() in assertions
const HOUR = 60 * 60 * 1000;

function rank(v: unknown): number {
    if (typeof v === "number") return 1;
    if (v instanceof Timestamp) return 2;
    if (typeof v === "string") return 3;
    return 9;
}
function value(v: unknown): number {
    if (typeof v === "number") return v;
    if (v instanceof Timestamp) return v.toMillis();
    return 0;
}
/** Firestore's cross-type comparison: type rank first, then value within a type. */
function cmp(a: unknown, b: unknown): number {
    const r = rank(a) - rank(b);
    return r !== 0 ? r : value(a) - value(b);
}

function fakeQuery(rows: Row[], filters: Array<(r: Row) => boolean> = [], cap = Infinity) {
    const self = {
        where(field: string, op: ">=" | "<=", operand: unknown) {
            const next = (r: Row) => {
                const v = r.data[field];
                if (v === undefined) return false;
                return op === ">=" ? cmp(v, operand) >= 0 : cmp(v, operand) <= 0;
            };
            return fakeQuery(rows, [...filters, next], cap);
        },
        limit(n: number) {
            return fakeQuery(rows, filters, n);
        },
        async get() {
            // Implicit order of a range query is by the ranged field ascending;
            // the helper documents that it relies on this for truncation.
            const matched = rows.filter((r) => filters.every((f) => f(r))).slice(0, cap);
            return {
                size: matched.length,
                docs: matched.map((r) => ({
                    id: r.id,
                    data: () => r.data,
                    get: (field: string) => r.data[field],
                })),
            };
        },
    };
    return self;
}

/** `throws` names collections whose read should blow up, to test the unavailable path. */
function fakeDb(collections: Record<string, Row[]>, throws: string[] = []) {
    return {
        collection(name: string) {
            if (throws.includes(name)) {
                const boom = {
                    where: () => boom,
                    limit: () => boom,
                    get: async () => {
                        throw new Error(`${name} is down`);
                    },
                };
                return boom;
            }
            return fakeQuery(collections[name] ?? []);
        },
    } as never;
}

describe("computeWatchdogReport — mixed-type createdAt", () => {
    it("sees BOTH numeric and Timestamp signups in the window", async () => {
        // authService.ts writes Date.now(); userSync.ts writes serverTimestamp.
        // Both are real writers of users/{uid}.createdAt today.
        const report = await computeWatchdogReport(
            fakeDb({
                users: [
                    { id: "num", data: { name: "Numeric Nancy", createdAt: NOW - HOUR } },
                    { id: "ts", data: { name: "Stamped Sam", createdAt: Timestamp.fromMillis(NOW - 2 * HOUR) } },
                ],
            }),
            NOW
        );
        expect(report.signals.newUsers.count).toBe(2);
        expect(report.events.map((e) => e.label).join(" ")).toContain("Numeric Nancy");
        expect(report.events.map((e) => e.label).join(" ")).toContain("Stamped Sam");
    });

    it("excludes both types when they fall outside the window", async () => {
        // The timestamp leg has no upper bound, so an OLD Timestamp row is only
        // kept out by the post-filter. Delete that filter and this test fails.
        const report = await computeWatchdogReport(
            fakeDb({
                users: [
                    { id: "old-num", data: { name: "Old", createdAt: NOW - 48 * HOUR } },
                    { id: "old-ts", data: { name: "Ancient", createdAt: Timestamp.fromMillis(NOW - 90 * 24 * HOUR) } },
                ],
            }),
            NOW
        );
        expect(report.signals.newUsers.count).toBe(0);
        expect(report.events).toHaveLength(0);
    });

    it("drops junk-typed values instead of counting them as epoch 0", async () => {
        const report = await computeWatchdogReport(
            fakeDb({ users: [{ id: "junk", data: { name: "Junk", createdAt: "yesterday" } }] }),
            NOW
        );
        expect(report.signals.newUsers.count).toBe(0);
    });
});

describe("computeWatchdogReport — pools", () => {
    it("keeps a preseason pool and drops sim/hand-labelled test pools", async () => {
        // The carve-out that matters: shared/testPool.isTestPool() counts NFL
        // seasonType 1 as a test pool for STATS, but preseason IS the 2026-08-06
        // pilot this card exists to watch. Using the full predicate here would
        // blank the card on launch night.
        const report = await computeWatchdogReport(
            fakeDb({
                pools: [
                    { id: "p1", data: { name: "HOF Pickem", type: "PICKEM", seasonType: 1, createdAt: NOW - HOUR } },
                    { id: "sim-1", data: { name: "Sim Pool", simRunId: "run-9", createdAt: NOW - HOUR } },
                    { id: "p2", data: { name: "Legacy Test", isTestPool: true, createdAt: NOW - HOUR } },
                ],
            }),
            NOW
        );
        expect(report.signals.newPools.count).toBe(1);
        expect(report.events[0].label).toContain("HOF Pickem");
        expect(report.events[0].href).toBe("/pool/p1");
    });
});

describe("computeWatchdogReport — the cap cuts by time, not by storage type or noise", () => {
    it("keeps a NEWER Timestamp signup over older numeric ones when capped", async () => {
        // The two legs arrive numeric-first. Slicing the raw union would discard
        // every Timestamp-backed row no matter how recent — a cut by storage type
        // wearing a time cut's clothes.
        const olderNumeric = Array.from({ length: WATCHDOG_SIGNAL_CAP }, (_, i) => ({
            id: `n${i}`,
            data: { name: `N${i}`, createdAt: NOW - 10 * HOUR },
        }));
        const report = await computeWatchdogReport(
            fakeDb({
                users: [...olderNumeric, { id: "fresh", data: { name: "Freshest", createdAt: Timestamp.fromMillis(NOW - HOUR) } }],
            }),
            NOW
        );
        expect(report.signals.newUsers.truncated).toBe(true);
        expect(report.events[0].label).toContain("Freshest");
    });

    it("a burst of sim pools cannot hide a real pool behind the cap", async () => {
        // A Test Suite run mints sim pools in bulk. They are filtered AFTER the
        // read (an equality+range query would need a composite index), so with a
        // single budget they eat it and the card claims nothing happened on the
        // day a real pool was created.
        const simPools = Array.from({ length: WATCHDOG_SIGNAL_CAP + 10 }, (_, i) => ({
            id: `sim-${i}`,
            data: { name: `Sim ${i}`, simRunId: "run-1", createdAt: NOW - 2 * HOUR },
        }));
        const report = await computeWatchdogReport(
            fakeDb({ pools: [...simPools, { id: "real", data: { name: "Real Pool", createdAt: NOW - 3 * HOUR } }] }),
            NOW
        );
        expect(report.signals.newPools.count).toBe(1);
        expect(report.events[0].label).toContain("Real Pool");
        expect(WATCHDOG_RAW_READ_CAP).toBeGreaterThan(WATCHDOG_SIGNAL_CAP);
    });
});

describe("computeWatchdogReport — money", () => {
    it("sums only the charges it actually read, and links them to the pool", async () => {
        const report = await computeWatchdogReport(
            fakeDb({
                billingCharges: [
                    { id: "c1", data: { amount: 10.5, kind: "pool", poolId: "p1", at: NOW - HOUR } },
                    { id: "c2", data: { amount: 4.5, kind: "bundle", at: NOW - 2 * HOUR } },
                    { id: "old", data: { amount: 999, kind: "pool", at: NOW - 72 * HOUR } },
                ],
            }),
            NOW
        );
        expect(report.signals.charges.count).toBe(2);
        expect(report.signals.charges.revenue).toBe(15);
        expect(report.events.find((e) => e.label.includes("$10.50"))?.href).toBe("/pool/p1");
        // A bundle charge has no poolId — no link rather than a link to /pool/undefined.
        expect(report.events.find((e) => e.label.includes("$4.50"))?.href).toBeUndefined();
    });
});

describe("computeWatchdogReport — client errors", () => {
    it("counts only rows logClientError wrote, not routine backend log rows", async () => {
        // scoreUpdates.ts writes SYNC_GAME_STATUS progress rows into system_logs
        // (five sites) with a serverTimestamp and no `source`. Counting those as
        // client errors lights the alert tile during a healthy score sync and
        // pushes real errors past the cap.
        const report = await computeWatchdogReport(
            fakeDb({
                system_logs: [
                    { id: "c", data: { source: "client", severity: "high", message: "boom", timestamp: NOW - HOUR } },
                    {
                        id: "sync",
                        data: {
                            type: "SYNC_GAME_STATUS",
                            status: "success",
                            timestamp: Timestamp.fromMillis(NOW - HOUR),
                        },
                    },
                ],
            }),
            NOW
        );
        expect(report.signals.clientErrors.count).toBe(1);
        expect(report.events).toHaveLength(1);
        expect(report.events[0].label).toContain("boom");
    });
});

describe("computeWatchdogReport — the window has an upper bound too", () => {
    it("excludes a future-dated row from a clock-skewed client", async () => {
        // authService.ts stamps createdAt from the USER'S clock. With only a lower
        // bound, one skewed machine's row rides along in every 24h report until
        // its timestamp finally arrives.
        const report = await computeWatchdogReport(
            fakeDb({
                users: [
                    { id: "future", data: { name: "Skewed", createdAt: NOW + 7 * 24 * HOUR } },
                    { id: "ok", data: { name: "Fine", createdAt: NOW - HOUR } },
                ],
            }),
            NOW
        );
        expect(report.signals.newUsers.count).toBe(1);
        expect(report.events[0].label).toContain("Fine");
    });
});

describe("computeWatchdogReport — failure and truncation are reported, never faked", () => {
    it("an unreadable collection yields `unavailable`, not a zero count", async () => {
        const report = await computeWatchdogReport(
            fakeDb({ users: [{ id: "u", data: { name: "U", createdAt: NOW - HOUR } }] }, ["billingCharges"]),
            NOW
        );
        expect(report.signals.charges.count).toBeUndefined();
        expect(report.signals.charges.unavailable).toContain("billingCharges is down");
        // The money figure must be ABSENT — "$0 today" over an unreadable ledger
        // is the fabrication, not a safe default.
        expect(report.signals.charges.revenue).toBeUndefined();
        // One dead signal does not blank the others.
        expect(report.signals.newUsers.count).toBe(1);
    });

    it("flags truncation when the two type legs are each under the cap but their union is not", async () => {
        // 30 numeric + 30 Timestamp signups: neither leg trips its own 51-row
        // read, but 60 rows go through a 50-row slice. Deciding truncation per
        // leg reports an exact count of 50 while dropping ten events.
        const half = Math.ceil(WATCHDOG_SIGNAL_CAP * 0.6);
        const report = await computeWatchdogReport(
            fakeDb({
                users: [
                    ...Array.from({ length: half }, (_, i) => ({
                        id: `n${i}`,
                        data: { name: `N${i}`, createdAt: NOW - HOUR },
                    })),
                    ...Array.from({ length: half }, (_, i) => ({
                        id: `t${i}`,
                        data: { name: `T${i}`, createdAt: Timestamp.fromMillis(NOW - HOUR) },
                    })),
                ],
            }),
            NOW
        );
        expect(report.signals.newUsers.truncated).toBe(true);
        expect(report.signals.newUsers.count).toBe(WATCHDOG_SIGNAL_CAP);
    });

    it("flags truncation when a signal hits the cap", async () => {
        const many: Row[] = Array.from({ length: WATCHDOG_SIGNAL_CAP + 5 }, (_, i) => ({
            id: `u${i}`,
            data: { name: `U${i}`, createdAt: NOW - HOUR },
        }));
        const report = await computeWatchdogReport(fakeDb({ users: many }), NOW);
        expect(report.signals.newUsers.truncated).toBe(true);
        expect(report.signals.newUsers.count).toBe(WATCHDOG_SIGNAL_CAP);
    });
});

describe("computeWatchdogReport — assembly", () => {
    it("returns every signal's events newest-first with the window echoed back", async () => {
        const report = await computeWatchdogReport(
            fakeDb({
                users: [{ id: "u", data: { name: "U", createdAt: NOW - 3 * HOUR } }],
                pools: [{ id: "p", data: { name: "P", createdAt: NOW - HOUR } }],
                system_logs: [
                    { id: "e", data: { source: "client", message: "boom", severity: "high", timestamp: NOW - 2 * HOUR } },
                ],
            }),
            NOW
        );
        expect(report.events.map((e) => e.kind)).toEqual(["POOL_CREATED", "CLIENT_ERROR", "USER_SIGNED_UP"]);
        expect(report.windowHours).toBe(24);
        expect(report.sinceMs).toBe(NOW - 24 * HOUR);
        expect(report.at).toBe(NOW);
    });
});
