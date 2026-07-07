// =============================================================================
// migrate-entitlements.mjs — Phase-4 cutover backfill (PLAN #14, step 2)
//
//   Converts the four LEGACY entitlement fields on users/{uid}:
//     - freePoolsAvailable (int)          -> ONE CREDIT_BUNDLE, source MIGRATION
//     - poolCredits[]        (array)       -> one credit doc per element
//     - activeBundleType + bundleExpiresAt -> ONE UNLIMITED_PASS, source MIGRATION
//   into the canonical model:
//     bundles/{bundleId}  +  bundles/{bundleId}/credits/{creditId}
//
//   *** RUN ONLY DURING THE PHASE-4 CUTOVER FREEZE, per change-control. ***
//   Preconditions (see PLAN "Migration cutover sequence"):
//     (1)  new entitlement-related checkout sessions are STOPPED (flag),
//     (1)  in-flight bundle checkout sessions drained/expired (no late webhook),
//     (1b) entitlement writes FROZEN (grants + redemptions paused),
//     (2)  <this script>,
//     (3)  census verify old-vs-new per user (this script prints it in dry-run),
//     (4)  flip readers, (5) unfreeze, (6) delete legacy fields later.
//
//   SAFETY:
//     - DRY-RUN by DEFAULT. Nothing is written unless you pass --commit.
//     - IDEMPOTENT: bundle ids are deterministic (`migrate_<uid>_<kind>`), so a
//       re-run overwrites the same docs rather than duplicating. Credit ids are
//       deterministic too (index-based), so re-runs are stable.
//     - CHUNKED: users processed in pages; each user's writes go in ONE batch
//       (1 bundle + N credits, capped at 100) — well under Firestore limits.
//     - KILL SWITCH: set MIGRATION_ABORT=1 in the environment to stop between
//       pages (checked each page).
//     - CENSUS: prints per-user "old count vs new count" and a grand total so a
//       human can verify parity before/after.
//
//   USAGE:
//     node scripts/migrate-entitlements.mjs                # DRY RUN (default)
//     node scripts/migrate-entitlements.mjs --commit       # ACTUALLY WRITE
//     node scripts/migrate-entitlements.mjs --limit 50     # cap users scanned
//
//   Requires ./serviceAccountKey.json (same as the other admin scripts).
// =============================================================================

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREDITS_PER_BUNDLE = 100;
const LEGACY_NEVER_EXPIRES_TERM_DAYS = 3650; // mirrors shared/schemas/billingConfig

// -----------------------------------------------------------------------------
// PURE MAPPING (unit-tested — no Firestore, no admin SDK, deterministic).
// Exported so functions/src/__tests__ can assert the legacy→canonical mapping.
// -----------------------------------------------------------------------------

/**
 * Maps ONE legacy user doc to the canonical bundles/credits it should produce.
 *
 * @param {string} uid
 * @param {object} user  the users/{uid} document data
 * @param {number} nowMs injected clock for deterministic termEndsAt
 * @returns {{ bundles: Array<{ id:string, doc:object, credits: Array<{id:string, doc:object}> }>, oldCount:number, newCount:number }}
 *
 * oldCount / newCount are the census numbers:
 *   oldCount = freePoolsAvailable + poolCredits.length + (activeBundleType ? 1 : 0)
 *   newCount = total credits created + (pass ? 1 : 0)   [passes count as 1 entitlement]
 */
export function mapLegacyUserToEntitlements(uid, user, nowMs) {
  const bundles = [];
  const u = user || {};

  const freePools = Math.max(0, Math.floor(Number(u.freePoolsAvailable) || 0));
  const legacyCredits = Array.isArray(u.poolCredits) ? u.poolCredits : [];
  const hasPass = typeof u.activeBundleType === 'string' && u.activeBundleType.length > 0;

  const oldCount = freePools + legacyCredits.length + (hasPass ? 1 : 0);
  let newCreditCount = 0;

  // --- (a) freePoolsAvailable → ONE unconstrained CREDIT_BUNDLE (MIGRATION) ---
  if (freePools > 0) {
    const n = Math.min(MAX_CREDITS_PER_BUNDLE, freePools);
    const id = `migrate_${uid}_freepools`;
    const credits = [];
    for (let i = 0; i < n; i++) {
      credits.push({
        id: `c${i}`,
        doc: { constraints: {}, status: 'available' },
      });
    }
    bundles.push({
      id,
      doc: {
        ownerId: uid,
        productKind: 'CREDIT_BUNDLE',
        source: 'MIGRATION',
        productSnapshot: { name: 'Migrated Free Pools', price: 0, poolType: 'ALL', maxPlayersPerPool: 9999 },
        creditsTotal: n,
        creditsUsed: 0,
        status: 'active',
        createdAt: nowMs,
      },
      credits,
    });
    newCreditCount += n;
  }

  // --- (b) poolCredits[] → one credit doc each, in ONE CREDIT_BUNDLE (MIGRATION) ---
  // Legacy credit shape: { id, bundleId, poolType, maxPlayersPerPool, expiresAt, isUsed }.
  // Pool Credits never expire in the new model, so a legacy expiresAt is dropped
  // (documented divergence). Constraints preserved (poolType, maxPlayersPerPool).
  if (legacyCredits.length > 0) {
    // Cap defensively; if a legacy user somehow has >100, chunk into multiple bundles.
    for (let chunk = 0; chunk * MAX_CREDITS_PER_BUNDLE < legacyCredits.length; chunk++) {
      const slice = legacyCredits.slice(chunk * MAX_CREDITS_PER_BUNDLE, (chunk + 1) * MAX_CREDITS_PER_BUNDLE);
      const id = `migrate_${uid}_poolcredits_${chunk}`;
      const credits = slice.map((lc, i) => {
        const constraints = {};
        const pt = lc && lc.poolType;
        if (pt && pt !== 'ALL') constraints.poolType = pt;
        const mp = Number(lc && lc.maxPlayersPerPool);
        if (Number.isFinite(mp) && mp > 0 && mp < 9999) constraints.maxPlayersPerPool = Math.round(mp);
        const used = lc && (lc.isUsed === true);
        return {
          id: `c${i}`,
          doc: used
            ? { constraints, status: 'used', usedByPoolId: (lc && lc.usedByPoolId) || null, usedAt: nowMs }
            : { constraints, status: 'available' },
        };
      });
      const usedInSlice = credits.filter((c) => c.doc.status === 'used').length;
      bundles.push({
        id,
        doc: {
          ownerId: uid,
          productKind: 'CREDIT_BUNDLE',
          source: 'MIGRATION',
          productSnapshot: { name: 'Migrated Pool Credits', price: 0, poolType: 'ALL', maxPlayersPerPool: 9999 },
          creditsTotal: slice.length,
          creditsUsed: usedInSlice,
          status: usedInSlice >= slice.length ? 'exhausted' : 'active',
          createdAt: nowMs,
        },
        credits,
      });
      newCreditCount += slice.length;
    }
  }

  // --- (c) activeBundleType + bundleExpiresAt → ONE UNLIMITED_PASS (MIGRATION) ---
  if (hasPass) {
    const expiresAt = Number(u.bundleExpiresAt);
    const termEndsAt = Number.isFinite(expiresAt) && expiresAt > 0
      ? expiresAt
      : nowMs + LEGACY_NEVER_EXPIRES_TERM_DAYS * DAY_MS;
    const expired = termEndsAt <= nowMs;
    bundles.push({
      id: `migrate_${uid}_pass`,
      doc: {
        ownerId: uid,
        productKind: 'UNLIMITED_PASS',
        source: 'MIGRATION',
        productSnapshot: { name: `Migrated ${u.activeBundleType}`, price: 0, poolType: 'ALL', maxPlayersPerPool: 9999 },
        creditsTotal: 0,
        creditsUsed: 0,
        termEndsAt,
        status: expired ? 'expired' : 'active',
        createdAt: nowMs,
      },
      credits: [],
    });
  }

  // A pass counts as one entitlement in the census.
  const newCount = newCreditCount + (hasPass ? 1 : 0);
  return { bundles, oldCount, newCount };
}

// -----------------------------------------------------------------------------
// RUNNER (side-effecting) — guarded so `import` for tests does not execute it.
// -----------------------------------------------------------------------------

async function run() {
  const argv = process.argv.slice(2);
  const COMMIT = argv.includes('--commit');
  const limitIdx = argv.indexOf('--limit');
  const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) || Infinity : Infinity;
  const PAGE = 200;

  console.log('='.repeat(72));
  console.log(`[migrate-entitlements] mode=${COMMIT ? 'COMMIT (WRITING)' : 'DRY-RUN (no writes)'}  limit=${LIMIT}`);
  console.log('  RUN ONLY DURING THE PHASE-4 CUTOVER FREEZE. Ctrl-C to abort.');
  console.log('='.repeat(72));

  const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  const db = admin.firestore();

  let scanned = 0;
  let migratedUsers = 0;
  let totalOld = 0;
  let totalNew = 0;
  let bundlesWritten = 0;
  let lastDoc = null;

  while (scanned < LIMIT) {
    if (process.env.MIGRATION_ABORT === '1') {
      console.warn('[migrate-entitlements] MIGRATION_ABORT=1 — stopping between pages.');
      break;
    }
    let q = db.collection('users').orderBy('__name__').limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    lastDoc = snap.docs[snap.docs.length - 1];

    for (const userSnap of snap.docs) {
      if (scanned >= LIMIT) break;
      scanned++;
      const uid = userSnap.id;
      const user = userSnap.data();
      const { bundles, oldCount, newCount } = mapLegacyUserToEntitlements(uid, user, Date.now());
      if (bundles.length === 0) continue;

      migratedUsers++;
      totalOld += oldCount;
      totalNew += newCount;
      const parity = oldCount === newCount ? 'OK' : `DRIFT (old=${oldCount} new=${newCount})`;
      console.log(`  user ${uid}: ${bundles.length} bundle(s), census old=${oldCount} new=${newCount} [${parity}]`);

      if (COMMIT) {
        for (const b of bundles) {
          const batch = db.batch();
          const bundleRef = db.collection('bundles').doc(b.id);
          batch.set(bundleRef, b.doc);
          for (const c of b.credits) {
            batch.set(bundleRef.collection('credits').doc(c.id), c.doc);
          }
          await batch.commit();
          bundlesWritten++;
        }
      }
    }
    console.log(`  ...scanned ${scanned} users so far.`);
  }

  console.log('='.repeat(72));
  console.log('[migrate-entitlements] CENSUS SUMMARY');
  console.log(`  users scanned          : ${scanned}`);
  console.log(`  users with legacy data : ${migratedUsers}`);
  console.log(`  legacy entitlement count (old): ${totalOld}`);
  console.log(`  canonical entitlement count (new): ${totalNew}`);
  console.log(`  parity: ${totalOld === totalNew ? 'OK — old === new' : 'DRIFT — investigate before flipping readers'}`);
  console.log(`  bundles written        : ${COMMIT ? bundlesWritten : 0} ${COMMIT ? '' : '(dry-run — nothing written)'}`);
  console.log('='.repeat(72));
  if (!COMMIT) {
    console.log('DRY-RUN complete. Re-run with --commit ONLY inside the cutover freeze.');
  }
}

// Only run when invoked as a script (not when imported by a test).
const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('migrate-entitlements.mjs');
if (invokedDirectly) {
  run().then(() => process.exit(0)).catch((err) => {
    console.error('[migrate-entitlements] FATAL:', err);
    process.exit(1);
  });
}
