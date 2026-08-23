/**
 * READ-ONLY audit: has any real pool ever PAID for the `customBranding` add-on?
 *
 * PLAN-WIZARD-BUYFLOW-FIXES T4 requires this check before the add-on is retired
 * (Kevin's D1: "Free for everyone, remove the $29 fee. No one has paid that
 * yet." — this verifies it rather than trusting it).
 *
 * WHY NOT THE LEDGER. `billing_charges` rows record userId / amount / tier /
 * couponCode / session id — they do NOT carry the add-on breakdown
 * (`functions/src/lib/billingCharges.ts`, `BillingCharge`). The authoritative
 * record of what a pool actually bought is on the pool document:
 * `billing.paid.addons` (the array stamped from the checkout snapshot at
 * activation, `functions/src/stripe.ts`) and `billing.featuresUnlocked`.
 * So this reads pools, and prints the matching ledger rows for each hit so the
 * amount and session are visible for a refund decision.
 *
 * It WRITES NOTHING. Every call is a `.get()`.
 *
 * Run:
 *   gcloud auth application-default login
 *   node scripts/auditCustomBrandingPaid.mjs
 *
 * or, with a service-account key:
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\key.json
 *   node scripts/auditCustomBrandingPaid.mjs
 */
import admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'gridiron-gamble-uzuqo';

admin.initializeApp({
    projectId: PROJECT_ID,
    credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

/** A pool that is a test/sim artefact, not a customer. Mirrors shared/testPool.ts. */
const isTestPool = (id, p) =>
    p?.isTestPool === true ||
    String(id).startsWith('sim-') ||
    String(p?.season ?? '').startsWith('sim-') ||
    /^\s*AI Test/i.test(String(p?.name ?? ''));

const run = async () => {
    console.log(`Project: ${PROJECT_ID}`);
    console.log('Reading pools… (read-only)\n');

    const snap = await db.collection('pools').get();
    const hits = [];
    let scanned = 0;
    let testPools = 0;

    for (const doc of snap.docs) {
        const p = doc.data();
        scanned += 1;
        if (isTestPool(doc.id, p)) { testPools += 1; continue; }

        const billing = p.billing || {};
        const paidAddons = Array.isArray(billing.paid?.addons) ? billing.paid.addons : [];
        // Two independent records that a paid activation stamped branding.
        const inPaidSnapshot = paidAddons.includes('customBranding');
        const unlockedOnActive =
            billing.status === 'active' && billing.featuresUnlocked?.customBranding === true;

        if (inPaidSnapshot || unlockedOnActive) {
            hits.push({
                poolId: doc.id,
                name: p.name,
                ownerId: p.ownerId || p.createdByUid,
                status: billing.status,
                tier: billing.tier,
                pricePaid: billing.pricePaid,
                paidAddons,
                stripeSessionId: billing.stripeSessionId,
                inPaidSnapshot,
                unlockedOnActive,
            });
        }
    }

    console.log(`Scanned ${scanned} pools (${testPools} skipped as test/sim artefacts).`);
    console.log(`Pools showing a PAID customBranding add-on: ${hits.length}\n`);

    if (hits.length === 0) {
        console.log('RESULT: nobody has ever paid for customBranding. Nothing to refund.');
        return;
    }

    for (const h of hits) {
        console.log(JSON.stringify(h, null, 2));
        if (h.stripeSessionId) {
            const row = await db.collection('billing_charges').doc(h.stripeSessionId).get();
            console.log(
                row.exists
                    ? `  ledger row: ${JSON.stringify(row.data())}`
                    : '  ledger row: (none — a $0 / credit / coupon activation writes a tagged id instead)',
            );
        }
        console.log('');
    }
    console.log('RESULT: review each pool above with Kevin — refund or credit is his call (D1).');
};

run().then(
    () => process.exit(0),
    (e) => {
        console.error('Audit FAILED (nothing was written):', e?.message || e);
        process.exit(1);
    },
);
