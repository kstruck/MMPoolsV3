#!/usr/bin/env node
// K9 census (PLAN-PAYMENT-LEDGER T1) — READ-ONLY. Counts pools whose
// settings.payouts.places (or settings.weeklyPayouts.places) carry a DUPLICATE
// rank, which the unique-rank refinement now refuses on every future save.
// Expected: 0. Run BEFORE merging T1:
//   GOOGLE_APPLICATION_CREDENTIALS=<key.json> node functions/scripts/censusPayoutRanks.mjs
// or against the emulator with FIRESTORE_EMULATOR_HOST set. Never writes.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'gridiron-gamble-uzuqo';
if (process.env.FIRESTORE_EMULATOR_HOST) admin.initializeApp({ projectId: PROJECT_ID });
else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
else { console.error('Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST). This script never writes.'); process.exit(2); }
const db = admin.firestore();
const dup = (places) => Array.isArray(places) && new Set(places.map((p) => p?.rank)).size !== places.length;
const snap = await db.collection('pools').select('name', 'type', 'settings.payouts', 'settings.weeklyPayouts', 'status').get();
let scanned = 0; const hits = [];
for (const d of snap.docs) {
  scanned += 1;
  const s = d.data().settings ?? {};
  const a = dup(s.payouts?.places), b = dup(s.weeklyPayouts?.places);
  if (a || b) hits.push({ id: d.id, name: d.data().name, type: d.data().type, status: d.data().status, payouts: a, weeklyPayouts: b });
}
console.log(`scanned ${scanned} pools; ${hits.length} with duplicate ranks`);
for (const h of hits) console.log(JSON.stringify(h));
process.exit(0);
