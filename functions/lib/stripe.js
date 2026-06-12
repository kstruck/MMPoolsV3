"use strict";
// TODO: Run 'npm install stripe' in functions/ before deploying
// TODO: Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Firebase environment config
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStripeWebhook = exports.createCheckoutSession = void 0;
const functions = __importStar(require("firebase-functions/v2"));
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const stripe_1 = __importDefault(require("stripe"));
const db = admin.firestore();
// --- Stripe Config Params ---
const stripeSecretKey = (0, params_1.defineString)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineString)("STRIPE_WEBHOOK_SECRET");
// Stripe will be initialized at function invocation time
let stripeInstance = null;
function getStripe() {
    if (!stripeInstance) {
        let key = "";
        try {
            key = stripeSecretKey.value();
        }
        catch (e) {
            console.warn("[Stripe] STRIPE_SECRET_KEY is not defined in this environment.");
        }
        if (!key || key.startsWith("placeholder") || key === "") {
            return null; // Signal mockup bypass mode
        }
        stripeInstance = new stripe_1.default(key, { apiVersion: "2024-12-18.acacia" });
    }
    return stripeInstance;
}
// =============================================================================
// 1. createCheckoutSession — Callable Function (onCall v2)
//    Creates a Stripe Checkout Session for one-time pool payment or packages/bundles
// =============================================================================
exports.createCheckoutSession = functions.https.onCall({ cors: true }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    // --- Auth Check ---
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to create a checkout session.");
    }
    const userId = request.auth.uid;
    const { poolId, poolName, poolType, tier, price, couponCode, referralCredits, maxPlayersAllowed, bundleType, // buy_3 or unlimited_1yr
    usedCredit, // boolean indicating if they are applying a pool credit
    customCreditId, // dynamic credit ID
    successUrl, // Optional custom success redirect URL
    cancelUrl, // Optional custom cancel redirect URL
     } = request.data;
    const isBundlePurchase = !!bundleType;
    // --- Validate Required Fields ---
    if (isBundlePurchase) {
        if (price === undefined || price < 0) {
            throw new https_1.HttpsError("invalid-argument", "Price is required for bundle purchase.");
        }
    }
    else {
        if (!poolId || !poolName || !tier || price === undefined) {
            throw new https_1.HttpsError("invalid-argument", "poolId, poolName, tier, and price are required.");
        }
        if (price < 0) {
            throw new https_1.HttpsError("invalid-argument", "Price must be non-negative.");
        }
    }
    // --- Build the base URL for redirect ---
    const rawOrigin = ((_b = (_a = request.rawRequest) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b.origin) || ((_d = (_c = request.rawRequest) === null || _c === void 0 ? void 0 : _c.headers) === null || _d === void 0 ? void 0 : _d.referer) || "https://marchmelee.com";
    const originUrl = rawOrigin.endsWith("/") ? rawOrigin.slice(0, -1) : rawOrigin;
    let cleanedOrigin = originUrl;
    try {
        const urlObj = new URL(originUrl);
        cleanedOrigin = `${urlObj.protocol}//${urlObj.host}`;
    }
    catch (_o) {
        // Fallback
    }
    // --- Bundle Purchase Path ---
    if (isBundlePurchase) {
        const baseUrl = successUrl || `${cleanedOrigin}/pricing`;
        const stripe = getStripe();
        if (!stripe) {
            console.log(`[Stripe Mockup] STRIPE_SECRET_KEY is missing/placeholder. Activating mock dev sandbox bundle checkout for ${bundleType}.`);
            const mockUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}payment=success&session_id=mock_bundle_session_${Date.now()}`;
            const userRef = db.collection("users").doc(userId);
            if (bundleType === "buy_3") {
                await userRef.update({
                    freePoolsAvailable: admin.firestore.FieldValue.increment(3),
                    role: "POOL_MANAGER"
                });
            }
            else if (bundleType === "unlimited_1yr") {
                await userRef.update({
                    activeBundleType: "unlimited_1yr",
                    bundleExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
                    role: "POOL_MANAGER"
                });
            }
            else {
                // Dynamic Admin Bundle Mock Checkout Payout
                let dynamicBundle = null;
                try {
                    const billingConfigDoc = await db.collection("settings").doc("billing_config").get();
                    const packagesList = ((_e = billingConfigDoc.data()) === null || _e === void 0 ? void 0 : _e.packagesList) || [];
                    dynamicBundle = packagesList.find((b) => b.id === bundleType);
                }
                catch (err) {
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
                success_url: successUrl ? `${successUrl}${successUrl.includes('?') ? '&' : '?'}payment=success&session_id={CHECKOUT_SESSION_ID}` : `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: cancelUrl ? `${cancelUrl}${cancelUrl.includes('?') ? '&' : '?'}payment=cancelled` : `${baseUrl}?payment=cancelled`,
                metadata: {
                    userId,
                    bundleType,
                },
                customer_email: request.auth.token.email || undefined,
            });
            console.log(`[Stripe] Bundle checkout session created: ${session.id} for user ${userId}`);
            return { sessionUrl: session.url };
        }
        catch (err) {
            console.error("[Stripe] Bundle Checkout Error:", err);
            throw new https_1.HttpsError("internal", `Failed to create bundle checkout session: ${err.message}`);
        }
    }
    // --- Standard Pool Purchase Path ---
    // --- Verify pool exists ---
    const poolDoc = await db.collection("pools").doc(poolId).get();
    if (!poolDoc.exists) {
        throw new https_1.HttpsError("not-found", "Pool not found.");
    }
    const poolData = typeof poolDoc.data === "function" ? poolDoc.data() : (poolDoc.data || {});
    const existingPricePaid = ((_f = poolData === null || poolData === void 0 ? void 0 : poolData.billing) === null || _f === void 0 ? void 0 : _f.pricePaid) || 0;
    const baseUrl = successUrl || `${cleanedOrigin}/pool/${poolId}`;
    // --- Enforce 1 Free Pool limit ---
    if (tier === "free_tier") {
        const activeFreePoolsSnap = await db.collection("pools")
            .where("ownerId", "==", userId)
            .where("billing.status", "==", "active")
            .where("billing.tier", "==", "free_tier")
            .get();
        const activeFreePools = activeFreePoolsSnap.docs.filter(doc => doc.id !== poolId);
        if (activeFreePools.length > 0) {
            throw new https_1.HttpsError("failed-precondition", "You already have an active free pool. You are only allowed 1 active free pool at any time.");
        }
    }
    // --- Verify and deduct credits if used ---
    let validatedFreeReason = false;
    if (usedCredit) {
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.data();
        if (customCreditId) {
            const poolCredits = (userData === null || userData === void 0 ? void 0 : userData.poolCredits) || [];
            const creditObj = poolCredits.find((c) => c.id === customCreditId);
            if (!creditObj || creditObj.isUsed) {
                throw new https_1.HttpsError("failed-precondition", "Specific custom pool credit is missing or already used.");
            }
        }
        else {
            const freePoolsAvailable = (userData === null || userData === void 0 ? void 0 : userData.freePoolsAvailable) || 0;
            if (freePoolsAvailable <= 0) {
                throw new https_1.HttpsError("failed-precondition", "No universal pool credits available.");
            }
        }
        validatedFreeReason = true;
    }
    if (couponCode) {
        const couponQuery = await db.collection("coupons")
            .where("code", "==", couponCode)
            .limit(1)
            .get();
        if (!couponQuery.empty) {
            const couponData = couponQuery.docs[0].data();
            const now = Date.now();
            if (couponData.isActive && (!couponData.expiresAt || couponData.expiresAt > now)) {
                if (couponData.maxUses === undefined || (couponData.usesCount || 0) < couponData.maxUses) {
                    if (couponData.discountType === "percentage" && couponData.discountValue === 100) {
                        validatedFreeReason = true;
                    }
                }
            }
        }
    }
    // --- Determine Authoritative Server Price ---
    let serverPrice;
    try {
        const billingConfigDoc = await db.collection("settings").doc("billing_config").get();
        const configData = billingConfigDoc.data();
        if (configData) {
            if (isBundlePurchase) {
                const packagesList = configData.packagesList || [];
                const dynamicBundle = packagesList.find((b) => b.id === bundleType);
                if (dynamicBundle) {
                    serverPrice = dynamicBundle.price;
                }
                else if (bundleType === "buy_3" && ((_g = configData.packages) === null || _g === void 0 ? void 0 : _g.buy_3)) {
                    serverPrice = configData.packages.buy_3;
                }
                else if (bundleType === "unlimited_1yr" && ((_h = configData.packages) === null || _h === void 0 ? void 0 : _h.unlimited_1yr)) {
                    serverPrice = configData.packages.unlimited_1yr;
                }
            }
            else {
                if (tier === "free_tier") {
                    serverPrice = 0;
                }
                else {
                    let pricingArray = [];
                    if (poolType === "NFL_SEASON" || poolType === "NFL_PICKEM" || poolType === "NFL_SURVIVOR" || poolType === "NFL_MARGIN") {
                        pricingArray = ((_j = configData.pricing) === null || _j === void 0 ? void 0 : _j.season) || [];
                    }
                    else if (poolType === "BRACKET" || poolType === "NFL_PLAYOFFS") {
                        pricingArray = ((_k = configData.pricing) === null || _k === void 0 ? void 0 : _k.bracket) || [];
                    }
                    else if (poolType === "SQUARES") {
                        pricingArray = ((_l = configData.pricing) === null || _l === void 0 ? void 0 : _l.squares) || [];
                    }
                    else if (poolType === "PROPS") {
                        pricingArray = ((_m = configData.pricing) === null || _m === void 0 ? void 0 : _m.props) || [];
                    }
                    const players = Number(maxPlayersAllowed) || 10;
                    const applicableTier = pricingArray.find((t) => players >= t.min && players <= t.max);
                    if (applicableTier) {
                        serverPrice = applicableTier.price;
                    }
                }
            }
        }
    }
    catch (e) {
        console.error("Failed to fetch authoritative price", e);
    }
    if (serverPrice === undefined) {
        throw new https_1.HttpsError("internal", "Unable to resolve authoritative server price for this pool type/tier.");
    }
    // --- Secure $0 Stripe Bypass for 100% Off Coupons, Credit usage, or Unlimited Pass ---
    if (serverPrice === 0) {
        if (!validatedFreeReason && tier !== "free_tier") {
            throw new https_1.HttpsError("failed-precondition", "No valid free-activation reason provided.");
        }
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
                const poolCredits = (userData === null || userData === void 0 ? void 0 : userData.poolCredits) || [];
                const updatedCredits = poolCredits.map((c) => c.id === customCreditId ? Object.assign(Object.assign({}, c), { isUsed: true, usedForPoolId: poolId }) : c);
                await db.collection("users").doc(userId).update({
                    poolCredits: updatedCredits
                });
                console.log(`[Custom Credit] User ${userId} used custom credit ${customCreditId} for pool ${poolId}`);
            }
            else {
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
            }
            catch (couponErr) {
                console.error("[Stripe Bypass] Error processing coupon:", couponErr);
            }
        }
        console.log(`[Stripe Bypass] Pool ${poolId} activated for free by user ${userId}`);
        return { sessionUrl: `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}payment=success` };
    }
    // --- Create Stripe Checkout Session ---
    const stripe = getStripe();
    if (!stripe) {
        console.log(`[Stripe Mockup] STRIPE_SECRET_KEY is missing/placeholder. Activating mock dev sandbox checkout for pool ${poolId}.`);
        const mockUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}payment=success&session_id=mock_local_dev_session_${Date.now()}`;
        const poolRef = db.collection("pools").doc(poolId);
        await poolRef.update({
            "billing.status": "active",
            "billing.pricePaid": existingPricePaid + serverPrice,
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
            }
            catch (couponErr) {
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
                        unit_amount: Math.round(serverPrice * 100),
                    },
                    quantity: 1,
                },
            ],
            success_url: successUrl ? `${successUrl}${successUrl.includes('?') ? '&' : '?'}payment=success&session_id={CHECKOUT_SESSION_ID}` : `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl ? `${cancelUrl}${cancelUrl.includes('?') ? '&' : '?'}payment=cancelled` : `${baseUrl}?payment=cancelled`,
            metadata: {
                poolId,
                userId,
                tier,
                poolType,
                couponCode: couponCode || "",
                referralCredits: (referralCredits === null || referralCredits === void 0 ? void 0 : referralCredits.toString()) || "0",
                maxPlayersAllowed: (maxPlayersAllowed === null || maxPlayersAllowed === void 0 ? void 0 : maxPlayersAllowed.toString()) || "10",
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
    var _a, _b, _c;
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
    switch (event.type) {
        case "checkout.session.completed": {
            // Idempotency check: atomically create a processing marker.
            // If this fails, another instance is already processing or has processed this event.
            const evtRef = db.collection('stripeWebhookEvents').doc(event.id);
            try {
                await evtRef.create({ type: event.type, status: 'processing', startedAt: Date.now() });
            }
            catch (err) {
                if (err.code === 6) { // ALREADY_EXISTS in Firebase Admin
                    console.log(`[Stripe Webhook] Duplicate or concurrent event ignored: ${event.id}`);
                    res.status(200).send('duplicate');
                    return;
                }
                throw err;
            }
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
                    }
                    else if (bundleType === "unlimited_1yr") {
                        await userRef.update({
                            activeBundleType: "unlimited_1yr",
                            bundleExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
                            role: "POOL_MANAGER"
                        });
                    }
                    else {
                        // Dynamic Admin Bundle webhook completion
                        let dynamicBundle = null;
                        try {
                            const billingConfigDoc = await db.collection("settings").doc("billing_config").get();
                            const packagesList = ((_a = billingConfigDoc.data()) === null || _a === void 0 ? void 0 : _a.packagesList) || [];
                            dynamicBundle = packagesList.find((b) => b.id === bundleType);
                        }
                        catch (err) {
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
                }
                catch (err) {
                    console.error("[Stripe Webhook] Error updating user bundle:", err);
                    await evtRef.delete();
                    res.status(500).send("Internal error processing bundle payment");
                    return;
                }
                await evtRef.update({ status: 'completed', processedAt: Date.now() });
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
                const existingPricePaid = ((_c = (_b = poolSnap.data()) === null || _b === void 0 ? void 0 : _b.billing) === null || _c === void 0 ? void 0 : _c.pricePaid) || 0;
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
                    }
                    catch (couponErr) {
                        console.error("[Stripe Webhook] Error processing coupon:", couponErr);
                    }
                }
            }
            catch (err) {
                console.error("[Stripe Webhook] Error updating pool billing:", err);
                await evtRef.delete();
                res.status(500).send("Internal error processing payment");
                return;
            }
            await evtRef.update({ status: 'completed', processedAt: Date.now() });
            break;
        }
        default:
            console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
    res.status(200).json({ received: true });
});
//# sourceMappingURL=stripe.js.map