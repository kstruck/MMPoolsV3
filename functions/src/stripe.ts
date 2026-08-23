// Set the secrets before deploy:
//   firebase functions:secrets:set STRIPE_SECRET_KEY
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//
// Buy-flow overhaul (PLAN Phases 2/3/5, ADR-0002):
//   - createCheckoutSession is a price authority: it computes the itemized quote
//     server-side (billing.ts computeQuote), NEVER trusts the client price, and
//     prices validated add-on booleans.
//   - Redirect URLs are derived from an ALLOWLISTED origin + fixed route
//     templates (open-redirect fix); client-supplied successUrl/cancelUrl are
//     ignored.
//   - Coupon uses are reserved (server reservationId) at checkout, confirmed at
//     the completion webhook, released on expiry/failure/sweep.
//   - Pool-level checkout idempotency via billing.pendingSessionId.
//   - Ledger rows are written in the SAME transaction as the pool/bundle
//     mutation in the webhook (a ledger failure fails the webhook → Stripe
//     retries). Refunds/disputes write linked negative adjustment rows + alerts.

import * as functions from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { defineSecret } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";

import Stripe from "stripe";
import { validated } from "./lib/validated";
import { isPoolOwnerOrManager } from "./poolOps";
import { normalizeRole } from "./lib/roles";
import { withHeartbeat } from "./lib/heartbeat";
import { createCheckoutSessionSchema } from "./schemas/billingCheckout";
import { decideEventClaim, shouldAlertOnFailure, type WebhookEventDoc } from "./lib/webhookDurability";
import { captureMonetizationAlert } from "./lib/sentryServer";
import { dispatchOpsAlert } from "./lib/opsAlertDispatcher";
import {
    writeBillingChargeTxn,
    type BillingCharge,
} from "./lib/billingCharges";
import { loadBillingConfig, resolveCouponForQuote } from "./billing";
import { computeQuote, computeAddonUpgradeQuote, pricedAddonKeys } from "./lib/quoteEngine";
import {
    checkoutPoolInputSchema,
    unsellableClampOutcome,
    type PendingBillableSnapshot,
} from "./shared/schemas/quote";
import {
    validateCouponRules,
    makeReservationEntry,
    makeConfirmedEntry,
    transitionReservation,
    stalePendingReservationIds,
    type CouponUsageEntry,
} from "./lib/couponReservation";
import { grantEntitlementTxn } from "./entitlements";
import {
    normalizeLegacyPackage,
    type Package,
} from "./shared/schemas/billingConfig";
import {
    MAX_CREDITS_PER_BUNDLE,
    type ProductSnapshot,
} from "./shared/schemas/bundle";

const db = admin.firestore();

// --- Stripe Config Secrets (Secret Manager, not plain config) ---
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Stripe will be initialized at function invocation time
let stripeInstance: any = null;
function getStripe() {
    if (!stripeInstance) {
        let key = "";
        try {
            key = stripeSecretKey.value();
        } catch (e) {
            console.warn("[Stripe] STRIPE_SECRET_KEY is not defined in this environment.");
        }

        if (!key || key.startsWith("placeholder") || key === "") {
            return null; // Signal mockup bypass mode
        }

        stripeInstance = new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
    }
    return stripeInstance;
}

// =============================================================================
// Redirect-origin allowlist (open-redirect fix — PLAN Phase 2 #6)
// successUrl/cancelUrl are NO LONGER accepted from the client. The server picks
// a safe origin (from the request Origin header IF it is allowlisted, else the
// production origin) and builds fixed route templates.
// =============================================================================

const PRODUCTION_ORIGIN = "https://www.marchmeleepools.com";

/** Allowlisted origins. Extendable via BUYFLOW_ALLOWED_ORIGINS (comma-separated). */
function allowedOrigins(): string[] {
    const base = [
        PRODUCTION_ORIGIN,
        "https://marchmeleepools.com",
        "https://marchmelee.com",
        "https://www.marchmelee.com",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:5199",
    ];
    const extra = (process.env.BUYFLOW_ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [...new Set([...base, ...extra])];
}

/** Normalizes an origin string to `protocol//host` or returns null if unparseable. */
function normalizeOrigin(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
        const u = new URL(raw);
        return `${u.protocol}//${u.host}`;
    } catch {
        return null;
    }
}

/**
 * The safe origin to build redirect URLs from. Uses the request Origin/Referer
 * ONLY when it is in the allowlist; otherwise falls back to the production
 * origin. Client-supplied redirect URLs are never used.
 */
function safeRedirectOrigin(rawRequest: any): string {
    const headerOrigin =
        normalizeOrigin(rawRequest?.headers?.origin as string) ||
        normalizeOrigin(rawRequest?.headers?.referer as string);
    if (headerOrigin && allowedOrigins().includes(headerOrigin)) {
        return headerOrigin;
    }
    return PRODUCTION_ORIGIN;
}

function poolSuccessUrl(origin: string, poolId: string): string {
    return `${origin}/pool/${encodeURIComponent(poolId)}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
}
function poolCancelUrl(origin: string, poolId: string): string {
    return `${origin}/pool/${encodeURIComponent(poolId)}?payment=cancelled`;
}
function bundleSuccessUrl(origin: string): string {
    return `${origin}/pricing?payment=success&session_id={CHECKOUT_SESSION_ID}`;
}
function bundleCancelUrl(origin: string): string {
    return `${origin}/pricing?payment=cancelled`;
}

// A live pending checkout is considered valid for the Stripe session lifetime
// (24h). Beyond that, a new checkout may replace it.
const PENDING_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// =============================================================================
// 1. createCheckoutSession — Callable Function (onCall v2)
// =============================================================================

/**
 * PLAN-COMMISSIONER-TRANSFER K17 (shipped standalone per the 2026-08-16 board
 * memo, Kevin 2026-08-17): the POOL-purchase path of createCheckoutSession is
 * owner/manager-only — or a SUPER_ADMIN whose claim AND live users/{uid}.role
 * agree (the same claim+doc guard assertCallerRole applies). Before this, any
 * signed-in user could start a hosting checkout for any pool. Bundle purchases
 * are per-person and untouched.
 *
 * `poolData` is whatever the caller has in hand — the pre-read for the fast
 * refusal, and the IN-TRANSACTION read inside both write transactions (the $0 /
 * credit activation and the paid reservation), so a checkout racing an
 * ownership change is refused against the pool as it is being written, not as
 * it was a moment ago. `userDoc` likewise: the SA path re-reads users/{uid} in
 * each transaction.
 */
export function assertCheckoutOwnership(
    poolData: any,
    uid: string,
    claimRole: unknown,
    userDocRole: unknown,
): void {
    if (isPoolOwnerOrManager(poolData, uid)) return;
    const claimIsSA = normalizeRole((claimRole as string) ?? null) === "SUPER_ADMIN";
    const docIsSA = normalizeRole((userDocRole as string) ?? null) === "SUPER_ADMIN";
    if (claimIsSA && docIsSA) return;
    throw new HttpsError("permission-denied", "Only the pool commissioner can buy or upgrade hosting for this pool.");
}

export const createCheckoutSession = validated(
    // Union: { bundleType } (bundle purchase) | checkoutPoolInputSchema (pool
    // purchase) — the same two shapes the old head accepted, now parsed at the
    // gate. Both paths remain server-priced.
    {
        schema: createCheckoutSessionSchema,
        label: "createCheckoutSession",
        appCheck: "monitor",
        options: { cors: true, secrets: [stripeSecretKey] },
    },
    async (input, request) => {
    const userId = request.auth!.uid;

    const origin = safeRedirectOrigin(request.rawRequest);

    // =====================================================================
    // BUNDLE PURCHASE PATH (no coupons/reservations; server-priced)
    // =====================================================================
    if ("bundleType" in input) {
        return createBundleCheckout(userId, input.bundleType, origin, request.auth!.token?.email);
    }

    // =====================================================================
    // STANDARD POOL PURCHASE PATH
    // =====================================================================
    const { poolId, poolName, poolType, estimatedPlayers, addons, couponCode, usedCredit, customCreditId } = input;
    // PLAN-PER-POOL-PREMIUM C2. Default 'pool', so every client that predates
    // this field behaves exactly as before.
    const purchaseKind = input.purchaseKind ?? "pool";
    const isAddonPurchase = purchaseKind === "addon";

    // --- Verify pool exists ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }
    const poolData = poolDoc.data() as any;

    // --- Ownership gate (K17): owner/manager, or a claim+doc-verified SUPER_ADMIN ---
    const claimRole = request.auth!.token?.role;
    const readCallerRole = async (getter: (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>): Promise<unknown> =>
        normalizeRole((claimRole as string) ?? null) === "SUPER_ADMIN"
            ? (await getter(db.collection("users").doc(userId))).data()?.role
            : undefined; // not claiming SA — no doc read needed, the owner check decides
    assertCheckoutOwnership(poolData, userId, claimRole, await readCallerRole(ref => ref.get()));

    // --- Authoritative quote (single price authority; client price never trusted) ---
    const config = await loadBillingConfig(db);
    const resolvedCoupon = couponCode
        ? await resolveCouponForQuote(db, couponCode, { userId, poolType, now: Date.now() })
        : undefined;

    // ---------------------------------------------------------------------
    // MID-SEASON ADD-ON PURCHASE (C2). Different preconditions, different
    // quote, different snapshot — so it is resolved here rather than threaded
    // through the hosting path as a flag.
    // ---------------------------------------------------------------------
    const existingBilling = (poolData?.billing ?? {}) as {
        status?: string;
        tier?: string;
        maxPlayersAllowed?: number;
        featuresUnlocked?: Record<string, boolean>;
        paid?: { tier?: string; maxPlayersAllowed?: number; addons?: string[] };
    };
    /**
     * What the pool ALREADY holds, from BOTH sources, because they can differ:
     * `paid.addons` records purchases, `featuresUnlocked` also carries a
     * super-admin grant (adminSetPoolFeature) on a pool that never bought
     * anything. Selling a commissioner something Kevin already gave them would
     * be the worst possible version of this feature.
     */
    const ownedAddons: string[] = Array.from(new Set([
        ...(Array.isArray(existingBilling.paid?.addons) ? existingBilling.paid!.addons! : []),
        ...Object.entries(existingBilling.featuresUnlocked ?? {})
            .filter(([, on]) => on === true)
            .map(([k]) => k),
    ]));

    let quote;
    try {
        quote = isAddonPurchase
            ? computeAddonUpgradeQuote({
                config,
                poolType,
                // The pool's OWN allowance, never the client's number: an add-on
                // purchase may not move the seat cap in either direction.
                estimatedPlayers: existingBilling.paid?.maxPlayersAllowed
                    ?? existingBilling.maxPlayersAllowed
                    ?? 0,
                currentTier: (existingBilling.paid?.tier ?? existingBilling.tier ?? "premium_tier") as typeof quote.tier,
                addons,
                owned: ownedAddons,
            })
            : computeQuote({
                config,
                poolType,
                estimatedPlayers,
                addons,
                couponState: resolvedCoupon?.state,
                coupon: resolvedCoupon?.coupon,
            });
    } catch (e: any) {
        throw new HttpsError("invalid-argument", e?.message || "Unable to price this pool format.");
    }
    const serverPrice = quote.total;

    if (isAddonPurchase) {
        // Preconditions, all server-side. The pool must be ACTIVE (an inactive
        // pool buys hosting, which is the other path), there must be something
        // left to sell, and none of the free-activation machinery applies.
        if (existingBilling.status !== "active") {
            throw new HttpsError("failed-precondition", "This pool is not active yet. Buy hosting for it first — add-ons come with that purchase.");
        }
        if (quote.addonLines.length === 0 || serverPrice <= 0) {
            throw new HttpsError("failed-precondition", "There is nothing to buy: this pool already has the features you selected, or they are included with every pool.");
        }
        if (usedCredit || customCreditId) {
            throw new HttpsError("invalid-argument", "Pool credits pay for hosting, not for add-ons.");
        }
        if (couponCode) {
            // See computeAddonUpgradeQuote: a coupon reservation is keyed by
            // (code, userId, poolId) and its limits assume one purchase per
            // pool. Refusing is honest; silently ignoring the code would let a
            // commissioner believe a discount applied.
            throw new HttpsError("invalid-argument", "Coupons apply to a pool's hosting purchase, not to add-ons bought later.");
        }
    }

    // Pending billable snapshot — copied to billing.paid ONLY on success.
    //
    // ⚠️ For an ADD-ON purchase the snapshot carries the pool's EXISTING tier
    // and seat allowance (so finalization cannot move them) and ONLY the newly
    // priced add-ons. The union with what the pool already owns happens at
    // finalization, against the pool as read in that transaction.
    const snapshot: PendingBillableSnapshot = isAddonPurchase
        ? {
            tier: quote.tier,
            maxPlayersAllowed: quote.estimatedPlayers,
            addons: pricedAddonKeys(quote.addonLines),
        }
        : {
            tier: quote.tier,
            maxPlayersAllowed: estimatedPlayers,
            addons: pricedAddonKeys(quote.addonLines),
        };
    /**
     * ⚠️ FOR AN ADD-ON PURCHASE THIS IS A PATCH, NOT A PICTURE. It names only
     * the keys being bought; finalization merges it. Sending the full four-key
     * object here — the hosting path's shape — would carry `false` for every
     * add-on the pool already owns and REVOKE them on success.
     */
    const featuresUnlocked = isAddonPurchase
        ? Object.fromEntries(pricedAddonKeys(quote.addonLines).map((k) => [k, true]))
        : {
            aiCommissioner: addons.aiCommissioner === true,
            smsNotifications: addons.smsNotifications === true,
            whatIfSimulator: addons.whatIfSimulator === true,
            customBranding: addons.customBranding === true,
        };

    // --- Enforce 1 active free pool limit (unchanged rule) ---
    // Skipped for an add-on purchase: that pool is already active and already
    // counted, and `serverPrice` is guaranteed > 0 above.
    if (!isAddonPurchase && (quote.tier === "free_tier" || serverPrice === 0)) {
        if (quote.freeTierEligible || snapshot.tier === "free_tier") {
            const activeFreePoolsSnap = await db.collection("pools")
                .where("ownerId", "==", userId)
                .where("billing.status", "==", "active")
                .where("billing.tier", "==", "free_tier")
                .get();
            const others = activeFreePoolsSnap.docs.filter((d) => d.id !== poolId);
            if (others.length > 0 && snapshot.tier === "free_tier") {
                throw new HttpsError("failed-precondition", "You already have an active free pool. You are only allowed 1 active free pool at any time.");
            }
        }
    }

    // --- Validate free-activation reason if $0 but NOT free-tier eligible ---
    // ($0 must come from a 100% coupon, a credit, or free-tier — never a bare price.)
    let usedCreditValidated = false;
    if (usedCredit) {
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.data();
        if (customCreditId) {
            const creditObj = (userData?.poolCredits || []).find((c: any) => c.id === customCreditId);
            if (!creditObj || creditObj.isUsed) {
                throw new HttpsError("failed-precondition", "Specific custom pool credit is missing or already used.");
            }
        } else if ((userData?.freePoolsAvailable || 0) <= 0) {
            throw new HttpsError("failed-precondition", "No universal pool credits available.");
        }
        usedCreditValidated = true;
    }

    // =====================================================================
    // FREE PATH ($0) — activate + confirm coupon reservation ATOMICALLY, no Stripe
    // =====================================================================
    if (serverPrice === 0) {
        const couponIsFullDiscount = !!resolvedCoupon?.state.valid && quote.discount >= quote.subtotal && quote.subtotal > 0;
        if (!usedCreditValidated && snapshot.tier !== "free_tier" && !couponIsFullDiscount) {
            throw new HttpsError("failed-precondition", "No valid free-activation reason provided.");
        }

        const reservationId = randomUUID();
        const activationTag = usedCredit
            ? (customCreditId ? `pool_credit_use_${customCreditId}` : "pool_credit_use")
            : (couponIsFullDiscount ? `free_promo_${reservationId}` : "free_tier_activation");

        await db.runTransaction(async (txn) => {
            const poolRef = db.collection("pools").doc(poolId);
            const freshPool = await txn.get(poolRef);
            // K17: re-check ownership against the pool AS READ IN THIS TRANSACTION.
            assertCheckoutOwnership(freshPool.data(), userId, claimRole, await readCallerRole(ref => txn.get(ref)));
            const freshBilling = (freshPool.data() as any)?.billing;
            // No-op if already active (idempotency; avoid double credit spend).
            if (freshBilling?.status === "active") {
                throw new HttpsError("failed-precondition", "This pool is already active.");
            }

            // Coupon confirm (write reservation directly as confirmed).
            let couponRef: FirebaseFirestore.DocumentReference | null = null;
            let confirmedLog: CouponUsageEntry[] | null = null;
            if (couponIsFullDiscount && couponCode) {
                const code = couponCode.toUpperCase().trim();
                const cSnap = await txn.get(db.collection("coupons").where("code", "==", code).limit(1));
                if (!cSnap.empty) {
                    couponRef = cSnap.docs[0].ref;
                    const c = cSnap.docs[0].data() as any;
                    // Re-validate against current state inside the txn.
                    const v = validateCouponRules(
                        { isActive: c.isActive, expiresAt: c.expiresAt, maxUses: c.maxUses, perUserLimit: c.perUserLimit, allowedPoolTypes: c.allowedPoolTypes, usageLog: c.usageLog },
                        { userId, poolType, now: Date.now() }
                    );
                    if (!v.valid) throw new HttpsError("failed-precondition", v.reason);
                    confirmedLog = [
                        ...((c.usageLog as CouponUsageEntry[]) || []),
                        makeConfirmedEntry({ reservationId, userId, poolId, now: Date.now() }),
                    ];
                }
            }

            // Deduct credit inside the txn.
            if (usedCredit) {
                const userRef = db.collection("users").doc(userId);
                const uSnap = await txn.get(userRef);
                const uData = uSnap.data() as any;
                if (customCreditId) {
                    const updated = (uData?.poolCredits || []).map((c: any) =>
                        c.id === customCreditId ? { ...c, isUsed: true, usedForPoolId: poolId } : c
                    );
                    txn.update(userRef, { poolCredits: updated });
                } else {
                    txn.update(userRef, { freePoolsAvailable: FieldValue.increment(-1) });
                }
            }

            // Activate pool + stamp paid snapshot + explicit featuresUnlocked.
            txn.update(poolRef, {
                "billing.status": "active",
                "billing.pricePaid": ((freshBilling?.pricePaid as number) || 0) + 0,
                "billing.stripeSessionId": activationTag,
                "billing.tier": snapshot.tier === "free_tier" ? "free_tier" : (snapshot.tier || "premium_tier"),
                "billing.maxPlayersAllowed": snapshot.maxPlayersAllowed,
                "billing.pendingSessionId": FieldValue.delete(),
                "billing.featuresUnlocked": featuresUnlocked,
                "billing.paid": {
                    tier: snapshot.tier,
                    maxPlayersAllowed: snapshot.maxPlayersAllowed,
                    addons: snapshot.addons,
                    at: Date.now(),
                },
            });

            if (couponRef && confirmedLog) {
                txn.update(couponRef, { usesCount: FieldValue.increment(1), usageLog: confirmedLog });
            }

            // Ledger row ($0) in the same txn.
            writeBillingChargeTxn(txn, db, {
                userId, kind: "pool", amount: 0, poolId,
                tier: snapshot.tier, couponCode: couponCode?.toUpperCase().trim(),
                stripeSessionId: activationTag,
            });
        });

        console.log(`[Checkout] Pool ${poolId} activated for free by ${userId} (${activationTag})`);
        return { sessionUrl: `${origin}/pool/${encodeURIComponent(poolId)}?payment=success` };
    }

    // =====================================================================
    // PAID PATH — reserve coupon + set pending idempotency, THEN create session
    // =====================================================================
    const reservationId = randomUUID();
    // Only a coupon that actually applied a discount is reserved + carried in
    // metadata (so the webhook confirms exactly the reservation we made). A
    // supplied-but-invalid code is dropped here and the pool pays full price.
    const appliedCouponCode = resolvedCoupon?.state.valid ? couponCode?.toUpperCase().trim() : undefined;

    // Transaction: pool-level idempotency + coupon reservation + session record.
    await db.runTransaction(async (txn) => {
        const poolRef = db.collection("pools").doc(poolId);
        const freshPool = await txn.get(poolRef);
        // K17: re-check ownership against the pool AS READ IN THIS TRANSACTION.
        assertCheckoutOwnership(freshPool.data(), userId, claimRole, await readCallerRole(ref => txn.get(ref)));
        const freshBilling = (freshPool.data() as any)?.billing;

        // Reject a second live checkout on this pool (idempotency).
        const pending = freshBilling?.pendingSessionId as { reservationId?: string; at?: number } | undefined;
        if (pending && typeof pending.at === "number" && Date.now() - pending.at < PENDING_SESSION_TTL_MS) {
            throw new HttpsError("failed-precondition", "A checkout is already in progress for this pool. Please complete or cancel it before starting another.");
        }
        // An ACTIVE pool has no hosting left to sell — but it is exactly the
        // pool an ADD-ON purchase targets, so the guard is scoped to the
        // hosting path rather than being a blanket refusal (C2).
        if (!isAddonPurchase && freshBilling?.status === "active") {
            throw new HttpsError("failed-precondition", "This pool is already active.");
        }
        if (isAddonPurchase && freshBilling?.status !== "active") {
            // Re-checked inside the transaction, against the pool AS READ HERE:
            // the pre-transaction check above can race a cancellation.
            throw new HttpsError("failed-precondition", "This pool is not active yet. Buy hosting for it first — add-ons come with that purchase.");
        }

        // Coupon reservation — ONLY reserve a coupon that actually applied a
        // discount at quote time (a supplied-but-invalid code proceeds at full
        // price, it never blocks checkout). Re-validate against current state
        // inside the txn to enforce hard limits under contention (TOCTOU).
        if (couponCode && resolvedCoupon?.state.valid) {
            const code = couponCode.toUpperCase().trim();
            const cSnap = await txn.get(db.collection("coupons").where("code", "==", code).limit(1));
            if (cSnap.empty) throw new HttpsError("not-found", "Coupon code not found.");
            const cRef = cSnap.docs[0].ref;
            const c = cSnap.docs[0].data() as any;
            const v = validateCouponRules(
                { isActive: c.isActive, expiresAt: c.expiresAt, maxUses: c.maxUses, perUserLimit: c.perUserLimit, allowedPoolTypes: c.allowedPoolTypes, usageLog: c.usageLog },
                { userId, poolType, now: Date.now() }
            );
            if (!v.valid) throw new HttpsError("failed-precondition", v.reason);
            const newLog = [
                ...((c.usageLog as CouponUsageEntry[]) || []),
                makeReservationEntry({ reservationId, userId, poolId, now: Date.now() }),
            ];
            txn.update(cRef, { usesCount: FieldValue.increment(1), usageLog: newLog });
        }

        // Pending billable snapshot lives on the SESSION record (NOT the live pool).
        txn.set(db.collection("checkoutSessions").doc(reservationId), {
            reservationId,
            poolId,
            userId,
            poolType,
            status: "pending",
            purchaseKind,
            couponCode: appliedCouponCode ?? null,
            pendingSnapshot: snapshot,
            featuresUnlocked,
            amount: serverPrice,
            createdAt: Date.now(),
        });

        // Pool-level idempotency marker.
        txn.update(poolRef, {
            "billing.pendingSessionId": { reservationId, at: Date.now() },
        });
    });

    // --- Create the Stripe session (or mock) with reservationId in metadata ---
    const stripe = getStripe();
    const metadata = {
        poolId,
        userId,
        tier: snapshot.tier,
        poolType,
        purchaseKind,
        reservationId,
        couponCode: appliedCouponCode || "",
        maxPlayersAllowed: String(snapshot.maxPlayersAllowed),
        addons: snapshot.addons.join(","),
    };

    if (!stripe) {
        // Mock dev sandbox: emulate a completed session inline (activate now).
        console.log(`[Stripe Mockup] Missing/placeholder key — mock checkout for pool ${poolId}.`);
        const mockSessionId = `mock_local_dev_session_${Date.now()}`;
        await finalizePoolPayment({
            sessionId: mockSessionId,
            paymentIntentId: `mock_pi_${Date.now()}`,
            amountTotalCents: Math.round(serverPrice * 100),
            metadata,
        });
        return { sessionUrl: `${origin}/pool/${encodeURIComponent(poolId)}?payment=success&session_id=${mockSessionId}` };
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            // codex r1 [P2]. An add-on session used to tell Stripe
                            // the product was "Premium Hosting" with a hosting-fee
                            // description — on a pool whose hosting was already
                            // paid for. The buyer's card statement and receipt
                            // would both have named something they did not buy,
                            // which is a dispute waiting to happen. The name now
                            // comes from the quote's own priced lines.
                            name: isAddonPurchase
                                ? `${poolName} — ${quote.addonLines.map((l) => l.label).join(" + ")}`
                                : `${poolName} — ${snapshot.tier === "premium_tier" ? "Premium" : "Standard"} Hosting`,
                            description: isAddonPurchase
                                ? `Add-on${quote.addonLines.length === 1 ? "" : "s"} for your ${poolType} pool. Your hosting is already paid for and is not charged again.`
                                : `One-time hosting fee for your ${poolType} pool`,
                        },
                        unit_amount: Math.round(serverPrice * 100),
                    },
                    quantity: 1,
                },
            ],
            success_url: poolSuccessUrl(origin, poolId),
            cancel_url: poolCancelUrl(origin, poolId),
            metadata,
            customer_email: request.auth!.token.email || undefined,
        });
        console.log(`[Stripe] Checkout session ${session.id} created for pool ${poolId} (reservation ${reservationId})`);
        return { sessionUrl: session.url };
    } catch (err: any) {
        // Session creation failed → release the reservation + clear pending marker (best effort).
        console.error("[Stripe] Error creating checkout session:", err?.message);
        await releaseReservationBestEffort(reservationId, poolId, appliedCouponCode).catch((e) =>
            console.error("[Stripe] Failed to release reservation after session error:", e)
        );
        throw new HttpsError("internal", `Failed to create checkout session: ${err?.message}`);
    }
    },
);

/** Bundle checkout — server-priced, server-derived redirect URLs, no coupons. */
async function createBundleCheckout(
    userId: string,
    bundleType: string,
    origin: string,
    email: string | undefined
): Promise<{ sessionUrl: string | null }> {
    // Authoritative bundle price from billing_config.
    let serverPrice: number | undefined;
    let dynamicBundle: any = null;
    try {
        const cfg = (await db.collection("settings").doc("billing_config").get()).data();
        const packagesList = cfg?.packagesList || [];
        dynamicBundle = packagesList.find((b: any) => b.id === bundleType) || null;
        if (dynamicBundle) serverPrice = dynamicBundle.price;
        else if (bundleType === "buy_3" && cfg?.packages?.buy_3) serverPrice = cfg.packages.buy_3;
        else if (bundleType === "unlimited_1yr" && cfg?.packages?.unlimited_1yr) serverPrice = cfg.packages.unlimited_1yr;
    } catch (e) {
        console.error("[Stripe] Failed to resolve bundle price:", e);
    }
    if (serverPrice === undefined) {
        throw new HttpsError("internal", "Unable to resolve authoritative bundle price.");
    }

    const stripe = getStripe();
    if (!stripe) {
        console.log(`[Stripe Mockup] Mock bundle checkout for ${bundleType}.`);
        const mockSessionId = `mock_bundle_session_${Date.now()}`;
        // grantBundle writes the canonical bundle + credit docs + ledger row in
        // one txn (source PURCHASE, keyed off the mock session id).
        await grantBundle(userId, bundleType, { stripeSessionId: mockSessionId, amount: serverPrice });
        return { sessionUrl: `${origin}/pricing?payment=success&session_id=${mockSessionId}` };
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: bundleType === "buy_3" ? "3-Pool Bundle Package" : bundleType === "unlimited_1yr" ? "1-Year Unlimited Pool Pass" : (dynamicBundle?.name || "Pool Bundle"),
                            description: dynamicBundle?.description || (bundleType === "buy_3" ? "Get 3 pool credits to use on any pool type" : "Create unlimited pools of any type for 1 year"),
                        },
                        unit_amount: Math.round(serverPrice * 100),
                    },
                    quantity: 1,
                },
            ],
            success_url: bundleSuccessUrl(origin),
            cancel_url: bundleCancelUrl(origin),
            metadata: { userId, bundleType },
            customer_email: email || undefined,
        });
        console.log(`[Stripe] Bundle checkout ${session.id} created for user ${userId}`);
        return { sessionUrl: session.url };
    } catch (err: any) {
        console.error("[Stripe] Bundle Checkout Error:", err);
        throw new HttpsError("internal", `Failed to create bundle checkout session: ${err?.message}`);
    }
}

/**
 * Resolves a bundleType (packagesList item id, or the flat legacy buy_3 /
 * unlimited_1yr keys) to the canonical Package shape. Returns undefined if it
 * cannot be resolved (caller fails the webhook so Stripe retries).
 *
 * Legacy flat keys are mapped to sane canonical products (matching the old
 * grantBundle semantics: buy_3 → 3 credits; unlimited_1yr → 1-year pass).
 */
async function resolveBundlePackage(bundleType: string): Promise<Package | undefined> {
    let cfg: any = null;
    try {
        cfg = (await db.collection("settings").doc("billing_config").get()).data();
    } catch (err) {
        console.error("[Stripe] Failed to load billing_config for bundle resolve:", err);
    }
    const packagesList: unknown[] = Array.isArray(cfg?.packagesList) ? cfg.packagesList : [];
    const raw = packagesList.find((b: any) => b?.id === bundleType);
    if (raw) return normalizeLegacyPackage(raw);

    // Flat legacy fallbacks (settings.packages.{buy_3,unlimited_1yr} prices).
    if (bundleType === "buy_3") {
        return normalizeLegacyPackage({
            id: "buy_3", name: "3-Pool Bundle Package",
            description: "Get 3 pool credits to use on any pool type",
            price: Number(cfg?.packages?.buy_3) || 0,
            poolType: "ALL", maxPlayersPerPool: 9999,
            poolsIncluded: 3, durationDays: 0, isActive: true,
        });
    }
    if (bundleType === "unlimited_1yr") {
        return normalizeLegacyPackage({
            id: "unlimited_1yr", name: "1-Year Unlimited Pool Pass",
            description: "Create unlimited pools of any type for 1 year",
            price: Number(cfg?.packages?.unlimited_1yr) || 0,
            poolType: "ALL", maxPlayersPerPool: 9999,
            poolsIncluded: 1, durationDays: 365, isActive: true,
        });
    }
    return undefined;
}

/**
 * Grants a purchased bundle into the CANONICAL entitlement model (PLAN #14):
 * ONE bundles/{id} doc + N credit docs (N = creditsTotal, capped 100) in a
 * single transaction, source PURCHASE, with the ledger row written in the SAME
 * txn. Idempotent: the bundle id is derived from the Stripe session id, so a
 * webhook retry re-creates the same doc rather than granting twice.
 *
 * Does NOT write the legacy users.freePoolsAvailable / poolCredits / activeBundleType
 * fields any more — those readers are flipped to the new model at cutover.
 * Shared by the mock path (no session id → generated tag) and the webhook.
 */
async function grantBundle(
    userId: string,
    bundleType: string,
    opts: { stripeSessionId?: string; paymentIntentId?: string; amount?: number } = {}
): Promise<void> {
    const pkg = await resolveBundlePackage(bundleType);
    if (!pkg) {
        throw new HttpsError("internal", `Unable to resolve bundle '${bundleType}' for entitlement grant.`);
    }

    const snapshot: ProductSnapshot = {
        name: pkg.name,
        price: pkg.price,
        poolType: pkg.poolType,
        maxPlayersPerPool: pkg.maxPlayersPerPool,
    };
    // Deterministic bundle id → webhook retries are idempotent.
    const bundleId = opts.stripeSessionId
        ? `purchase_${opts.stripeSessionId}`
        : `purchase_${bundleType}_${Date.now()}`;

    const isPass = pkg.kind === "UNLIMITED_PASS";
    const creditsTotal = isPass ? 0 : Math.min(MAX_CREDITS_PER_BUNDLE, Math.max(1, pkg.poolsIncluded));
    const termEndsAt = isPass ? Date.now() + pkg.termDays * 24 * 60 * 60 * 1000 : undefined;

    await db.runTransaction(async (txn) => {
        // Idempotency: if this purchase bundle already exists, do nothing.
        const existing = await txn.get(db.collection("bundles").doc(bundleId));
        if (existing.exists) {
            console.log(`[Stripe] Bundle ${bundleId} already granted; skipping (idempotent).`);
            return;
        }
        grantEntitlementTxn(txn, {
            ownerId: userId,
            productKind: pkg.kind,
            source: "PURCHASE",
            productSnapshot: snapshot,
            creditsTotal,
            creditConstraints: {
                poolType: pkg.poolType === "ALL" ? undefined : pkg.poolType,
                maxPlayersPerPool: pkg.maxPlayersPerPool >= 9999 ? undefined : pkg.maxPlayersPerPool,
            },
            termEndsAt,
            stripeSessionId: opts.stripeSessionId,
            paymentIntentId: opts.paymentIntentId,
            ledgerAmount: typeof opts.amount === "number" ? opts.amount : pkg.price,
            bundleId,
        });
        // Promote to COMMISSIONER (mirrors legacy behavior) — user doc write only.
        txn.set(db.collection("users").doc(userId), { role: "COMMISSIONER" }, { merge: true });
    });
}

/**
 * Finalizes a completed pool payment in ONE transaction: confirm coupon
 * reservation, copy pending snapshot → billing.paid + featuresUnlocked, activate
 * pool, write the ledger row. If the pool is ALREADY active, no-ops the charge
 * and writes a DOUBLE_CHARGE_REVIEW monetization alert instead. Idempotent by
 * session id (ledger doc id = session id) and by the reservation status flip.
 */
async function finalizePoolPayment(args: {
    sessionId: string;
    paymentIntentId?: string;
    amountTotalCents: number;
    metadata: Record<string, string>;
}): Promise<void> {
    const { sessionId, paymentIntentId, amountTotalCents, metadata } = args;
    const poolId = metadata.poolId;
    const userId = metadata.userId;
    const reservationId = metadata.reservationId;
    const couponCode = metadata.couponCode || undefined;
    const amount = amountTotalCents / 100;

    // Set inside the txn callback (reset each attempt so a retry that lands on
    // the OTHER branch doesn't leave a stale true from an earlier attempt) —
    // read after the txn commits to fire the Sentry alert exactly once,
    // outside the transaction (PLAN #10 — never call out from inside a txn).
    let doubleCharge = false;
    await db.runTransaction(async (txn) => {
        doubleCharge = false;
        const poolRef = db.collection("pools").doc(poolId);
        const poolSnap = await txn.get(poolRef);
        const billing = (poolSnap.data() as any)?.billing;

        // Session record holds the authoritative pending snapshot.
        let snapshot: PendingBillableSnapshot | undefined;
        let featuresUnlocked: Record<string, boolean> | undefined;
        let sessionRef: FirebaseFirestore.DocumentReference | null = null;
        let sessionKind: string | undefined;
        if (reservationId) {
            sessionRef = db.collection("checkoutSessions").doc(reservationId);
            const sSnap = await txn.get(sessionRef);
            const sData = sSnap.data() as any;
            snapshot = sData?.pendingSnapshot;
            featuresUnlocked = sData?.featuresUnlocked;
            sessionKind = sData?.purchaseKind;
        }
        /**
         * WHAT THIS SESSION BOUGHT (C2). The SESSION RECORD wins over Stripe
         * metadata: the session doc is written by our own transaction, the
         * metadata round-trips through Stripe. They agree in practice; when
         * they cannot both be read, the one we wrote is the one to trust.
         */
        const purchaseKind = sessionKind ?? metadata.purchaseKind ?? "pool";
        const isAddonPurchase = purchaseKind === "addon";

        /**
         * ⚠️ AN ADD-ON PURCHASE ARRIVES FOR AN ACTIVE POOL BY DEFINITION, so
         * `status === "active"` stops being evidence of a double charge for it.
         * Its idempotency comes from the LEDGER instead: the row's id IS the
         * Stripe session id, so a replayed webhook finds it and no-ops. That
         * matters more here than on the hosting path, because `pricePaid` is an
         * INCREMENT — replaying it would inflate the pool's recorded spend even
         * though the entitlement writes are idempotent.
         */
        if (isAddonPurchase) {
            const ledgerRef = db.collection("billingCharges").doc(sessionId);
            const ledgerSnap = await txn.get(ledgerRef);
            if (ledgerSnap.exists) {
                console.log(`[Stripe Webhook] Add-on session ${sessionId} already finalized for pool ${poolId}; no-op.`);
                if (reservationId && sessionRef) {
                    txn.set(sessionRef, { status: "confirmed", sessionId, confirmedAt: Date.now() }, { merge: true });
                }
                return;
            }
        }

        // --- DOUBLE-CHARGE GUARD: pool already active → no-op + alert ---
        if (!isAddonPurchase && billing?.status === "active") {
            doubleCharge = true;
            const alertRef = db.collection("monetization_alerts").doc(`DOUBLE_CHARGE_${sessionId}`);
            txn.set(alertRef, {
                type: "DOUBLE_CHARGE_REVIEW",
                poolId,
                userId,
                sessionId,
                paymentIntentId: paymentIntentId ?? null,
                amount,
                status: "open",
                createdAt: Date.now(),
            }, { merge: true });
            if (reservationId && sessionRef) {
                txn.set(sessionRef, { status: "confirmed", sessionId, doubleCharge: true, confirmedAt: Date.now() }, { merge: true });
            }
            console.warn(`[Stripe Webhook] DOUBLE-CHARGE: session ${sessionId} arrived for already-active pool ${poolId}; charge no-op'd, alert written.`);
            return;
        }

        const tier = (snapshot?.tier || metadata.tier || "standard_tier");
        const maxPlayersAllowed = snapshot?.maxPlayersAllowed ?? (Number(metadata.maxPlayersAllowed) || 10);
        const rawUnlocked = featuresUnlocked || {
            aiCommissioner: false, smsNotifications: false, whatIfSimulator: false, customBranding: false,
        };

        // IN-FLIGHT SESSION CLAMP (PLAN-COST-CONTROLS 0.5.4; codex round 2).
        // 0.5.4 stops SMS being SOLD at the shared schema, but this handler
        // finalizes sessions created BEFORE that deployed, and it trusts the
        // persisted pendingSnapshot/featuresUnlocked rather than re-parsing the
        // schema. Without this, such a session still stamps the SMS flag on a
        // feature Kevin has turned off.
        //
        // The clamp alone would leave a customer CHARGED for SMS and not
        // granted it, silently — so it writes a monetization alert instead,
        // same idiom as the double-charge guard above. This should never fire:
        // the wizard stopped offering SMS on 2026-07-07, so it needs a session
        // that was crafted, not clicked.
        //
        // ⚠️ `snapshot.addons` is deliberately NOT filtered (half of the review's
        // proposed fix, rejected with reason). That array is the record of what
        // was PAID FOR, and it is what `assertPaidCeilingForUpdate` reads. If
        // SMS returns, stripping it here would make a customer who already paid
        // pay again; keeping it costs nothing today because no client path can
        // write `featuresUnlocked` (`shared/editability.ts` does not expose it).
        // So: the entitlement is withheld, the purchase record stays truthful.
        //
        // ⚠️ DECIDE HERE, WRITE LATER. A Firestore transaction requires every
        // read before every write, and a coupon `txn.get` runs below — an alert
        // `txn.set` here threw the whole transaction for any checkout that used
        // BOTH a coupon and an unsellable add-on (codex round 3). This block is
        // pure; the alert write sits with the other writes, after the reads.
        const { unlocked, soldWhileOff } = unsellableClampOutcome(
            rawUnlocked,
            Array.isArray(snapshot?.addons) ? snapshot!.addons : [],
        );

        // Confirm coupon reservation (flip pending → confirmed) in this txn.
        if (couponCode && reservationId) {
            const code = couponCode.toUpperCase().trim();
            const cSnap = await txn.get(db.collection("coupons").where("code", "==", code).limit(1));
            if (!cSnap.empty) {
                const cRef = cSnap.docs[0].ref;
                const cLog = (cSnap.docs[0].data() as any).usageLog as CouponUsageEntry[] | undefined;
                const t = transitionReservation(cLog, reservationId, "confirmed", Date.now(), sessionId);
                if (t.changed) txn.update(cRef, { usageLog: t.usageLog });
            }
        }

        // Deferred from the clamp above: all reads are done, so it is safe to
        // write. Records the money discrepancy (charged for an add-on whose
        // entitlement we are withholding) for refund review, rather than
        // withholding it silently.
        if (soldWhileOff.length > 0) {
            txn.set(db.collection("monetization_alerts").doc(`UNSELLABLE_ADDON_SOLD_${sessionId}`), {
                type: "UNSELLABLE_ADDON_SOLD",
                addons: soldWhileOff,
                poolId,
                userId,
                sessionId,
                paymentIntentId: paymentIntentId ?? null,
                amount,
                status: "open",
                createdAt: Date.now(),
            }, { merge: true });
            console.warn(`[Stripe Webhook] Unsellable add-on(s) ${soldWhileOff.join(",")} arrived on session ${sessionId} for pool ${poolId}; entitlement withheld, alert written for refund review.`);
        }

        /**
         * 🛑 MERGE, NEVER REPLACE.
         *
         * `billing.featuresUnlocked` and `billing.paid.addons` used to be
         * written wholesale from the session snapshot. On the hosting path that
         * silently revoked a super-admin grant made BEFORE activation
         * (adminSetPoolFeature can grant on a free or trial pool); on the add-on
         * path it would revoke every add-on the pool had already bought. Both
         * are the same defect, so both paths union.
         */
        const priorUnlocked = (billing?.featuresUnlocked ?? {}) as Record<string, boolean>;
        const mergedUnlocked: Record<string, boolean> = { ...priorUnlocked };
        for (const [key, on] of Object.entries(unlocked)) {
            if (on === true) mergedUnlocked[key] = true;
            else if (mergedUnlocked[key] !== true) mergedUnlocked[key] = false;
        }
        const paidBefore = billing?.paid as { addons?: unknown } | undefined;
        const priorPaidAddons: string[] = Array.isArray(paidBefore?.addons)
            ? (paidBefore!.addons as string[])
            : [];
        const mergedPaidAddons = Array.from(new Set([...priorPaidAddons, ...(snapshot?.addons ?? [])]));

        /**
         * codex r2 [P2] — THE OWNERSHIP SNAPSHOT IS TAKEN AT CHECKOUT AND CAN GO
         * STALE WHILE THE CUSTOMER IS ON STRIPE.
         *
         * `createCheckoutSession` reads what the pool owns and drops those
         * add-ons before pricing. If Kevin then grants one of the remaining
         * add-ons with `adminSetPoolFeature` before the commissioner finishes
         * paying, the merge below is still CORRECT — they end up owning it — but
         * they have been charged for something that became free in between.
         *
         * The money is already taken by the time this webhook runs, so nothing
         * here can prevent the charge. What it can do is refuse to let the
         * discrepancy be silent: same idiom as the UNSELLABLE_ADDON_SOLD alert
         * above, which exists for exactly this class of problem.
         *
         * ⚠️ Read from `priorUnlocked` — the pool AS READ IN THIS TRANSACTION —
         * never from the session's snapshot, which is the stale value.
         */
        const grantedWhilePending = isAddonPurchase
            ? (snapshot?.addons ?? []).filter((k) => priorUnlocked[k] === true)
            : [];
        if (grantedWhilePending.length > 0) {
            txn.set(db.collection("monetization_alerts").doc(`ADDON_ALREADY_OWNED_${sessionId}`), {
                type: "ADDON_ALREADY_OWNED",
                addons: grantedWhilePending,
                poolId,
                userId,
                sessionId,
                paymentIntentId: paymentIntentId ?? null,
                amount,
                status: "open",
                createdAt: Date.now(),
            }, { merge: true });
            console.warn(`[Stripe Webhook] Add-on(s) ${grantedWhilePending.join(",")} were already granted on pool ${poolId} before session ${sessionId} completed; entitlement stands, alert written for refund review.`);
        }

        if (isAddonPurchase) {
            // Entitlement + ceiling + money. NOT status, NOT tier, NOT the seat
            // cap: the pool's hosting was bought already and this purchase does
            // not renegotiate it.
            txn.update(poolRef, {
                "billing.pricePaid": ((billing?.pricePaid as number) || 0) + amount,
                "billing.pendingSessionId": FieldValue.delete(),
                "billing.featuresUnlocked": mergedUnlocked,
                "billing.paid.addons": mergedPaidAddons,
                "billing.paid.at": Date.now(),
            });
        } else {
            // Activate pool + copy pending snapshot → billing.paid + featuresUnlocked.
            txn.update(poolRef, {
                "billing.status": "active",
                "billing.pricePaid": ((billing?.pricePaid as number) || 0) + amount,
                "billing.stripeSessionId": sessionId,
                "billing.tier": tier,
                "billing.maxPlayersAllowed": maxPlayersAllowed,
                "billing.pendingSessionId": FieldValue.delete(),
                "billing.featuresUnlocked": mergedUnlocked,
                "billing.paid": {
                    tier,
                    maxPlayersAllowed,
                    addons: mergedPaidAddons,
                    at: Date.now(),
                },
            });
        }

        if (sessionRef) {
            txn.set(sessionRef, { status: "confirmed", sessionId, confirmedAt: Date.now() }, { merge: true });
        }

        // Ledger row IN THE SAME TXN (failure fails the webhook → Stripe retries).
        const charge: BillingCharge = {
            userId, kind: "pool", amount, poolId,
            tier, couponCode: couponCode?.toUpperCase().trim(),
            stripeSessionId: sessionId,
            paymentIntentId,
        };
        writeBillingChargeTxn(txn, db, charge);
    });
    if (doubleCharge) {
        captureMonetizationAlert("DOUBLE_CHARGE_REVIEW", { poolId, userId, sessionId, paymentIntentId, amount });
        await dispatchOpsAlert(db, {
            type: "DOUBLE_CHARGE_REVIEW",
            title: "Double-charge review needed",
            message: `Session ${sessionId} arrived for already-active pool ${poolId}. Charge was no-op'd; review in Super-Admin → Monetization → Alerts.`,
            context: { poolId, userId, sessionId, paymentIntentId, amount },
        });
    } else {
        console.log(`[Stripe Webhook] Pool ${poolId} activated via session ${sessionId}`);
    }
}

/** Best-effort reservation release (decrement usesCount + status:'released') + clear pool pending marker. */
async function releaseReservationBestEffort(reservationId: string, poolId: string, couponCode?: string): Promise<void> {
    await db.runTransaction(async (txn) => {
        // Release coupon reservation.
        if (couponCode) {
            const code = couponCode.toUpperCase().trim();
            const cSnap = await txn.get(db.collection("coupons").where("code", "==", code).limit(1));
            if (!cSnap.empty) {
                const cRef = cSnap.docs[0].ref;
                const cLog = (cSnap.docs[0].data() as any).usageLog as CouponUsageEntry[] | undefined;
                const t = transitionReservation(cLog, reservationId, "released", Date.now());
                if (t.changed) {
                    txn.update(cRef, { usageLog: t.usageLog, usesCount: FieldValue.increment(-1) });
                }
            }
        }
        // Clear pending marker + mark session record released.
        const poolRef = db.collection("pools").doc(poolId);
        const poolSnap = await txn.get(poolRef);
        const pending = (poolSnap.data() as any)?.billing?.pendingSessionId as { reservationId?: string } | undefined;
        if (pending?.reservationId === reservationId) {
            txn.update(poolRef, { "billing.pendingSessionId": FieldValue.delete() });
        }
        txn.set(db.collection("checkoutSessions").doc(reservationId), { status: "released", releasedAt: Date.now() }, { merge: true });
    });
}

// =============================================================================
// 2. handleStripeWebhook — HTTP Request Handler (onRequest v2)
// =============================================================================

export const handleStripeWebhook = functions.https.onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"] as string;
    if (!sig) {
        console.error("[Stripe Webhook] Missing stripe-signature header");
        res.status(400).send("Missing stripe-signature header");
        return;
    }

    let event: any;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
    } catch (err: any) {
        console.error("[Stripe Webhook] Signature verification failed:", err?.message);
        res.status(400).send(`Webhook Error: ${err?.message}`);
        return;
    }

    // Idempotency marker AND failure record for all handled event types.
    const evtRef = db.collection("stripeWebhookEvents").doc(event.id);
    const claimEvent = async (): Promise<boolean> => {
        try {
            await evtRef.create({ type: event.type, status: "processing", startedAt: Date.now(), attemptCount: 0 });
            return true;
        } catch (err: any) {
            if (err.code === 6) { // ALREADY_EXISTS
                let take = false;
                await db.runTransaction(async (t) => {
                    const s = await t.get(evtRef);
                    const decision = decideEventClaim(s.data() as WebhookEventDoc | undefined, Date.now());
                    if (decision.take) {
                        // Re-claim: bump startedAt so a concurrent stale-takeover can't also grab it.
                        // set/merge (not update) so the "no-doc" case — the doc was deleted between
                        // the failed create() and this read — recreates it instead of throwing.
                        t.set(evtRef, { type: event.type, status: "processing", startedAt: Date.now() }, { merge: true });
                        take = true;
                    }
                });
                return take;
            }
            throw err;
        }
    };
    const markDone = () => evtRef.update({ status: "completed", processedAt: Date.now() });
    // Persist failure state (do NOT delete — Stripe retries the same event.id,
    // so this de-dupes naturally). Increment attemptCount; alert ops only once
    // failures cross the threshold, not on every retry (Codex #5).
    const markFailed = async (err: unknown): Promise<void> => {
        const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        let attemptCount = 0;
        let alerted = false;
        await db.runTransaction(async (t) => {
            attemptCount = 0;
            alerted = false;
            const s = await t.get(evtRef);
            attemptCount = ((s.data()?.attemptCount as number) ?? 0) + 1;
            t.set(evtRef, {
                type: event.type,
                status: "failed",
                attemptCount,
                lastError,
                lastFailedAt: Date.now(),
            }, { merge: true });
            if (shouldAlertOnFailure(attemptCount)) {
                alerted = true;
                t.set(db.collection("monetization_alerts").doc(`WEBHOOK_FAILED_${event.id}`), {
                    type: "WEBHOOK_FAILED",
                    eventId: event.id,
                    eventType: event.type,
                    attemptCount,
                    lastError,
                    status: "open",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }, { merge: true });
            }
        });
        if (alerted) {
            captureMonetizationAlert("WEBHOOK_FAILED", { eventId: event.id, eventType: event.type, attemptCount, lastError });
            await dispatchOpsAlert(db, {
                type: "WEBHOOK_FAILED",
                title: "Stripe webhook failing repeatedly",
                message: `Event ${event.id} (${event.type}) has failed ${attemptCount} time(s). ${lastError}`,
                context: { eventId: event.id, eventType: event.type, attemptCount },
            });
        }
        console.error(`[Stripe Webhook] Event ${event.id} (${event.type}) failed, attempt ${attemptCount}: ${lastError}`);
    };

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                if (!(await claimEvent())) {
                    console.log(`[Stripe Webhook] Duplicate/concurrent event ignored: ${event.id}`);
                    res.status(200).send("duplicate");
                    return;
                }
                const session = event.data.object;
                const metadata = session.metadata || {};

                // Bundle purchase — grant into the canonical entitlement model.
                // The bundle + credit docs + the ledger row are written in ONE
                // transaction (grantBundle); a failure fails the webhook and
                // Stripe retries. The grant is idempotent on the session id.
                if (metadata.bundleType) {
                    try {
                        await grantBundle(metadata.userId, metadata.bundleType, {
                            stripeSessionId: session.id,
                            paymentIntentId: session.payment_intent as string | undefined,
                            amount: (session.amount_total || 0) / 100,
                        });
                    } catch (err) {
                        console.error("[Stripe Webhook] Bundle grant failed:", err);
                        await markFailed(err);
                        res.status(500).send("Internal error processing bundle payment");
                        return;
                    }
                    await markDone();
                    break;
                }

                // Standard pool purchase.
                if (!metadata.poolId || !metadata.userId) {
                    console.error("[Stripe Webhook] Missing poolId/userId:", session.id);
                    // Ack (don't retry) — nothing we can do with this session.
                    await markDone();
                    res.status(200).send("missing metadata");
                    return;
                }
                try {
                    await finalizePoolPayment({
                        sessionId: session.id,
                        paymentIntentId: session.payment_intent as string | undefined,
                        amountTotalCents: session.amount_total || 0,
                        metadata,
                    });
                } catch (err) {
                    console.error("[Stripe Webhook] Pool finalize failed (will retry):", err);
                    await markFailed(err);
                    res.status(500).send("Internal error processing payment");
                    return;
                }
                await markDone();
                break;
            }

            case "checkout.session.expired": {
                if (!(await claimEvent())) {
                    res.status(200).send("duplicate");
                    return;
                }
                const session = event.data.object;
                const metadata = session.metadata || {};
                const reservationId = metadata.reservationId as string | undefined;
                const poolId = metadata.poolId as string | undefined;
                const couponCode = (metadata.couponCode as string) || undefined;
                if (reservationId && poolId) {
                    try {
                        await releaseReservationBestEffort(reservationId, poolId, couponCode);
                        console.log(`[Stripe Webhook] Reservation ${reservationId} released on session expiry.`);
                    } catch (err) {
                        console.error("[Stripe Webhook] Expiry release failed (will retry):", err);
                        await markFailed(err);
                        res.status(500).send("Internal error processing expiry");
                        return;
                    }
                }
                await markDone();
                break;
            }

            case "charge.refunded": {
                if (!(await claimEvent())) {
                    res.status(200).send("duplicate");
                    return;
                }
                try {
                    await handleChargeAdjustment(event.data.object, "refund");
                } catch (err) {
                    console.error("[Stripe Webhook] Refund handling failed (will retry):", err);
                    await markFailed(err);
                    res.status(500).send("Internal error processing refund");
                    return;
                }
                await markDone();
                break;
            }

            case "charge.dispute.created": {
                if (!(await claimEvent())) {
                    res.status(200).send("duplicate");
                    return;
                }
                try {
                    // Dispute event.data.object is a Dispute; its `charge` is the charge id.
                    await handleDispute(event.data.object);
                } catch (err) {
                    console.error("[Stripe Webhook] Dispute handling failed (will retry):", err);
                    await markFailed(err);
                    res.status(500).send("Internal error processing dispute");
                    return;
                }
                await markDone();
                break;
            }

            case "checkout.session.async_payment_failed": {
                // A delayed payment method (e.g. ACH) failed AFTER checkout. The
                // pool/bundle was never finalized (that only happens on
                // completed), so release any held reservation and surface an ops
                // alert. Member-facing "your payment failed" UX is a separate
                // product decision (PLAN #7 open question) — not built here.
                if (!(await claimEvent())) {
                    res.status(200).send("duplicate");
                    return;
                }
                const session = event.data.object;
                const metadata = session.metadata || {};
                const reservationId = metadata.reservationId as string | undefined;
                const poolId = metadata.poolId as string | undefined;
                const couponCode = (metadata.couponCode as string) || undefined;
                try {
                    if (reservationId && poolId) {
                        await releaseReservationBestEffort(reservationId, poolId, couponCode);
                    }
                    await db.collection("monetization_alerts").doc(`ASYNC_PAYMENT_FAILED_${session.id}`).set({
                        type: "ASYNC_PAYMENT_FAILED",
                        sessionId: session.id,
                        paymentIntentId: (session.payment_intent as string) ?? null,
                        poolId: poolId ?? null,
                        userId: (metadata.userId as string) ?? null,
                        status: "open",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    }, { merge: true });
                    captureMonetizationAlert("ASYNC_PAYMENT_FAILED", {
                        sessionId: session.id,
                        paymentIntentId: (session.payment_intent as string) ?? null,
                        poolId: poolId ?? null,
                    });
                    await dispatchOpsAlert(db, {
                        type: "ASYNC_PAYMENT_FAILED",
                        title: "Async payment failed",
                        message: `Checkout session ${session.id} (pool ${poolId ?? "n/a"}) async payment failed. Any held reservation was released.`,
                        context: { sessionId: session.id, poolId: poolId ?? null },
                    });
                } catch (err) {
                    console.error("[Stripe Webhook] async_payment_failed handling failed (will retry):", err);
                    await markFailed(err);
                    res.status(500).send("Internal error processing async payment failure");
                    return;
                }
                await markDone();
                break;
            }

            case "payment_intent.payment_failed": {
                // A PaymentIntent failed. Record an ops alert for visibility; no
                // reservation is keyed by PI, and member-facing UX is deferred
                // (PLAN #7). Handling it explicitly stops it falling through to
                // the silent default branch.
                if (!(await claimEvent())) {
                    res.status(200).send("duplicate");
                    return;
                }
                const pi = event.data.object;
                try {
                    await db.collection("monetization_alerts").doc(`PAYMENT_FAILED_${pi.id}`).set({
                        type: "PAYMENT_FAILED",
                        paymentIntentId: pi.id,
                        amount: (pi.amount ?? 0) / 100,
                        lastPaymentError: (pi.last_payment_error?.message as string) ?? null,
                        userId: (pi.metadata?.userId as string) ?? null,
                        poolId: (pi.metadata?.poolId as string) ?? null,
                        status: "open",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    }, { merge: true });
                    captureMonetizationAlert("PAYMENT_FAILED", {
                        paymentIntentId: pi.id,
                        amount: (pi.amount ?? 0) / 100,
                        poolId: (pi.metadata?.poolId as string) ?? null,
                    });
                    await dispatchOpsAlert(db, {
                        type: "PAYMENT_FAILED",
                        title: "Payment intent failed",
                        message: `PaymentIntent ${pi.id} failed: ${(pi.last_payment_error?.message as string) ?? "(no error message)"}`,
                        context: { paymentIntentId: pi.id, poolId: (pi.metadata?.poolId as string) ?? null },
                    });
                } catch (err) {
                    console.error("[Stripe Webhook] payment_failed handling failed (will retry):", err);
                    await markFailed(err);
                    res.status(500).send("Internal error processing payment failure");
                    return;
                }
                await markDone();
                break;
            }

            default:
                console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        }
    } catch (err: any) {
        console.error("[Stripe Webhook] Unhandled processing error:", err?.message);
        res.status(500).send("Internal error");
        return;
    }

    res.status(200).json({ received: true });
});

/**
 * Writes a linked negative-amount adjustment ledger row for a refund or dispute
 * (keyed off charge/payment_intent, NOT session), marks the original charge row,
 * and writes a monetization alert for admin. Does NOT auto-lock the pool.
 */
async function handleChargeAdjustment(charge: any, kind: "refund" | "dispute"): Promise<void> {
    const chargeId = charge.id as string;
    const paymentIntentId = charge.payment_intent as string | undefined;
    // Refunded amount (partial or full) in dollars; negative for the adjustment.
    const refundedCents = kind === "refund"
        ? (charge.amount_refunded ?? charge.amount ?? 0)
        : (charge.amount ?? 0);
    const adjustment = -(refundedCents / 100);

    // Set inside the txn (reset each attempt), read after commit — same
    // never-call-out-from-inside-a-txn pattern as finalizePoolPayment (PLAN #10).
    let alertContext: { userId: string; poolId: string | null } = { userId: "unknown", poolId: null };
    await db.runTransaction(async (txn) => {
        alertContext = { userId: "unknown", poolId: null };
        // Find the original charge row by paymentIntentId (fall back to chargeId).
        let original: FirebaseFirestore.QueryDocumentSnapshot | undefined;
        if (paymentIntentId) {
            const q = await txn.get(db.collection("billingCharges").where("paymentIntentId", "==", paymentIntentId).limit(1));
            if (!q.empty) original = q.docs[0];
        }
        const relatedChargeId = original?.id || paymentIntentId || chargeId;
        const userId = (original?.data()?.userId as string) || "unknown";
        const poolId = (original?.data()?.poolId as string) || null;
        const bundleType = (original?.data()?.bundleType as string) || null;
        alertContext = { userId, poolId };

        // Mark the original.
        if (original) {
            txn.update(original.ref, kind === "refund" ? { refunded: true, refundedAt: Date.now() } : { disputed: true, disputedAt: Date.now() });
        }

        // Negative adjustment row (idempotent doc id refund_/dispute_<chargeId>).
        writeBillingChargeTxn(txn, db, {
            userId, kind, amount: adjustment,
            poolId: poolId || undefined, bundleType: bundleType || undefined,
            chargeId, paymentIntentId, relatedChargeId,
        });

        // Admin alert (no auto-lock; admin decides).
        txn.set(db.collection("monetization_alerts").doc(`${kind.toUpperCase()}_${chargeId}`), {
            type: kind === "refund" ? "REFUND" : "DISPUTE",
            chargeId,
            paymentIntentId: paymentIntentId ?? null,
            relatedChargeId,
            poolId,
            bundleType,
            userId,
            amount: adjustment,
            status: "open",
            createdAt: Date.now(),
        }, { merge: true });
    });
    const alertType = kind === "refund" ? "REFUND" : "DISPUTE";
    captureMonetizationAlert(alertType, {
        chargeId, paymentIntentId: paymentIntentId ?? null, amount: adjustment, ...alertContext,
    });
    await dispatchOpsAlert(db, {
        type: alertType,
        title: kind === "refund" ? "Refund recorded" : "Dispute opened",
        message: `${kind === "refund" ? "Refund" : "Dispute"} adjustment ${adjustment} recorded for charge ${chargeId}.`,
        context: { chargeId, paymentIntentId: paymentIntentId ?? null, amount: adjustment, ...alertContext },
    });
    console.log(`[Stripe Webhook] ${kind} adjustment recorded for charge ${chargeId} (${adjustment}).`);
}

/** Dispute event carries a Dispute object; normalize to the charge shape. */
async function handleDispute(dispute: any): Promise<void> {
    await handleChargeAdjustment(
        { id: dispute.charge, payment_intent: dispute.payment_intent, amount: dispute.amount },
        "dispute"
    );
}

// =============================================================================
// 3. releaseStaleCouponReservations — Scheduled sweep (ADR-0002 step 4)
//    Releases any 'pending' reservation older than 24h. Kill-switch + dry-run by
//    default (mirrors autoClosePools): does nothing unless
//    system/config.couponSweep.enabled === true; reports-only unless
//    dryRun === false; config-read failure = disabled.
// =============================================================================

const STALE_RESERVATION_MS = 24 * 60 * 60 * 1000;

export const releaseStaleCouponReservations = functions.scheduler.onSchedule(
    { schedule: "every 30 minutes", timeoutSeconds: 300, memory: "512MiB" },
    withHeartbeat('releaseStaleCouponReservations', async () => {
        let enabled = false;
        let dryRun = true;
        try {
            const cfg = (await db.doc("system/config").get()).data()?.couponSweep as
                | { enabled?: boolean; dryRun?: boolean }
                | undefined;
            enabled = cfg?.enabled === true;
            dryRun = cfg?.dryRun !== false;
        } catch (e) {
            console.warn("[couponSweep] config read failed; staying disabled:", e);
        }
        if (!enabled) {
            console.log("[couponSweep] disabled (system/config.couponSweep.enabled !== true); nothing to do.");
            return;
        }

        const cutoff = Date.now() - STALE_RESERVATION_MS;
        // Only coupons with at least one usage entry can have stale reservations.
        const couponsSnap = await db.collection("coupons").get();
        let scanned = 0;
        let released = 0;

        for (const doc of couponsSnap.docs) {
            const log = (doc.data().usageLog as CouponUsageEntry[]) || [];
            const staleIds = stalePendingReservationIds(log, cutoff);
            if (staleIds.length === 0) continue;
            scanned += staleIds.length;

            if (dryRun) {
                console.log(`[couponSweep] DRY-RUN: coupon ${doc.id} has ${staleIds.length} stale pending reservation(s): ${staleIds.join(", ")}`);
                continue;
            }

            try {
                await db.runTransaction(async (txn) => {
                    const fresh = await txn.get(doc.ref);
                    let workingLog = (fresh.data()?.usageLog as CouponUsageEntry[]) || [];
                    let decrement = 0;
                    for (const rid of stalePendingReservationIds(workingLog, cutoff)) {
                        const t = transitionReservation(workingLog, rid, "released", Date.now());
                        if (t.changed) {
                            workingLog = t.usageLog;
                            decrement++;
                        }
                    }
                    if (decrement > 0) {
                        txn.update(doc.ref, { usageLog: workingLog, usesCount: FieldValue.increment(-decrement) });
                    }
                    released += decrement;
                });
            } catch (e) {
                console.error(`[couponSweep] failed to release for coupon ${doc.id}:`, e);
            }
        }

        console.log(`[couponSweep] complete. ${dryRun ? "DRY-RUN " : ""}scanned=${scanned} released=${released}`);
    })
);
