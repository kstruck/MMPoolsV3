import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { withHeartbeat, configReadFailedVerdict } from "./lib/heartbeat";

import { sendEmail } from "./reminders";
import { renderEmailHtml } from "./emailStyles";
import { getSquareEmails } from "./squarePrivate";
import { isAdminCloseTransition, ADMIN_CLOSE } from "./lib/lifecycle";
import { validated } from "./lib/validated";
import { recalculateGlobalStatsSchema } from "./schemas/noInputAdmin";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";
import { computeRosterSummary, type DuesInputs, type MemberRecord } from "./shared/memberRecord";
import { isTestPool } from "./shared/testPool";

/**
 * Dues actually COLLECTED, read from a pool's Member Records — the money in the pot.
 *
 * NFL season pools keep payment truth in `pools/{id}/members/{uid}.paidStatus`,
 * NOT in entry documents: entries are seeded `UNPAID` at first pick submission and
 * `setPaidStatus` never touches them (PLAN-STATS-INTEGRITY §2.8). Reusing the
 * entry-fee branch above would therefore compute ZERO for a fully paid pool —
 * plausible, confident and wrong, which is the specific failure §2.8 exists to
 * stop.
 *
 * Reuses `computeRosterSummary` rather than re-deriving the arithmetic. It is the
 * same helper `lib/rosterSummary.ts` already uses for the commissioner-facing
 * roster, and it carries three rules this must not get wrong on its own: a member
 * counts only when `paidStatus === 'PAID'`; the per-record `feeOwed` stamp wins
 * over the pool fee, so a seeded owner who never played owes 0 (ADR 0005); and
 * `rebuyPaid` is added on top.
 *
 * ⚠️ KNOWN GAP, inherited not introduced (codex r2, verified): NOTHING WRITES
 * `rebuyPaid`. `executeSurvivorRebuyInternal` increments `rebuyOwed` only,
 * `setPaidStatus` touches only the base `paidStatus`, and no other writer exists
 * in `functions/src` or `src/`. So Survivor rebuy money contributes ZERO to the
 * pot today — an UNDER-count, not an over-count. Left alone here on purpose:
 * `memberDues` is shared with the commissioner roster, so redefining "collected"
 * moves a second money surface, and the fix is a product decision. Pinned by a
 * test in poolPot.emulator.test.ts so it is a recorded decision.
 *
 * ⚠️ SECOND KNOWN GAP, also inherited (codex r3, verified): NFL payment state has
 * TWO commissioner controls that write to DIFFERENT PLACES.
 *   - `NFLManagerView` roster toggle -> `dbService.setPaidStatus` -> the MEMBER
 *     RECORD. This is the authoritative path, and it is what this function reads.
 *   - `NFLManagerBentoDashboard` "detailed payment" panel ->
 *     `updateEntryPayment` -> `pools/{id}/entries/{entryId}` ONLY.
 * A commissioner who marks a member paid through the SECOND control leaves the
 * Member Record UNPAID, and this pot under-reports that member's dues.
 *
 * Not fixed here because the fix is to unify the write path — either make
 * `updateEntryPayment` also reconcile the Member Record, or point that panel at
 * `setPaidStatus` — and that is a change to a shared money callable that BRACKET
 * pools also use, where entries genuinely ARE the truth. Its own PR, with its own
 * review. Reading entries here instead would be worse: §2.8 is the finding that
 * NFL entry docs keep `UNPAID` forever, so that source is wrong in the common
 * case and this one is wrong only when the second control is used.
 */
const memberRecordsPot = async (
    db: admin.firestore.Firestore,
    poolId: string,
    inputs: DuesInputs,
): Promise<number> => {
    const membersSnap = await db.collection('pools').doc(poolId).collection('members').get();
    const members = membersSnap.docs.map((d) => d.data() as MemberRecord);
    return computeRosterSummary(members, inputs).duesCollected;
};

/**
 * PROPS pots come from `propCards`, NOT from Member Records.
 *
 * Verified rather than assumed, because getting this backwards is the same class
 * of error as §2.8: `propBets.ts` adds one auto-id doc per card under
 * `pools/{id}/propCards` and never writes a Member Record for the buyer —
 * `ensureMemberRecord` is called only from `nflPools.ts` and `lib/poolCreation.ts`
 * (the owner, at create). A Member-Records pot would therefore report ~0 for every
 * real Props pool.
 *
 * EVERY card counts, not only cards flagged `isPaid`. That asymmetry with the
 * BRACKET and NFL branches is deliberate and was nearly a shipped defect — the
 * first version of this filtered on `isPaid === true`, and codex found that
 * NOTHING WRITES THAT FIELD. Verified before accepting: `purchasePropCard`
 * creates cards without it; no UI sets it (`AdminPanel.tsx` only READS it, for a
 * paid/owed split that is therefore permanently $0/$100%); and
 * `firestore.rules` `match /propCards/{userId}` allows `write: if isSuperAdmin()`,
 * so a commissioner could not set it even if a control existed. A paid-only props
 * pot would have published ZERO for every real Props pool — the same confidently
 * wrong number this whole change exists to remove, just arrived at differently.
 *
 * Card count is also what the product already calls the props pot everywhere it
 * is displayed: `PoolStatistics.tsx` (`propCards.length * props.cost`) and the
 * SuperAdmin Overview. And it matches the SQUARES branch directly above, which
 * has always counted squares SOLD rather than squares paid — squares and prop
 * cards are both per-unit purchases, so that is the closer analogue.
 *
 * FOLLOW-UP OWED, not fixed here: Props has no payment-state path at all. NFL got
 * one (Member Records + `setPaidStatus`); Props never did. Building one is a
 * feature with a UI, a callable and a rules change — its own PR.
 */
const propsPot = async (
    db: admin.firestore.Firestore,
    poolId: string,
    pool: any,
): Promise<number> => {
    const cost = Number(pool.props?.cost) || 0;
    if (cost <= 0) return 0;
    const cardsSnap = await db.collection('pools').doc(poolId).collection('propCards').get();
    return cardsSnap.size * cost;
};

/**
 * Total pot and charity for one pool.
 *
 * Exported for unit tests. Before this change, NFL_PICKEM / NFL_SURVIVOR /
 * NFL_MARGIN and PROPS all fell through to the squares branch — none of them has
 * a `squares` array or a `costPerSquare`, so every one of them evaluated to a pot
 * of exactly ZERO (PLAN-STATS-INTEGRITY §2.5 and codex R3 finding (j)). The
 * `stats/global` document is world-readable, so that was a published zero, and
 * pressing Recalculate would have re-published it.
 */
export const calculatePoolPot = async (db: admin.firestore.Firestore, poolId: string, pool: any): Promise<{ prizePot: number; charityAmount: number }> => {
    let grossPot = 0;

    if (pool.type === 'BRACKET') {
        const entryFee = pool.settings?.entryFee || 0;
        if (entryFee > 0) {
            const entriesSnap = await db.collection('pools').doc(poolId).collection('entries').get();
            const paidEntriesCount = entriesSnap.docs.filter(doc => {
                const data = doc.data();
                return data.paidStatus === 'PAID' || data.paid === true;
            }).length;
            grossPot = paidEntriesCount * entryFee;
        }
    } else if (pool.type === 'NFL_PLAYOFFS') {
        // A FOURTH zero-pot pool type, and the one nobody had counted: this
        // branch used to read a `playoff_entries` SUBCOLLECTION that does not
        // exist. `playoff_entries` appears exactly ONCE in the whole repository —
        // in the line this replaces. Nothing has ever written it.
        //
        // Playoff entries live in the pool document's `entries` MAP, and the paid
        // flag is `entries.{id}.paid`, set by playoffPools.ts's `togglePaid`
        // action. `migrations/backfillMemberRecords.ts` says so in as many words:
        // "Playoff entries live on the pool doc (pool.entries map)".
        //
        // So every real NFL_PLAYOFFS pool has been contributing $0 to the
        // world-readable prize total for as long as this function has existed —
        // and Kevin HAS real playoff pools (his Q4 answer is about exactly them).
        // Found by codex r1 on PR D, which noticed that switching the Overview to
        // the server aggregate would have made this long-standing zero VISIBLE.
        const entryFee = pool.settings?.entryFee || 0;
        if (entryFee > 0) {
            const entries = Object.values((pool.entries || {}) as Record<string, any>);
            const paidEntriesCount = entries.filter((e: any) => e?.paid === true || e?.paidStatus === 'PAID').length;
            grossPot = paidEntriesCount * entryFee;
        }
    } else if ((NFL_SEASON_TYPES as readonly string[]).includes(String(pool.type ?? ''))) {
        grossPot = await memberRecordsPot(db, poolId, {
            poolType: pool.type,
            entryFee: pool.settings?.entryFee ?? 0,
        });
    } else if (pool.type === 'PROPS') {
        grossPot = await propsPot(db, poolId, pool);
    } else {
        let squaresSold = 0;
        if (pool.squares && Array.isArray(pool.squares)) {
            squaresSold = pool.squares.filter((s: any) => s.owner).length;
        }
        grossPot = squaresSold * (pool.costPerSquare || 0);
    }

    // Charity
    let charityAmount = 0;
    const charityConfig = pool.charity || pool.settings?.charity;
    if (charityConfig && charityConfig.enabled && charityConfig.percentage) {
        charityAmount = grossPot * (charityConfig.percentage / 100);
    }

    // Prize Pot defaults to Gross - Charity
    const prizePot = grossPot - charityAmount;

    return { prizePot: Math.floor(prizePot), charityAmount: Math.floor(charityAmount) };
};

// Trigger: When a pool is LOCKED, add its pot to the global "Total Prizes"
export const onPoolLocked = onDocumentUpdated("pools/{poolId}", async (event) => {
    if (!event.data) return;
    try {
        const before = event.data.before.data();
        const after = event.data.after.data();

        // T2: an admin close dual-writes isLocked/isFinal/scores.gameStatus to make
        // the pool leave open/live lists — but must NOT fire member emails or stat
        // increments. Skip the whole side-effect path on that transition.
        if (isAdminCloseTransition(before, after)) return;

        // Trigger only when transitioning from unlocked -> locked
        if (!before.isLocked && after.isLocked) {
            const db = admin.firestore();

            // Test pools add nothing to the world-readable money totals
            // (PLAN-STATS-INTEGRITY §8.1). Scoped to the STATS block only, not to
            // the whole trigger: the "Numbers Set" member emails below must still
            // fire for a sim pool, because the simulators exercise that path on
            // purpose. This is a stats change, not a behaviour change to the
            // harness — and a `return` here would have been the quiet way to make
            // it one.
            if (isTestPool(after, event.params.poolId)) {
                console.log(`[Stats] pool ${event.params.poolId} is a Test Pool — contributing nothing to stats/global`);
            } else {
                const { prizePot, charityAmount } = await calculatePoolPot(db, event.params.poolId, after);

                if (prizePot > 0 || charityAmount > 0) {
                    await db.doc("stats/global").set({
                        totalPrizes: FieldValue.increment(prizePot),
                        totalDonated: FieldValue.increment(charityAmount),
                        lastUpdated: FieldValue.serverTimestamp()
                    }, { merge: true });

                    console.log(`[Stats] Added $${prizePot} prizes / $${charityAmount} charity for pool ${event.params.poolId}`);
                }
            }

            // --- EMAIL NOTIFICATION LOGIC ---
            // If email enabled, numbers generated, and NOT already sent
            if (after.emailNumbersGenerated && after.axisNumbers && !after.numbersEmailSent) {
                console.log(`[onPoolLocked] Triggering 'Numbers Set' emails for pool ${event.params.poolId}`);

                // Mark as sent immediately to prevent re-entry (idempotency)
                await event.data.after.ref.update({ numbersEmailSent: true });

                const homeNums = after.axisNumbers.home.join(", ");
                const awayNums = after.axisNumbers.away.join(", ");
                const subject = `Numbers Generated: ${after.name}`;

                const html = renderEmailHtml(
                    "The Numbers Are Set!",
                    `<p>The pool <strong>${after.name}</strong> has been locked and the numbers have been generated.</p>
                     <div style="background-color: #f1f5f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><strong>${after.homeTeam} (Row):</strong> ${homeNums}</p>
                        <p style="margin: 5px 0;"><strong>${after.awayTeam} (Col):</strong> ${awayNums}</p>
                     </div>
                     <p>Good luck!</p>`,
                    `https://www.marchmeleepools.com/pool/${event.params.poolId}`,
                    "View Your Squares"
                );

                // Collect unique emails from the restricted squarePrivate subcollection.
                const uniqueEmails = await getSquareEmails(db, event.params.poolId);
                console.log(`[onPoolLocked] Sending to ${uniqueEmails.length} recipients`);

                await Promise.all(uniqueEmails.map(email =>
                    sendEmail(db, email, subject, html, { poolId: event.params.poolId, reason: 'NUMBERS_GENERATED_TRIGGER' })
                ));
            }
        }
    } catch (e) {
        console.error("Error in onPoolLocked:", e);
    }
});

/**
 * The daily recompute's kill-switch, read from `system/config.statsRecompute`.
 *
 * Pure so the fail-safe defaults are unit-tested rather than discovered in
 * production — same shape and same reason as `readSweepGate` in nflFinalize.ts.
 *
 * BOTH defaults fail safe, and the second one matters more than it looks:
 * absent/garbage config means DISABLED, and `dryRun` defaults TRUE, so
 * `{ enabled: true }` on its own reports without writing. That makes arming a
 * two-step act — see what it would publish, then publish — on a job whose only
 * write target is a WORLD-READABLE money document.
 */
export function readStatsRecomputeGate(
    cfg: { enabled?: unknown; dryRun?: unknown } | undefined | null,
): { enabled: boolean; dryRun: boolean } {
    return { enabled: cfg?.enabled === true, dryRun: cfg?.dryRun !== false };
}

export interface StatsRecomputeResult {
    totalPrizes: number;
    totalDonated: number;
    /** Pools that contributed a figure. */
    pools: number;
    /** Pools whose pot threw — each one is money missing from the totals. */
    errors: number;
    /** Excluded by isTestPool. Reported so "the number dropped" is explainable. */
    testPoolsSkipped: number;
    /** True when nothing was written (the gate's report-only mode). */
    dryRun: boolean;
    /** Did this run actually overwrite stats/global? False on a dry run, and
     *  false when `errors > 0` — a partial total is never published. */
    published: boolean;
}

/**
 * Which pools count as having real volume? (PLAN-STATS-INTEGRITY §2.7, Kevin's Q5.)
 *
 * This used to be `isLocked == true` alone — and `nflPools.ts:100` creates NFL
 * season pools with **`isLocked: false`**. They lock per week at kickoff and
 * finalize by stamping `finalizedAt`; the pool-level flag is never flipped. So
 * the recompute has never once visited an NFL pool, which is the half of §2.5
 * that a pot fix alone does not reach: PR B taught `calculatePoolPot` to price
 * them, and this is what makes it get asked.
 *
 * Kevin's Q5 answer is `scoredThroughWeek >= 1` — a pool has real volume once it
 * has actually scored a week.
 *
 * TWO QUERIES, NOT AN `or` FILTER, and not a full-collection scan. Firestore
 * disjunctions across two fields want a composite index, and this repo has been
 * bitten twice by a query that needed an index nobody built: A5's feed snapshots
 * and `nflFinalizeSweepJob`, which threw FAILED_PRECONDITION every day for ten
 * days while looking fine. Both of these are SINGLE-FIELD predicates served by
 * the automatic index, so there is no index to forget. Deduped by document id
 * because a pool can satisfy both.
 *
 * `scoredThroughWeek >= 1` also excludes documents missing the field entirely —
 * Firestore inequality semantics — which is the behaviour wanted: squares and
 * bracket pools keep coming in through the `isLocked` half.
 */
async function selectPoolsForStats(db: admin.firestore.Firestore): Promise<Map<string, any>> {
    const [lockedSnap, scoredSnap] = await Promise.all([
        db.collection("pools").where("isLocked", "==", true).get(),
        db.collection("pools").where("scoredThroughWeek", ">=", 1).get(),
    ]);
    const pools = new Map<string, any>();
    for (const doc of [...lockedSnap.docs, ...scoredSnap.docs]) {
        const data = doc.data();
        if (!data) continue;
        // A CANCELED pool's contest is void, so its money is not prize volume.
        // This matters specifically because of the new scored-week half: cancelPool
        // leaves `scoredThroughWeek` and the paid Member Records intact, so a
        // canceled NFL pool that had already scored a week WOULD be admitted by
        // that query and counted on every run. The old isLocked-only selector
        // never reached it. Found by codex r1 on this PR.
        //
        // CANCELED only — not COMPLETED. A finished pool is exactly the case that
        // SHOULD count; excluding it would delete real history from the totals.
        if (data.status === 'CANCELED') continue;
        pools.set(doc.id, data);
    }
    return pools;
}

/**
 * Recompute `stats/global` from source and overwrite it.
 *
 * Extracted from the callable so the daily schedule below and the SuperAdmin
 * button run the SAME code — two implementations of a money rollup is how they
 * drift, and §2.4 is this repo's cautionary tale about exactly that.
 *
 * Idempotent by construction: it writes ABSOLUTE totals with `set`, never
 * `increment`. Re-running it is always safe, which is what makes a schedule the
 * right shape for it (and what the 2026-07-18 migration audit already noted as
 * the pattern the other backfills should copy).
 */
export async function recomputeGlobalStats(
    db: admin.firestore.Firestore,
    opts: { dryRun: boolean },
): Promise<StatsRecomputeResult> {
    const pools = await selectPoolsForStats(db);

    let totalAllTimePrizes = 0;
    let totalAllTimeCharity = 0;
    let count = 0;
    let errors = 0;

    let testPoolsSkipped = 0;

    for (const [poolId, pool] of pools) {
        try {
            // T2: admin-closed pools are locked for lifecycle reasons only — their
            // economics must never be recomputed with the squares-only pot logic.
            if (pool.closedVia === ADMIN_CLOSE) continue;

            // The same shared predicate the trigger and the SuperAdmin Overview
            // use (PLAN-STATS-INTEGRITY §8.1). One module, three callers — the
            // client/server split IS the reported bug (§2.4), so this must never
            // become a second copy of the rule.
            if (isTestPool(pool, poolId)) { testPoolsSkipped++; continue; }

            const { prizePot, charityAmount } = await calculatePoolPot(db, poolId, pool);
            if (!isNaN(prizePot)) {
                totalAllTimePrizes += prizePot;
                totalAllTimeCharity += charityAmount;
                count++;
            } else {
                // Counted as an error, not merely logged: a NaN pot is money
                // missing from the total in exactly the same way a thrown one is,
                // and it used to slip past the guard below silently (codex r1).
                console.warn(`Pool ${poolId} returned NaN pot`);
                errors++;
            }
        } catch (err) {
            console.error(`Error calculating pot for pool ${poolId}:`, err);
            errors++;
        }
    }

    // DO NOT PUBLISH A PARTIAL TOTAL. If any selected pool could not be priced —
    // a transient subcollection read failure is enough — the sum is an UNDERCOUNT,
    // and this write is an absolute overwrite of a world-readable money document.
    // Publishing it would replace a correct figure with a smaller wrong one and
    // leave it there until the next successful run. Keeping the previous value is
    // strictly better: stale beats wrong on a public number. The heartbeat already
    // reports `ok: false` in this case, so a persistent failure is visible rather
    // than silent. Found by codex r1 on this PR.
    const publish = !opts.dryRun && errors === 0;
    if (!opts.dryRun && errors > 0) {
        console.error(`[stats] refusing to publish: ${errors} pool(s) could not be priced — keeping the previous stats/global`);
    }

    if (publish) {
        // Overwrite the global stat with the recalculated total
        await db.doc("stats/global").set({
            totalPrizes: totalAllTimePrizes,
            totalRevenue: totalAllTimePrizes, // Backwards compat or Total Volume? Let's treat Revenue as Prizes for now or sum? Let's just track Prizes and Donated separately.
            totalDonated: totalAllTimeCharity,
            lastUpdated: FieldValue.serverTimestamp(),
            recalculatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    }

    return {
        totalPrizes: totalAllTimePrizes,
        totalDonated: totalAllTimeCharity,
        pools: count,
        errors,
        testPoolsSkipped,
        dryRun: opts.dryRun,
        published: publish,
    };
}

// Callable: Manually recalculate global stats from ALL existing locked/finished pools
export const recalculateGlobalStats = validated(
    {
        schema: recalculateGlobalStatsSchema,
        label: "recalculateGlobalStats",
        role: "SUPER_ADMIN",
        appCheck: "monitor",
        // Preserved verbatim, INCLUDING the explicit cors allowlist — that list
        // is why this callable could report permission failures as a soft return
        // instead of a throw (see below), so dropping it would change behavior
        // twice over.
        options: {
            timeoutSeconds: 300,
            memory: "512MiB",
            cors: ["https://www.marchmeleepools.com", "https://gridiron-gamble-uzuqo.firebaseapp.com", "https://gridiron-gamble-uzuqo.web.app"],
        },
    },
    // BEHAVIOR CHANGE, deliberate and signed off: the SUPER_ADMIN check used to
    // `return { success: false, message: ... }` rather than throw, with a comment
    // that this avoided CORS masking the message. validated()'s role gate THROWS
    // permission-denied instead, so a non-admin caller now gets a rejected promise
    // where it previously got a resolved `{success:false}`. The FE reads
    // `result.data.success`; callers already wrap these in try/catch (see
    // AdminStatsDashboard.tsx:39, SuperAdmin.tsx:1642, OperationsPanel.tsx:61).
    // Kevin to smoke-test the SuperAdmin surface after deploy.
    async (_input, request) => {
    try {
        const r = await recomputeGlobalStats(admin.firestore(), { dryRun: false });
        return {
            success: true,
            message: `Recalculated from ${r.pools} pools. Skipped ${r.errors} errors.`,
            totalPrizes: r.totalPrizes,
            totalDonated: r.totalDonated
        };
    } catch (e: any) {
        console.error("Recalculate Error:", e);
        // Return structured error instead of throwing to avoid CORS masking the message
        return {
            success: false,
            message: `Recalc Failed: ${e.message}`,
            totalPrizes: 0
        };
    }
});

/**
 * The daily recompute (PLAN-STATS-INTEGRITY §8.3 step 2, second half).
 *
 * WHY A SCHEDULE AND NOT A TRIGGER. `onPoolLocked` is the only event-driven
 * writer of `stats/global`, and it fires on unlocked→locked — which NFL season
 * pools NEVER do (`nflPools.ts:100` creates them `isLocked: false`; they use
 * per-week kickoff locks and finalize by stamping `finalizedAt`). So fixing the
 * recompute's SELECTION alone makes the public numbers correct exactly once, and
 * then they rot the moment the next NFL pool scores a week — until somebody
 * remembers to press Recalculate. That is codex R3 finding (h).
 *
 * A trigger on the `scoredThroughWeek` 0→≥1 transition was the alternative. A
 * schedule wins here: it is idempotent by construction (the recompute writes
 * ABSOLUTE totals, never increments), it self-heals a missed or duplicated event
 * rather than double-counting one, and it needs no new trigger surface on the
 * pools collection — which is already carrying `onPoolLocked` plus the scorer's
 * writes. The cost is up to a day of staleness on a marketing figure. Cheap.
 *
 * ACCEPTED RACE, stated rather than hidden (codex r1 P2). The recompute's
 * ABSOLUTE write and `onPoolLocked`'s `FieldValue.increment` are not serialized:
 * a pool that locks mid-run is either missed (its increment gets overwritten) or
 * counted twice (the query saw it, the trigger lands after). That race already
 * existed for the manual Recalculate button — a nightly schedule widens the
 * exposure, it does not create it. Accepted because THIS IS THE RECONCILER: the
 * next run recomputes from source and overwrites, so any drift is bounded to one
 * day and self-corrects. The same reasoning is already on record in the
 * 2026-07-18 migration audit, which named periodic recalculation as the answer to
 * at-least-once trigger delivery. Serializing it properly needs a generation
 * counter or a transaction over a document two writers use differently — real
 * work, for a marketing figure that heals itself overnight.
 *
 * FAIL-SAFE OFF. Absent config means disabled, exactly like every other gated job
 * here, and `dryRun` defaults TRUE so arming it in two steps is the natural path:
 * `{ enabled: true }` first, read the heartbeat detail to see what it WOULD
 * publish, then `{ enabled: true, dryRun: false }`.
 *
 * 05:45 ET, i.e. after `nflFinalizeSweepJob` (04:30) and `webhookDurabilitySweep`
 * (05:15), so a night's finalizations are already reflected. Not 01:00-01:59 ET
 * (happens twice on fall-back) and not 02:00-02:59 ET (does not exist on
 * spring-forward).
 *
 * Comment kept ABOVE the onSchedule() call: the wrapping ratchet in
 * __tests__/heartbeat.test.ts scans a fixed character window from `onSchedule(`
 * for `withHeartbeat(`, and blanked comments still occupy their length.
 */
export const recomputeGlobalStatsDaily = onSchedule(
    { schedule: "45 5 * * *", timeZone: "America/New_York", timeoutSeconds: 540, memory: "512MiB" },
    withHeartbeat('recomputeGlobalStatsDaily', async () => {
        const db = admin.firestore();
        let cfg: { enabled?: boolean; dryRun?: boolean } | undefined;
        try {
            cfg = (await db.doc("system/config").get()).data()?.statsRecompute;
        } catch (e) {
            // Stays disabled, and says so honestly rather than looking healthy.
            return configReadFailedVerdict('recomputeGlobalStatsDaily', e);
        }
        const gate = readStatsRecomputeGate(cfg);
        if (!gate.enabled) return { detail: { enabled: false } };

        const { dryRun } = gate;
        const r = await recomputeGlobalStats(db, { dryRun });
        console.log(`[stats] daily recompute${dryRun ? ' (DRY RUN, nothing written)' : ''}: ` +
            `$${r.totalPrizes} prizes / $${r.totalDonated} charity from ${r.pools} pools, ${r.errors} errors`);
        // A run that could not price some pools is DEGRADED, not healthy: it just
        // overwrote a world-readable money document with an under-count.
        return { ok: r.errors === 0, detail: { ...r } };
    })
);
