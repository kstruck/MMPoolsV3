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
let stripeInstance: Stripe | null = null;
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
//    Creates a Stripe Checkout Session for one-time pool payment
// =============================================================================

interface CheckoutSessionRequest {
    poolId: string;
    poolName: string;
    poolType: string;
    tier: string;
    price: number;
    couponCode?: string;
    referralCredits?: number;
}

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
    } = request.data as CheckoutSessionRequest;

    // --- Validate Required Fields ---
    if (!poolId || !poolName || !tier || price === undefined) {
        throw new HttpsError("invalid-argument", "poolId, poolName, tier, and price are required.");
    }

    if (price < 0) {
        throw new HttpsError("invalid-argument", "Price must be non-negative.");
    }

    // --- Verify pool exists ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Pool not found.");
    }

    // --- Build the base URL for redirect ---
    // Dynamically resolve based on request origin to support local dev, staging, and custom domains
    const rawOrigin = (request.rawRequest?.headers?.origin as string) || (request.rawRequest?.headers?.referer as string) || "https://marchmelee.com";
    const originUrl = rawOrigin.endsWith("/") ? rawOrigin.slice(0, -1) : rawOrigin;
    
    // If the referer/origin is a full URL path, clean it up to just be the protocol + host
    let cleanedOrigin = originUrl;
    try {
        const urlObj = new URL(originUrl);
        cleanedOrigin = `${urlObj.protocol}//${urlObj.host}`;
    } catch {
        // Fallback to originUrl if parsing fails
    }
    
    const baseUrl = `${cleanedOrigin}/pool/${poolId}`;

    // --- Secure $0 Stripe Bypass for 100% Off Coupons ---
    if (price === 0) {
        const poolRef = db.collection("pools").doc(poolId);
        await poolRef.update({
            "billing.status": "active",
            "billing.pricePaid": 0,
            "billing.stripeSessionId": "free_promo_bypass",
            "billing.tier": tier || "premium_tier",
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
            "billing.pricePaid": price,
            "billing.stripeSessionId": `mock_local_dev_session_${Date.now()}`,
            "billing.tier": tier || "premium_tier",
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
                        unit_amount: Math.round(price * 100), // Convert dollars to cents
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
    // Only accept POST requests
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

    // --- Verify Webhook Signature ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // --- Handle Event Types ---
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const metadata = session.metadata || {};

            const poolId = metadata.poolId;
            const userId = metadata.userId;
            const tier = metadata.tier;
            const couponCode = metadata.couponCode;

            if (!poolId || !userId) {
                console.error("[Stripe Webhook] Missing poolId or userId in session metadata:", session.id);
                res.status(400).send("Missing required metadata");
                return;
            }

            console.log(`[Stripe Webhook] checkout.session.completed — Pool: ${poolId}, User: ${userId}, Tier: ${tier}`);

            try {
                // --- Update pool billing status to active ---
                const poolRef = db.collection("pools").doc(poolId);
                await poolRef.update({
                    "billing.status": "active",
                    "billing.pricePaid": (session.amount_total || 0) / 100,
                    "billing.stripeSessionId": session.id,
                    "billing.tier": tier || "standard_tier",
                });

                console.log(`[Stripe Webhook] Pool ${poolId} billing updated to active`);

                // --- Process coupon usage if couponCode is present ---
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
                        // Log but don't fail the webhook — payment was already successful
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
            // Unhandled event type — acknowledge receipt
            console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });
});
