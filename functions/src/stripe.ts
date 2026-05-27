// TODO: Run 'npm install stripe' in functions/ before deploying
// TODO: Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Firebase environment config

import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { defineString } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";

import Stripe from "stripe";

const db = admin.firestore();

// --- Stripe Config Params ---
const stripeSecretKey = defineString("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineString("STRIPE_WEBHOOK_SECRET");

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
// 1. createCheckoutSession — Callable Function (onCall v2)
//    Creates a Stripe Checkout Session for one-time pool payment or packages/bundles
// =============================================================================

export const createCheckoutSession = functions.https.onCall({ cors: true }, async (request) => {
    // --- Auth Check ---
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be signed in to create a checkout session.");
    }

    const userId = request.auth.uid;
    const {
        poolId,
        poolName,
        poolType,
        tier,
        price,
        couponCode,
        referralCredits,
        maxPlayersAllowed,
        bundleType, // buy_3 or unlimited_1yr
        usedCredit, // boolean indicating if they are applying a pool credit
        customCreditId, // dynamic dynamic credit ID
    } = request.data as any;

    const isBundlePurchase = !!bundleType;

    // --- Validate Required Fields ---
    if (isBundlePurchase) {
        if (price === undefined || price < 0) {
            throw new HttpsError("invalid-argument", "Price is required for bundle purchase.");
        }
    } else {
        if (!poolId || !poolName || !tier || price === undefined) {
            throw new HttpsError("invalid-argument", "poolId, poolName, tier, and price are required.");
        }
        if (price < 0) {
            throw new HttpsError("invalid-argument", "Price must be non-negative.");
        }
    }

    // --- Build the base URL for redirect ---
    const rawOrigin = (request.rawRequest?.headers?.origin as string) || (request.rawRequest?.headers?.referer as string) || "https://marchmelee.com";
    const originUrl = rawOrigin.endsWith("/") ? rawOrigin.slice(0, -1) : rawOrigin;
    
    let cleanedOrigin = originUrl;
    try {
        const urlObj = new URL(originUrl);
        cleanedOrigin = `${urlObj.protocol}//${urlObj.host}`;
    } catch {
        // Fallback
    }

    // --- Bundle Purchase Path ---
    if (isBundlePurchase) {
        const baseUrl = `${cleanedOrigin}/pricing`;
        const stripe = getStripe();

        if (!stripe) {
            console.log(`[Stripe Mockup] STRIPE_SECRET_KEY is missing/placeholder. Activating mock dev sandbox bundle checkout for ${bundleType}.`);
            const mockUrl = `${baseUrl}?payment=success&session_id=mock_bundle_session_${Date.now()}`;
            
            const userRef = db.collection("users").doc(userId);
            if (bundleType === "buy_3") {
                await userRef.update({
                    freePoolsAvailable: admin.firestore.FieldValue.increment(3),
                    role: "POOL_MANAGER"
                });
            } else if (bundleType === "unlimited_1yr") {
                await userRef.update({
                    activeBundleType: "unlimited_1yr",
                    bundleExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
                    role: "POOL_MANAGER"
                });
            } else {
                // Dynamic Admin Bundle Mock Checkout Payout
                let dynamicBundle: any = null;
                try {
                    const billingConfigDoc = await db.collection("settings").doc("billing_config").get();
                    const packagesList = billingConfigDoc.data()?.packagesList || [];
                    dynamicBundle = packagesList.find((b: any) => b.id === bundleType);
                } catch (err) {
                    console.error("Failed to query dynamic bundle config inside sandbox checkout:", err);
                }

                if (dynamicBundle) {
                    const creditsSpawned = [];
                    const validityDays = Number(dynamicBundle.durationDays) || 0;
                    const expiresAt = validityDays > 0 ? Date.now() + validityDays * 24 * 60 * 60 * 1000 : 0;
                    
                    for (let i = 0; i < dynamicBundle.poolsIncluded; i++) {
                        creditsSpawned.push({
                            id: `credit_${bundleType}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            bundleId: bundleType,
                            poolType: dynamicBundle.poolType,
                            maxPlayersPerPool: Number(dynamicBundle.maxPlayersPerPool) || 50,
                            expiresAt,
                            isUsed: false
                        });
                    }
                    
                    await userRef.update({
                        poolCredits: admin.firestore.FieldValue.arrayUnion(...creditsSpawned),
                        role: "POOL_MANAGER"
                    });
                    console.log(`[Dynamic Bundle Mock] Credited user ${userId} with ${dynamicBundle.poolsIncluded} pool credits for bundle ${bundleType}`);
                }
            }

            return { sessionUrl: mockUrl };
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
                                name: bundleType === "buy_3" ? "3-Pool Bundle Package" : "1-Year Unlimited Pool Pass",
                                description: bundleType === "buy_3" ? "Get 3 pool credits to use on any pool type" : "Create unlimited pools of any type for 1 year",
                            },
                            unit_amount: Math.round(price * 100),
                        },
                        quantity: 1,
                    },
                ],
                success_url: `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${baseUrl}?payment=cancelled`,
                metadata: {
                    userId,
                    bundleType,
                },
                customer_email: request.auth.token.email || undefined,
            });

            console.log(`[Stripe] Bundle checkout session created: ${session.id} for user ${userId}`);
            return { sessionUrl: session.url };
        } catch (err: any) {
            console.error("[Stripe] Bundle Checkout Error:", err);
            throw new HttpsError("internal", `Failed to create bundle checkout session: ${err.message}`);
        }
    }

    // --- Standard Pool Purchase Path ---
    // --- Verify pool exists ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    const poolData = typeof poolDoc.data === "function" ? poolDoc.data() : ((poolDoc as any).data || {});
    const existingPricePaid = poolData?.billing?.pricePaid || 0;
    const baseUrl = `${cleanedOrigin}/pool/${poolId}`;

    // --- Enforce 1 Free Pool limit ---
    if (tier === "free_tier") {
        const activeFreePoolsSnap = await db.collection("pools")
            .where("ownerId", "==", userId)
            .where("billing.status", "==", "active")
            .where("billing.tier", "==", "free_tier")
            .get();
        
        const activeFreePools = activeFreePoolsSnap.docs.filter(doc => doc.id !== poolId);
        if (activeFreePools.length > 0) {
            throw new HttpsError("failed-precondition", "You already have an active free pool. You are only allowed 1 active free pool at any time.");
        }
    }

    // --- Verify and deduct credits if used ---
    if (usedCredit) {
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.data();
        if (customCreditId) {
            const poolCredits = userData?.poolCredits || [];
            const creditObj = poolCredits.find((c: any) => c.id === customCreditId);
            if (!creditObj || creditObj.isUsed) {
                throw new HttpsError("failed-precondition", "Specific custom pool credit is missing or already used.");
            }
        } else {
            const freePoolsAvailable = userData?.freePoolsAvailable || 0;
            if (freePoolsAvailable <= 0) {
                throw new HttpsError("failed-precondition", "No universal pool credits available.");
            }
        }
    }

    // --- Secure $0 Stripe Bypass for 100% Off Coupons, Credit usage, or Unlimited Pass ---
    if (price === 0) {
        const poolRef = db.collection("pools").doc(poolId);
        await poolRef.update({
            "billing.status": "active",
            "billing.pricePaid": existingPricePaid + 0,
            "billing.stripeSessionId": usedCredit ? (customCreditId ? `pool_credit_use_${customCreditId}` : "pool_credit_use") : "free_promo_bypass",
            "billing.tier": tier || "premium_tier",
            "billing.maxPlayersAllowed": Number(maxPlayersAllowed) || 10,
        });

        if (usedCredit) {
            if (customCreditId) {
                const userDoc = await db.collection("users").doc(userId).get();
                const userData = userDoc.data();
                const poolCredits = userData?.poolCredits || [];
                const updatedCredits = poolCredits.map((c: any) => 
                    c.id === customCreditId ? { ...c, isUsed: true, usedForPoolId: poolId } : c
                );
                await db.collection("users").doc(userId).update({
                    poolCredits: updatedCredits
                });
                console.log(`[Custom Credit] User ${userId} used custom credit ${customCreditId} for pool ${poolId}`);
            } else {
                await db.collection("users").doc(userId).update({
                    freePoolsAvailable: admin.firestore.FieldValue.increment(-1)
                });
                console.log(`[Pool Credit] User ${userId} used a credit to activate pool ${poolId}`);
            }
        }

        if (couponCode) {
            try {
                const couponQuery = await db.collection("coupons")
                    .where("code", "==", couponCode)
                    .limit(1)
                    .get();

                if (!couponQuery.empty) {
                    const couponDoc = couponQuery.docs[0];
                    const usageEntry = { userId, poolId, usedAt: Date.now() };

                    await couponDoc.ref.update({
                        usesCount: admin.firestore.FieldValue.increment(1),
                        usageLog: admin.firestore.FieldValue.arrayUnion(usageEntry),
                    });
                    console.log(`[Stripe Bypass] Coupon ${couponCode} recorded for user ${userId}`);
                }
            } catch (couponErr) {
                console.error("[Stripe Bypass] Error processing coupon:", couponErr);
            }
        }

        console.log(`[Stripe Bypass] Pool ${poolId} activated for free by user ${userId}`);
        return { sessionUrl: `${baseUrl}?payment=success` };
    }

    // --- Create Stripe Checkout Session ---
    const stripe = getStripe();

    if (!stripe) {
        console.log(`[Stripe Mockup] STRIPE_SECRET_KEY is missing/placeholder. Activating mock dev sandbox checkout for pool ${poolId}.`);
        const mockUrl = `${baseUrl}?payment=success&session_id=mock_local_dev_session_${Date.now()}`;
        
        const poolRef = db.collection("pools").doc(poolId);
        await poolRef.update({
            "billing.status": "active",
            "billing.pricePaid": existingPricePaid + price,
            "billing.stripeSessionId": `mock_local_dev_session_${Date.now()}`,
            "billing.tier": tier || "premium_tier",
            "billing.maxPlayersAllowed": Number(maxPlayersAllowed) || 10,
        });

        if (couponCode) {
            try {
                const couponQuery = await db.collection("coupons")
                    .where("code", "==", couponCode)
                    .limit(1)
                    .get();

                if (!couponQuery.empty) {
                    const couponDoc = couponQuery.docs[0];
                    const usageEntry = { userId, poolId, usedAt: Date.now() };

                    await couponDoc.ref.update({
                        usesCount: admin.firestore.FieldValue.increment(1),
                        usageLog: admin.firestore.FieldValue.arrayUnion(usageEntry),
                    });
                    console.log(`[Stripe Mockup] Coupon ${couponCode} usage simulated for user ${userId}`);
                }
            } catch (couponErr) {
                console.error("[Stripe Mockup] Error simulating coupon:", couponErr);
            }
        }

        return { sessionUrl: mockUrl };
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
                            name: `${poolName} — ${tier === "premium_tier" ? "Premium" : "Standard"} Hosting`,
                            description: `One-time hosting fee for your ${poolType} pool`,
                        },
                        unit_amount: Math.round(price * 100),
                    },
                    quantity: 1,
                },
            ],
            success_url: `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}?payment=cancelled`,
            metadata: {
                poolId,
                userId,
                tier,
                poolType,
                couponCode: couponCode || "",
                referralCredits: referralCredits?.toString() || "0",
                maxPlayersAllowed: maxPlayersAllowed?.toString() || "10",
            },
            customer_email: request.auth.token.email || undefined,
        });

        console.log(`[Stripe] Checkout session created: ${session.id} for pool ${poolId} by user ${userId}`);
        return { sessionUrl: session.url };
    } catch (err: unknown) {
        const error = err as Error;
        console.error("[Stripe] Error creating checkout session:", error.message);
        throw new HttpsError("internal", `Failed to create checkout session: ${error.message}`);
    }
});

// =============================================================================
// 2. handleStripeWebhook — HTTP Request Handler (onRequest v2)
//    Receives and processes Stripe webhook events
// =============================================================================

export const handleStripeWebhook = functions.https.onRequest(async (req, res) => {
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
        event = stripe.webhooks.constructEvent(
            req.rawBody,
            sig,
            stripeWebhookSecret.value()
        );
    } catch (err: unknown) {
        const error = err as Error;
        console.error("[Stripe Webhook] Signature verification failed:", error.message);
        res.status(400).send(`Webhook Error: ${error.message}`);
        return;
    }

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const metadata = session.metadata || {};

            const userId = metadata.userId;
            const bundleType = metadata.bundleType;

            // --- Handle Bundle Purchase ---
            if (bundleType) {
                console.log(`[Stripe Webhook] checkout.session.completed — Bundle: ${bundleType}, User: ${userId}`);
                try {
                    const userRef = db.collection("users").doc(userId);
                    if (bundleType === "buy_3") {
                        await userRef.update({
                            freePoolsAvailable: admin.firestore.FieldValue.increment(3),
                            role: "POOL_MANAGER"
                        });
                    } else if (bundleType === "unlimited_1yr") {
                        await userRef.update({
                            activeBundleType: "unlimited_1yr",
                            bundleExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
                            role: "POOL_MANAGER"
                        });
                    } else {
                        // Dynamic Admin Bundle webhook completion
                        let dynamicBundle: any = null;
                        try {
                            const billingConfigDoc = await db.collection("settings").doc("billing_config").get();
                            const packagesList = billingConfigDoc.data()?.packagesList || [];
                            dynamicBundle = packagesList.find((b: any) => b.id === bundleType);
                        } catch (err) {
                            console.error("Failed to query dynamic bundle config inside Stripe webhook:", err);
                        }

                        if (dynamicBundle) {
                            const creditsSpawned = [];
                            const validityDays = Number(dynamicBundle.durationDays) || 0;
                            const expiresAt = validityDays > 0 ? Date.now() + validityDays * 24 * 60 * 60 * 1000 : 0;
                            
                            for (let i = 0; i < dynamicBundle.poolsIncluded; i++) {
                                creditsSpawned.push({
                                    id: `credit_${bundleType}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                                    bundleId: bundleType,
                                    poolType: dynamicBundle.poolType,
                                    maxPlayersPerPool: Number(dynamicBundle.maxPlayersPerPool) || 50,
                                    expiresAt,
                                    isUsed: false
                                });
                            }
                            
                            await userRef.update({
                                poolCredits: admin.firestore.FieldValue.arrayUnion(...creditsSpawned),
                                role: "POOL_MANAGER"
                            });
                            console.log(`[Stripe Webhook] Credited user ${userId} with ${dynamicBundle.poolsIncluded} pool credits for bundle ${bundleType}`);
                        }
                    }
                    console.log(`[Stripe Webhook] User ${userId} bundle ${bundleType} successfully activated`);
                } catch (err) {
                    console.error("[Stripe Webhook] Error updating user bundle:", err);
                    res.status(500).send("Internal error processing bundle payment");
                    return;
                }
                break;
            }

            // --- Handle Standard Pool Purchase ---
            const poolId = metadata.poolId;
            const tier = metadata.tier;
            const couponCode = metadata.couponCode;
            const maxPlayersAllowed = Number(metadata.maxPlayersAllowed) || 10;

            if (!poolId || !userId) {
                console.error("[Stripe Webhook] Missing poolId or userId in session metadata:", session.id);
                res.status(400).send("Missing required metadata");
                return;
            }

            console.log(`[Stripe Webhook] checkout.session.completed — Pool: ${poolId}, User: ${userId}, Tier: ${tier}, MaxPlayers: ${maxPlayersAllowed}`);

            try {
                const poolRef = db.collection("pools").doc(poolId);
                const poolSnap = await poolRef.get();
                const existingPricePaid = poolSnap.data()?.billing?.pricePaid || 0;

                await poolRef.update({
                    "billing.status": "active",
                    "billing.pricePaid": existingPricePaid + ((session.amount_total || 0) / 100),
                    "billing.stripeSessionId": session.id,
                    "billing.tier": tier || "standard_tier",
                    "billing.maxPlayersAllowed": maxPlayersAllowed,
                });

                console.log(`[Stripe Webhook] Pool ${poolId} billing updated to active`);

                if (couponCode) {
                    try {
                        const couponQuery = await db.collection("coupons")
                            .where("code", "==", couponCode)
                            .limit(1)
                            .get();

                        if (!couponQuery.empty) {
                            const couponDoc = couponQuery.docs[0];
                            const usageEntry = { userId, poolId, usedAt: Date.now() };

                            await couponDoc.ref.update({
                                usesCount: admin.firestore.FieldValue.increment(1),
                                usageLog: admin.firestore.FieldValue.arrayUnion(usageEntry),
                            });

                            console.log(`[Stripe Webhook] Coupon ${couponCode} usage recorded for user ${userId}`);
                        }
                    } catch (couponErr) {
                        console.error("[Stripe Webhook] Error processing coupon:", couponErr);
                    }
                }
            } catch (err) {
                console.error("[Stripe Webhook] Error updating pool billing:", err);
                res.status(500).send("Internal error processing payment");
                return;
            }

            break;
        }

        default:
            console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
});
