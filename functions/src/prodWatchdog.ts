import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { validated } from "./lib/validated";
import { getProdWatchdogSchema } from "./schemas/prodWatchdog";
import { isSimPool, isExplicitlyMarkedTestPool } from "./shared/testPool";

/**
 * Production Watchdog — what REAL PEOPLE did on the platform in the last 24h.
 *
 * The platform already has an infra monitor (`opsHealth.ts`: open alerts, failed
 * webhooks, dead scheduled jobs) and a money rollup (`revenueAggregates.ts`).
 * Neither answers the question an operator actually asks the morning after a
 * launch: *who showed up, what did they make, what did they pay, what broke on
 * them* — with a link to go look at it. That gap is what this closes, ahead of
 * the 2026-08-06 Hall of Fame pilot being the first real traffic.
 *
 * READ-ONLY BY CONSTRUCTION. It writes nothing — no report doc, no rollup, no
 * kill-switch to arm. There is no scheduled variant on purpose: the daily-job
 * shape exists to PRECOMPUTE, and at this scale computing on open is cheaper
 * than a job plus a stored document plus the rules entry to read it back. If a
 * digest ever needs to be pushed (Slack/email) rather than pulled, that is when
 * the scheduler earns its place — and it can call computeWatchdogReport().
 *
 * Same shape as opsHealth.ts: pure compute function + SUPER_ADMIN callable.
 */

/** Rolling window. One day is what "since I last looked" means in practice. */
export const WATCHDOG_WINDOW_HOURS = 24;

/** Per-signal read cap. Truncation is REPORTED, never silent — see WatchdogSignal. */
export const WATCHDOG_SIGNAL_CAP = 50;

export type WatchdogEventKind =
    | "POOL_CREATED"
    | "USER_SIGNED_UP"
    | "CHARGE"
    | "CLIENT_ERROR";

export interface WatchdogEvent {
    kind: WatchdogEventKind;
    at: number;
    /** One-line human summary. */
    label: string;
    /** In-app path to go LOOK at the thing, when one exists. */
    href?: string;
}

export interface WatchdogSignal {
    /**
     * ABSENT when the underlying read failed. A failed read is not zero events,
     * and rendering it as 0 is the fabrication this repo's "show unavailable,
     * never a plausible substitute" rule exists to stop (mmp-superadmin-surface
     * §9.6). The client renders absent as "unavailable", not as a count.
     */
    count?: number;
    /** True when the cap was hit — the count is a floor, not a total. */
    truncated: boolean;
    /** Why the read failed. Present iff `count` is absent. */
    unavailable?: string;
}

export interface WatchdogReport {
    at: number;
    sinceMs: number;
    windowHours: number;
    signals: {
        newUsers: WatchdogSignal;
        newPools: WatchdogSignal;
        /** `revenue` is the sum of the charges actually read; absent if unavailable. */
        charges: WatchdogSignal & { revenue?: number };
        clientErrors: WatchdogSignal;
    };
    /** Newest first, across all signals. */
    events: WatchdogEvent[];
}

/** Firestore value → epoch ms, for fields written as either a number or a Timestamp. */
export function toMillis(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
        try {
            return (v as { toMillis: () => number }).toMillis();
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Docs whose `field` falls in [sinceMs, now], where the field may be stored as a
 * NUMBER or as a Firestore TIMESTAMP.
 *
 * Two queries, not one, and this is the whole reason this helper exists.
 * `users.createdAt` is genuinely mixed: the client signup path writes
 * `Date.now()` (authService.ts) while `syncAllUsers` writes
 * `FieldValue.serverTimestamp()` (userSync.ts). Firestore orders by TYPE first,
 * so a range query with a numeric bound cannot see Timestamp-typed values and a
 * range with a Timestamp bound cannot see numeric ones — either single query
 * silently drops half the collection's writers, and a watchdog that silently
 * misses signups is worse than no watchdog.
 *
 *   - numeric leg: both bounds are numbers, so it stays numbers-only — which is
 *     also why the two legs can never return the same document.
 *   - timestamp leg: both bounds are Timestamps, so it stays timestamps-only.
 *     Junk of another type (string, array) is excluded by the same bounds, and
 *     anything that slips through is dropped by the toMillis() filter below.
 *
 * Both are single-field ranges, so neither needs a composite index (same
 * constraint opsHealth.ts works under).
 *
 * BOTH ENDS ARE BOUNDED. An upper bound of `nowMs` is not tidiness: the client
 * signup path stamps `Date.now()` from the USER'S clock, so one skewed machine
 * writes a row dated next week, and a lower-bound-only window would carry that
 * row in every "last 24h" report until its timestamp finally arrived. It is
 * excluded now and appears in the window its stamp actually names.
 *
 * No orderBy: the implicit order of a range query is by that field ascending, so
 * a truncated read keeps the OLDEST rows in the window rather than the newest.
 * Within a 24h window every row is recent either way, and `truncated` says so
 * out loud. Adding orderBy(field,'desc') would fix the cut but is one more index
 * assumption for a case the cap makes rare.
 */
async function windowDocs(
    query: admin.firestore.Query,
    field: string,
    sinceMs: number,
    nowMs: number,
    cap: number
): Promise<{ rows: Array<{ id: string; at: number; data: admin.firestore.DocumentData }>; truncated: boolean }> {
    const [numeric, stamped] = await Promise.all([
        query.where(field, ">=", sinceMs).where(field, "<=", nowMs).limit(cap + 1).get(),
        query
            .where(field, ">=", Timestamp.fromMillis(sinceMs))
            .where(field, "<=", Timestamp.fromMillis(nowMs))
            .limit(cap + 1)
            .get(),
    ]);

    // The range check here is a BACKSTOP — the query bounds above already do it.
    // It stays because the whole point of this helper is that field types are not
    // what they look like, and a value the bounds let through for a type reason
    // must not reach the report on the strength of the query alone.
    const byId = new Map<string, { id: string; at: number; data: admin.firestore.DocumentData }>();
    for (const doc of [...numeric.docs, ...stamped.docs]) {
        const at = toMillis(doc.get(field));
        if (at === null || at < sinceMs || at > nowMs) continue;
        byId.set(doc.id, { id: doc.id, at, data: doc.data() });
    }

    // Truncation is decided AFTER the merge, not per leg. Each leg can come back
    // under its own cap while the union sits over it (25 numeric + 30 Timestamp
    // signups is 55 rows through two 51-row reads), and the slice below would
    // then drop five events while the signal reported an exact count of 50.
    const rows = [...byId.values()];
    const truncated = numeric.size > cap || stamped.size > cap || rows.length > cap;
    return { rows: rows.slice(0, cap), truncated };
}

/**
 * Run one signal, turning a read failure into `unavailable` rather than a zero.
 * Every signal is independent: one collection being unreadable must not blank
 * the whole card.
 */
async function signal(
    name: string,
    read: () => Promise<{ events: WatchdogEvent[]; truncated: boolean }>
): Promise<{ signal: WatchdogSignal; events: WatchdogEvent[] }> {
    try {
        const { events, truncated } = await read();
        return { signal: { count: events.length, truncated }, events };
    } catch (e) {
        console.error(`[watchdog] ${name} read failed:`, e);
        return {
            signal: { truncated: false, unavailable: e instanceof Error ? e.message : "read failed" },
            events: [],
        };
    }
}

function money(amount: unknown): string {
    const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
    return `$${n.toFixed(2)}`;
}

export async function computeWatchdogReport(
    db: admin.firestore.Firestore,
    nowMs: number,
    windowHours: number = WATCHDOG_WINDOW_HOURS
): Promise<WatchdogReport> {
    const sinceMs = nowMs - windowHours * 60 * 60 * 1000;
    const cap = WATCHDOG_SIGNAL_CAP;

    // Summed inside the charges reader, from the same rows the events come from,
    // so the figure can never disagree with the list under it. Stays undefined
    // if that read throws — see the `revenue` assembly below.
    let chargeTotal: number | undefined;

    const [users, pools, charges, errors] = await Promise.all([
        signal("users", async () => {
            const { rows, truncated } = await windowDocs(db.collection("users"), "createdAt", sinceMs, nowMs, cap);
            return {
                truncated,
                events: rows.map((r) => ({
                    kind: "USER_SIGNED_UP" as const,
                    at: r.at,
                    label: `${r.data.name || r.data.email || r.id} signed up${r.data.registrationMethod ? ` (${r.data.registrationMethod})` : ""}`,
                })),
            };
        }),

        signal("pools", async () => {
            const { rows, truncated } = await windowDocs(db.collection("pools"), "createdAt", sinceMs, nowMs, cap);
            // Sim-harness and hand-labelled test pools are noise. PRESEASON IS NOT
            // EXCLUDED, deliberately: shared/testPool.ts's full isTestPool() counts
            // NFL seasonType 1 as a test pool for STATS purposes, but preseason is
            // exactly the 2026-08-06 pilot this card exists to watch. Same carve-out,
            // and same reasoning, as the Member Record backfill (PLAN-PAYMENT-TRUTH
            // P4) which uses isExplicitlyMarkedTestPool for this reason.
            const real = rows.filter((r) => !isSimPool(r.data, r.id) && !isExplicitlyMarkedTestPool(r.data));
            return {
                truncated,
                events: real.map((r) => ({
                    kind: "POOL_CREATED" as const,
                    at: r.at,
                    label: `${r.data.name || "(unnamed pool)"} created${r.data.type ? ` — ${r.data.type}` : ""}`,
                    href: `/pool/${r.id}`,
                })),
            };
        }),

        signal("charges", async () => {
            const { rows, truncated } = await windowDocs(db.collection("billingCharges"), "at", sinceMs, nowMs, cap);
            chargeTotal = rows.reduce(
                (sum, r) => sum + (typeof r.data.amount === "number" && Number.isFinite(r.data.amount) ? r.data.amount : 0),
                0
            );
            return {
                truncated,
                events: rows.map((r) => ({
                    kind: "CHARGE" as const,
                    at: r.at,
                    label: `${money(r.data.amount)} charged — ${r.data.kind ?? "pool"}${r.data.couponCode ? ` (coupon ${r.data.couponCode})` : ""}`,
                    ...(typeof r.data.poolId === "string" && r.data.poolId ? { href: `/pool/${r.data.poolId}` } : {}),
                })),
            };
        }),

        signal("clientErrors", async () => {
            // `timestamp` is the server-stamped numeric field logClientError writes;
            // its `createdAt` is a serverTimestamp on the same doc. Either works —
            // windowDocs handles both types — and `timestamp` is the one every row has.
            const { rows, truncated } = await windowDocs(db.collection("system_logs"), "timestamp", sinceMs, nowMs, cap);
            // system_logs is NOT a client-error collection. scoreUpdates.ts writes
            // routine SYNC_GAME_STATUS progress rows into it (five sites) with a
            // serverTimestamp and no `source`, so counting every row here would
            // light the Client Errors tile up during a perfectly healthy score
            // sync — and push real client errors out past the cap while doing it.
            // logClientError is the only writer that stamps source: "client".
            const clientRows = rows.filter((r) => r.data.source === "client");
            return {
                truncated,
                events: clientRows.map((r) => ({
                    kind: "CLIENT_ERROR" as const,
                    at: r.at,
                    label: `${r.data.severity ?? "medium"}: ${r.data.message ?? "(no message)"}`,
                })),
            };
        }),
    ]);

    return {
        at: nowMs,
        sinceMs,
        windowHours,
        signals: {
            newUsers: users.signal,
            newPools: pools.signal,
            charges: {
                ...charges.signal,
                // Absent when the read failed — the card must not print "$0 revenue"
                // over an unreadable ledger.
                ...(chargeTotal === undefined ? {} : { revenue: chargeTotal }),
            },
            clientErrors: errors.signal,
        },
        events: [...users.events, ...pools.events, ...charges.events, ...errors.events].sort(
            (a, b) => b.at - a.at
        ),
    };
}

export const getProdWatchdog = validated(
    {
        schema: getProdWatchdogSchema,
        label: "getProdWatchdog",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
    },
    async () => {
        return computeWatchdogReport(admin.firestore(), Date.now());
    }
);
