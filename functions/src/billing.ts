
import * as functions from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { Pool, PoolBilling, Coupon } from "./types";
import {
    BillingConfigSchema,
    BillingConfig,
    DEFAULT_GRACE_PERIOD_DAYS,
    DEFAULT_TRIAL_DAYS,
    DEFAULT_FORMAT_TIER_MAP,
} from "./shared/schemas/billingConfig";
import {
    poolQuoteInputSchema,
    type CouponQuoteState,
    type PoolQuote,
} from "./shared/schemas/quote";
import { computeQuote, discountLabel, type QuoteCoupon } from "./lib/quoteEngine";
import { validateCouponRules } from "./lib/couponReservation";
import { HttpsError } from "firebase-functions/v2/https";
import { validated } from "./lib/validated";
import { redeemCouponSchema } from "./schemas/billingCheckout";
import { validateBillingAccessSchema } from "./schemas/billing";
import { withHeartbeat } from "./lib/heartbeat";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { renderEmailHtml, escapeHtml, BASE_URL } from "./emailStyles";
import { sendEmail } from "./reminders";

// Fail-open billing config for readers (never stall the buy-flow on a malformed
// doc). Mirrors the enforceBillingStatus pattern: parse settings/billing_config,
// fall back to schema defaults on missing/invalid. Returns the fully-defaulted
// BillingConfig (trialDays/formatTierMap/packagesList materialized).
export async function loadBillingConfig(
    dbRef: admin.firestore.Firestore
): Promise<BillingConfig> {
    const snap = await dbRef.collection("settings").doc("billing_config").get();
    const parsed = BillingConfigSchema.safeParse(snap.data() ?? {});
    if (parsed.success) return parsed.data;
    // Malformed/partial doc → defaults. A missing doc parses successfully only
    // if all required fields have defaults; pricing/features do not, so build a
    // minimal safe fallback here.
    return BillingConfigSchema.parse({
        freePlayerThreshold: 10,
        gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
        trialDays: DEFAULT_TRIAL_DAYS,
        pricing: { season: [], bracket: [], squares: [], props: [] },
        formatTierMap: DEFAULT_FORMAT_TIER_MAP,
        features: {
            aiCommissioner: { isPremium: true, addonPrice: 0 },
            whatIfSimulator: { isPremium: true, addonPrice: 0 },
            customBranding: { isPremium: true, addonPrice: 0 },
        },
    });
}

const db = admin.firestore();

/**
 * Resolves the commissioner's email for a pool: prefers the explicit
 * contactEmail, then falls back to users/{ownerId || managerUid}.email.
 * Returns null (never throws) when no email can be found.
 */
async function resolveCommissionerEmail(poolData: FirebaseFirestore.DocumentData): Promise<string | null> {
    if (poolData.contactEmail) return poolData.contactEmail as string;
    const commissionerUid = poolData.ownerId || poolData.managerUid;
    if (!commissionerUid) return null;
    try {
        const userDoc = await db.collection("users").doc(commissionerUid).get();
        return userDoc.exists ? (userDoc.data()?.email ?? null) : null;
    } catch {
        return null;
    }
}

// =============================================================================
// 1. enforceBillingStatus — Daily Scheduled Job
//    Transitions expired trials → grace_period, expired grace → locked
// =============================================================================

export const enforceBillingStatus = functions.scheduler.onSchedule("every day 03:00", withHeartbeat('enforceBillingStatus', async () => {
    const now = Date.now();
    let failedTransitions = 0;
    console.log(`[BillingEnforce] Starting billing enforcement at ${new Date(now).toISOString()}`);

    // --- Fetch global billing config for grace/trial durations ---
    // settings/billing_config is the single authority (ADR-0001); this read
    // previously targeted config/billing_config — a split-brain bug that made
    // the scheduler ignore the admin-managed doc. Only the fields the
    // scheduler consumes are validated (.pick keeps the parse immune to
    // legacy-shaped fields elsewhere in the doc, e.g. old packagesList items),
    // and validation failure fails OPEN to defaults — a malformed config must
    // never stall billing enforcement.
    let gracePeriodDays = DEFAULT_GRACE_PERIOD_DAYS;
    let trialDays = DEFAULT_TRIAL_DAYS;
    const configDoc = await db.collection("settings").doc("billing_config").get();
    if (!configDoc.exists) {
        console.warn(`[BillingEnforce] settings/billing_config missing; using defaults (gracePeriodDays=${gracePeriodDays}, trialDays=${trialDays})`);
    } else {
        const parsed = BillingConfigSchema
            .pick({ gracePeriodDays: true, trialDays: true })
            .safeParse(configDoc.data());
        if (parsed.success) {
            gracePeriodDays = parsed.data.gracePeriodDays;
            trialDays = parsed.data.trialDays;
        } else {
            const summary = parsed.error.issues
                .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
                .join("; ");
            console.warn(`[BillingEnforce] settings/billing_config failed schema validation; using defaults (gracePeriodDays=${gracePeriodDays}, trialDays=${trialDays}). Issues: ${summary}`);
        }
    }
    console.log(`[BillingEnforce] Using gracePeriodDays=${gracePeriodDays}, trialDays=${trialDays}`);
    const gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;

    let trialToGraceCount = 0;
    let graceToLockedCount = 0;

    // --- Phase 1: Trial → Grace Period ---
    const expiredTrials = await db.collection("pools")
        .where("billing.status", "==", "trial")
        .where("billing.trialEndsAt", "<", now)
        .get();

    for (const doc of expiredTrials.docs) {
        try {
            const poolData = doc.data();
            // Dedupe guard: only proceed if the status is actually transitioning.
            // The query above only matches status == "trial", so after this write
            // the pool can never re-match on a later scheduler tick — the status
            // change itself is the send-once mechanism.
            if (poolData.billing?.status !== "trial") continue;

            const poolRef = db.collection("pools").doc(doc.id);
            await poolRef.update({
                "billing.status": "grace_period" as PoolBilling["status"],
                "billing.gracePeriodEndsAt": now + gracePeriodMs,
            });
            trialToGraceCount++;
            console.log(`[BillingEnforce] Pool ${doc.id}: trial → grace_period (ends ${new Date(now + gracePeriodMs).toISOString()})`);

            // --- Commissioner warning email (transactional; sent only on transition) ---
            try {
                const commissionerEmail = await resolveCommissionerEmail(poolData);
                if (commissionerEmail) {
                    const poolName = poolData.name || "Your pool";
                    const poolUrl = `${BASE_URL}/pool/${doc.id}`;
                    const subject = `Action needed: ${poolName} pool locks in ${gracePeriodDays} day${gracePeriodDays !== 1 ? "s" : ""}`;
                    const body = `
                        <p>Hi there,</p>
                        <p>The free trial for your pool <strong>${escapeHtml(poolName)}</strong> has ended. Your pool is now in a grace period.</p>
                        <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 16px; margin: 20px 0; color: #92400e; font-family: sans-serif;">
                            <p style="margin: 0; font-weight: bold; font-size: 16px;">⏳ ${gracePeriodDays} day${gracePeriodDays !== 1 ? "s" : ""} remaining before your pool locks</p>
                            <p style="margin: 4px 0 0 0; font-size: 13px;">Complete payment before the grace period ends to keep the pool open for everyone. Your members' picks and standings are safe either way.</p>
                        </div>
                        <p>Complete payment now to avoid any interruption for your participants.</p>
                    `;
                    const html = renderEmailHtml("Grace Period Started", body, poolUrl, "Complete Payment");
                    await sendEmail(db, commissionerEmail, subject, html, { transactional: true, poolId: doc.id, reason: "billing_grace_period" });
                    console.log(`[BillingEnforce] Grace-period warning email queued for pool ${doc.id} to ${commissionerEmail}`);
                } else {
                    console.log(`[BillingEnforce] No commissioner email found for pool ${doc.id}; skipping grace-period email`);
                }
            } catch (emailErr) {
                console.error(`[BillingEnforce] Failed to send grace-period email for pool ${doc.id}:`, emailErr);
            }
        } catch (err) {
            failedTransitions++;
            console.error(`[BillingEnforce] Error transitioning pool ${doc.id} to grace_period:`, err);
        }
    }

    // --- Phase 2: Grace Period → Locked ---
    const expiredGrace = await db.collection("pools")
        .where("billing.status", "==", "grace_period")
        .where("billing.gracePeriodEndsAt", "<", now)
        .get();

    for (const doc of expiredGrace.docs) {
        try {
            const poolData = doc.data();
            // Dedupe guard: same transition-only mechanism as above — the query
            // only matches status == "grace_period", so the write below prevents
            // this pool from matching (and re-emailing) on future ticks.
            if (poolData.billing?.status !== "grace_period") continue;

            const poolRef = db.collection("pools").doc(doc.id);
            await poolRef.update({
                "billing.status": "locked" as PoolBilling["status"],
            });
            graceToLockedCount++;
            console.log(`[BillingEnforce] Pool ${doc.id}: grace_period → locked`);

            // --- Commissioner lock notification (transactional; sent only on transition) ---
            try {
                const commissionerEmail = await resolveCommissionerEmail(poolData);
                if (commissionerEmail) {
                    const poolName = poolData.name || "Your pool";
                    const poolUrl = `${BASE_URL}/pool/${doc.id}`;
                    const subject = `${poolName} is locked — complete payment to restore access`;
                    const body = `
                        <p>Hi there,</p>
                        <p>The grace period for your pool <strong>${escapeHtml(poolName)}</strong> has ended and the pool is now locked.</p>
                        <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 16px; margin: 20px 0; color: #991b1b; font-family: sans-serif;">
                            <p style="margin: 0; font-weight: bold; font-size: 16px;">🔒 Pool Locked</p>
                            <p style="margin: 4px 0 0 0; font-size: 13px;">Participants can still view standings and picks, but the pool is paused until payment is completed. Nothing is lost — everything unlocks automatically once you pay.</p>
                        </div>
                        <p>Complete payment to instantly restore full access for your entire pool.</p>
                    `;
                    const html = renderEmailHtml("Pool Locked", body, poolUrl, "Complete Payment");
                    await sendEmail(db, commissionerEmail, subject, html, { transactional: true, poolId: doc.id, reason: "billing_locked" });
                    console.log(`[BillingEnforce] Locked notification email queued for pool ${doc.id} to ${commissionerEmail}`);
                } else {
                    console.log(`[BillingEnforce] No commissioner email found for pool ${doc.id}; skipping locked email`);
                }
            } catch (emailErr) {
                console.error(`[BillingEnforce] Failed to send locked email for pool ${doc.id}:`, emailErr);
            }
        } catch (err) {
            failedTransitions++;
            console.error(`[BillingEnforce] Error transitioning pool ${doc.id} to locked:`, err);
        }
    }

    console.log(`[BillingEnforce] Complete. Transitions: ${trialToGraceCount} trial→grace, ${graceToLockedCount} grace→locked`);

    // Per-pool catches keep one bad pool from stopping enforcement, which meant
    // a run where every transition failed still stamped a healthy beat. This is
    // a MONEY path — a pool that should have locked and silently did not is
    // free access nobody is told about.
    return failedTransitions > 0
        ? {
            ok: false,
            error: `${failedTransitions} billing transition(s) failed`,
            detail: { trialToGrace: trialToGraceCount, graceToLocked: graceToLockedCount, failedTransitions },
        }
        : { detail: { trialToGrace: trialToGraceCount, graceToLocked: graceToLockedCount } };
}));

// =============================================================================
// 2. validateBillingAccess — Callable Function
//    Checks if a pool is accessible and optionally if a premium feature is unlocked
// =============================================================================

// Deny-by-default paid-feature gate (PLAN Phase 4 #6c) — pure logic lives in
// ./lib/billingAccess so it is importable/testable without Firebase init.
export { checkBillingAccess, PAID_FEATURE_KEYS } from "./lib/billingAccess";
import { checkBillingAccess } from "./lib/billingAccess";

export const validateBillingAccess = validated(
    { schema: validateBillingAccessSchema, label: "validateBillingAccess", auth: "public", appCheck: "monitor" },
    async ({ poolId, feature }) => {
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    const pool = poolDoc.data() as Pool;
    const result = checkBillingAccess(pool.billing, feature);

    if (!result.allowed) {
        // validateBillingAccess is traditionally expected to return { allowed: false, reason } rather than throw
        return result;
    }

    return { allowed: true };
    },
);

// =============================================================================
// 3. redeemCoupon — Callable Function
//    Atomically validates and redeems a coupon code within a Firestore transaction
// =============================================================================

export const redeemCoupon = validated(
    // Pool-owner check stays below (needs the pool doc).
    { schema: redeemCouponSchema, label: "redeemCoupon", appCheck: "monitor", options: { cors: true } },
    async (input, request) => {
    const userId = request.auth!.uid;
    const { couponCode, poolId } = input;

    // --- Fetch the pool to validate pool type ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const pool = poolDoc.data() as Pool;

    if (pool.ownerId !== userId) {
        throw new HttpsError("permission-denied", "You must be the pool owner to redeem a coupon.");
    }

    // --- Transaction: Validate & Redeem ---
    const result = await db.runTransaction(async (transaction) => {
        // Find coupon by code
        const couponQuery = await transaction.get(
            db.collection("coupons").where("code", "==", couponCode).limit(1)
        );

        if (couponQuery.empty) {
            throw new HttpsError("not-found", "Coupon code not found.");
        }

        const couponDoc = couponQuery.docs[0];
        const coupon = { id: couponDoc.id, ...couponDoc.data() } as Coupon;
        const now = Date.now();

        // --- Validation Checks ---

        // 1. Active?
        if (!coupon.isActive) {
            throw new HttpsError("failed-precondition", "This coupon is no longer active.");
        }

        // 2. Expired?
        if (coupon.expiresAt && coupon.expiresAt < now) {
            throw new HttpsError("failed-precondition", "This coupon has expired.");
        }

        // 3. Max uses?
        if (coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
            throw new HttpsError("resource-exhausted", "This coupon has reached its maximum number of uses.");
        }

        // 4. Per-user limit?
        if (coupon.perUserLimit !== undefined && coupon.usageLog) {
            const userUsageCount = coupon.usageLog.filter(entry => entry.userId === userId).length;
            if (userUsageCount >= coupon.perUserLimit) {
                throw new HttpsError("resource-exhausted", "You have already used this coupon the maximum number of times.");
            }
        }

        // 5. Allowed pool types?
        if (coupon.allowedPoolTypes && coupon.allowedPoolTypes.length > 0) {
            const poolType = pool.type;
            if (!coupon.allowedPoolTypes.includes(poolType as typeof coupon.allowedPoolTypes[number])) {
                throw new HttpsError("failed-precondition", `This coupon is not valid for ${poolType} pools.`);
            }
        }

        // --- Apply Redemption ---
        const usageEntry = { userId, poolId, usedAt: now };

        transaction.update(couponDoc.ref, {
            usesCount: FieldValue.increment(1),
            usageLog: FieldValue.arrayUnion(usageEntry),
        });

        return {
            valid: true,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
        };
    });

    return result;
    },
);

// =============================================================================
// 4. onPoolParticipantChange — Firestore Trigger
//    Sends alerts to pool managers when they hit 8 or 10 entries on the Free Plan
// =============================================================================

export const onPoolParticipantChange = onDocumentWritten("pools/{poolId}", async (event) => {
    const after = event.data?.after.data();
    if (!after) return; // Deleted

    const poolId = event.params.poolId;
    const db = admin.firestore();

    const billingStatus = after.billing?.status ?? 'free';
    if (billingStatus !== 'free') return; // Only notify for Free Plan pools

    // Count participants based on pool type
    let count = 0;
    if (after.type === 'NFL_PLAYOFFS' || after.type === 'playoff') {
        count = Object.keys(after.entries || {}).length;
    } else if (after.type === 'NFL_PICKEM' || after.type === 'NFL_SURVIVOR' || after.type === 'NFL_MARGIN') {
        count = (after.participantIds || []).length;
    } else {
        count = after.entryCount || 0;
    }

    const notified8 = after.billing?.notified8 === true;
    const notified10 = after.billing?.notified10 === true;

    // Check if we should notify
    const shouldNotify8 = count >= 8 && !notified8;
    const shouldNotify10 = count >= 10 && !notified10;

    if (!shouldNotify8 && !shouldNotify10) return;

    // Find manager's email
    let managerEmail = after.contactEmail;
    if (!managerEmail && (after.ownerId || after.createdByUid || after.managerUid)) {
        const managerUid = after.ownerId || after.createdByUid || after.managerUid;
        const userDoc = await db.collection("users").doc(managerUid).get();
        if (userDoc.exists) {
            managerEmail = userDoc.data()?.email;
        }
    }

    if (!managerEmail) {
        console.warn(`[onPoolParticipantChange] Manager email not found for pool ${poolId}`);
        return;
    }

    const updates: any = {};

    if (shouldNotify10) {
        // Send 10 players lock email
        const subject = `🚫 Locked: Your pool "${after.name}" has reached the Free Plan limit!`;
        const body = `
            <p>Hi there,</p>
            <p>Your pool <strong>${after.name}</strong> has reached the maximum limit of <strong>10 participants</strong> allowed on the Free Plan.</p>
            
            <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 16px; margin: 20px 0; color: #991b1b; font-family: sans-serif;">
                <p style="margin: 0; font-weight: bold; font-size: 16px;">Participant Entries Locked 🚫</p>
                <p style="margin: 4px 0 0 0; font-size: 13px;">New participants are currently blocked from joining your pool until you upgrade to a premium plan.</p>
            </div>

            <p>To accept more players and unlock your pool instantly, please upgrade to a Premium plan.</p>
        `;
        const html = renderEmailHtml('Pool Entries Locked!', body, `${BASE_URL}/pricing`, 'Upgrade to Premium');

        await sendEmail(db, managerEmail, subject, html);

        updates["billing.notified10"] = true;
        updates["billing.notified8"] = true; // Mark 8 as true too
        console.log(`[onPoolParticipantChange] Limit reached (10/10) email queued for pool ${poolId} to manager ${managerEmail}`);
    } else if (shouldNotify8) {
        // Send 8 players approaching warning email
        const subject = `⚠️ Action Required: Your pool "${after.name}" is approaching the Free Plan limit!`;
        const body = `
            <p>Hi there,</p>
            <p>Your pool <strong>${after.name}</strong> currently has <strong>${count} participants</strong>, approaching the maximum limit of <strong>10 participants</strong> allowed on the Free Plan.</p>
            
            <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 16px; margin: 20px 0; color: #92400e; font-family: sans-serif;">
                <p style="margin: 0; font-weight: bold; font-size: 16px;">Approaching Limit: ${count}/10 Players ⚠️</p>
                <p style="margin: 4px 0 0 0; font-size: 13px;">Once your pool reaches 10 players, any new participants attempting to join will be blocked.</p>
            </div>

            <p>Upgrade to a Premium plan now to ensure your participants have a seamless, uninterrupted onboarding experience!</p>
        `;
        const html = renderEmailHtml('Approaching Free Limit!', body, `${BASE_URL}/pricing`, 'Upgrade to Premium');

        await sendEmail(db, managerEmail, subject, html);

        updates["billing.notified8"] = true;
        console.log(`[onPoolParticipantChange] Approaching limit (8/10) email queued for pool ${poolId} to manager ${managerEmail}`);
    }

    if (Object.keys(updates).length > 0) {
        await db.collection("pools").doc(poolId).update(updates);
    }
});

// =============================================================================
// 5. getPoolQuote — Callable Function (single price authority, PLAN Phase 2)
//    Input:  { poolType, estimatedPlayers, addons:{...}, couponCode? }
//    Output: itemized { basePrice, addonLines[], discount, total,
//                       couponState:{valid,reason?,discountLabel?}, freeTierEligible }
//    NO price math anywhere on the client — the client renders this verbatim.
// =============================================================================

/**
 * Loads a coupon by code and returns a sanitized quote state (never leaks other
 * users' usage). Validates every rule against current state incl. live
 * reservations (ADR-0002). Shared shape used by getPoolQuote and reused by
 * checkout. Returns undefined when no code was supplied.
 */
export async function resolveCouponForQuote(
    dbRef: admin.firestore.Firestore,
    couponCode: string | undefined,
    ctx: { userId: string; poolType: string; now: number }
): Promise<{ state: CouponQuoteState; coupon?: QuoteCoupon } | undefined> {
    if (!couponCode) return undefined;
    const code = couponCode.toUpperCase().trim();

    const snap = await dbRef
        .collection("coupons")
        .where("code", "==", code)
        .limit(1)
        .get();

    if (snap.empty) {
        return { state: { code, valid: false, reason: "Invalid coupon code." } };
    }

    const coupon = snap.docs[0].data() as Coupon;
    const result = validateCouponRules(
        {
            isActive: coupon.isActive,
            expiresAt: coupon.expiresAt,
            maxUses: coupon.maxUses,
            perUserLimit: coupon.perUserLimit,
            allowedPoolTypes: coupon.allowedPoolTypes as string[] | undefined,
            usageLog: coupon.usageLog as any,
        },
        ctx
    );

    if (!result.valid) {
        return { state: { code, valid: false, reason: result.reason } };
    }

    return {
        state: {
            code,
            valid: true,
            discountLabel: discountLabel(coupon.discountType, coupon.discountValue),
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
        },
        coupon: {
            code,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
        },
    };
}

export const getPoolQuote = validated(
    // poolQuoteInputSchema stays non-strict — shared cross-boundary contract
    // (functions/src/shared/schemas/quote.ts), not a SWEEP-LATER-owned schema.
    { schema: poolQuoteInputSchema, label: "getPoolQuote", appCheck: "monitor", options: { cors: true } },
    async ({ poolType, estimatedPlayers, addons, couponCode }, request): Promise<PoolQuote> => {
    const userId = request.auth!.uid;

    const config = await loadBillingConfig(db);

    // Resolve coupon (validated) BEFORE computing so the quote can apply it.
    let couponState: CouponQuoteState | undefined;
    let coupon: QuoteCoupon | undefined;
    if (couponCode) {
        const resolved = await resolveCouponForQuote(db, couponCode, {
            userId,
            poolType,
            now: Date.now(),
        });
        couponState = resolved?.state;
        coupon = resolved?.coupon;
    }

    try {
        // computeQuote throws (plain Error) when the format is unmapped in
        // formatTierMap — surface as invalid-argument.
        return computeQuote({
            config,
            poolType,
            estimatedPlayers,
            addons,
            couponState,
            coupon,
        });
    } catch (e: any) {
        throw new HttpsError("invalid-argument", e?.message || "Unable to price this pool format.");
    }
    },
);
