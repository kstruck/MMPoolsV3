import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

import { sendEmail } from "./reminders";
import { renderEmailHtml } from "./emailStyles";
import { getSquareEmails } from "./squarePrivate";
import { isAdminCloseTransition, ADMIN_CLOSE } from "./lib/lifecycle";
import { validated } from "./lib/validated";
import { recalculateGlobalStatsSchema } from "./schemas/noInputAdmin";
import { NFL_SEASON_TYPES } from "./shared/poolTypes";
import { computeRosterSummary, type DuesInputs, type MemberRecord } from "./shared/memberRecord";

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
            const { prizePot, charityAmount } = await calculatePoolPot(db, event.params.poolId, after);

            if (prizePot > 0 || charityAmount > 0) {
                await db.doc("stats/global").set({
                    totalPrizes: FieldValue.increment(prizePot),
                    totalDonated: FieldValue.increment(charityAmount),
                    lastUpdated: FieldValue.serverTimestamp()
                }, { merge: true });

                console.log(`[Stats] Added $${prizePot} prizes / $${charityAmount} charity for pool ${event.params.poolId}`);
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

        const db = admin.firestore();

        // Fetch ALL pools that are locked (includes active and finished)
        const poolsSnap = await db.collection("pools")
            .where("isLocked", "==", true)
            .get();

        let totalAllTimePrizes = 0;
        let totalAllTimeCharity = 0;
        let count = 0;
        let errors = 0;

        for (const doc of poolsSnap.docs) {
            try {
                const pool = doc.data();
                if (!pool) continue; // Safety check
                // T2: admin-closed pools are locked for lifecycle reasons only — their
                // economics must never be recomputed with the squares-only pot logic.
                if (pool.closedVia === ADMIN_CLOSE) continue;

                const { prizePot, charityAmount } = await calculatePoolPot(db, doc.id, pool);
                if (!isNaN(prizePot)) {
                    totalAllTimePrizes += prizePot;
                    totalAllTimeCharity += charityAmount;
                    count++;
                } else {
                    console.warn(`Pool ${doc.id} returned NaN pot`);
                }
            } catch (err) {
                console.error(`Error calculating pot for pool ${doc.id}:`, err);
                errors++;
            }
        }

        // Overwrite the global stat with the recalculated total
        await db.doc("stats/global").set({
            totalPrizes: totalAllTimePrizes,
            totalRevenue: totalAllTimePrizes, // Backwards compat or Total Volume? Let's treat Revenue as Prizes for now or sum? Let's just track Prizes and Donated separately.
            totalDonated: totalAllTimeCharity,
            lastUpdated: FieldValue.serverTimestamp(),
            recalculatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return {
            success: true,
            message: `Recalculated from ${count} pools. Skipped ${errors} errors.`,
            totalPrizes: totalAllTimePrizes,
            totalDonated: totalAllTimeCharity
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
