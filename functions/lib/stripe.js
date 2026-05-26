"use strict";
// TODO: Run 'npm install stripe' in functions/ before deploying
// TODO: Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Firebase environment config
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStripeWebhook = exports.createCheckoutSession = void 0;
const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const db = admin.firestore();
// --- Stripe Config Params ---
const stripeSecretKey = (0, params_1.defineString)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineString)("STRIPE_WEBHOOK_SECRET");
// Stripe will be initialized at function invocation time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stripeInstance = null;
function getStripe() {
    if (!stripeInstance) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Stripe = require("stripe");
        stripeInstance = new Stripe(stripeSecretKey.value(), { apiVersion: "2024-12-18.acacia" });
    }
    return stripeInstance;
}
exports.createCheckoutSession = functions.https.onCall(async (request) => {
    // --- Auth Check ---
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to create a checkout session.");
    }
    const userId = request.auth.uid;
    const { poolId, poolName, poolType, tier, price, couponCode, referralCredits, } = request.data;
    // --- Validate Required Fields ---
    if (!poolId || !poolName || !tier || price === undefined) {
        throw new https_1.HttpsError("invalid-argument", "poolId, poolName, tier, and price are required.");
    }
    if (price < 0) {
        throw new https_1.HttpsError("invalid-argument", "Price must be non-negative.");
    }
    // --- Verify pool exists ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    // --- Build the base URL for redirect ---
    // In production, this should come from an environment variable
    const baseUrl = `https://marchmelee.com/pool/${poolId}`;
    // --- Create Stripe Checkout Session ---
    const stripe = getStripe();
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
                referralCredits: (referralCredits === null || referralCredits === void 0 ? void 0 : referralCredits.toString()) || "0",
            },
            customer_email: request.auth.token.email || undefined,
        });
        console.log(`[Stripe] Checkout session created: ${session.id} for pool ${poolId} by user ${userId}`);
        return { sessionUrl: session.url };
    }
    catch (err) {
        const error = err;
        console.error("[Stripe] Error creating checkout session:", error.message);
        throw new https_1.HttpsError("internal", `Failed to create checkout session: ${error.message}`);
    }
});
// =============================================================================
// 2. handleStripeWebhook — HTTP Request Handler (onRequest v2)
//    Receives and processes Stripe webhook events
// =============================================================================
exports.handleStripeWebhook = functions.https.onRequest(async (req, res) => {
    // Only accept POST requests
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"];
    if (!sig) {
        console.error("[Stripe Webhook] Missing stripe-signature header");
        res.status(400).send("Missing stripe-signature header");
        return;
    }
    // --- Verify Webhook Signature ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
    }
    catch (err) {
        const error = err;
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
                    }
                    catch (couponErr) {
                        // Log but don't fail the webhook — payment was already successful
                        console.error("[Stripe Webhook] Error processing coupon:", couponErr);
                    }
                }
            }
            catch (err) {
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
//# sourceMappingURL=stripe.js.map