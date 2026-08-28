#!/usr/bin/env node
// PLAN-SQUARES-ZERO-LIMIT census — READ-ONLY. NEVER WRITES.
//
// Answers the plan's §4 question: how many live SQUARES pools already store a
// `maxSquaresPerPlayer` that refuses every non-owner claim?
//
// `functions/src/squares.ts:93` refuses a claim whenever
// `mySquares >= pool.maxSquaresPerPlayer && pool.ownerId !== userId`, so a pool
// stored at 0 refuses a non-owner's FIRST square. The wizard's default is 0
// (`CreateSquaresPool.tsx:43`), which is how a pool reaches that state without
// anyone choosing it.
//
// Run:
//   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\serviceAccountKey.json"
//   node functions/scripts/censusSquaresMaxPerPlayer.mjs
//
// or against the emulator with FIRESTORE_EMULATOR_HOST set.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'gridiron-gamble-uzuqo';
if (process.env.FIRESTORE_EMULATOR_HOST) admin.initializeApp({ projectId: PROJECT_ID });
else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
else { console.error('Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST). This script never writes.'); process.exit(2); }

const db = admin.firestore();

// The server's own comparison, applied to a hypothetical first claim
// (`mySquares` = 0) by somebody who is not the owner.
const refusesFirstClaim = (maxSquaresPerPlayer) => 0 >= maxSquaresPerPlayer;

const snap = await db.collection('pools')
  .where('type', '==', 'SQUARES')
  .select('name', 'status', 'maxSquaresPerPlayer', 'isLocked', 'ownerId')
  .get();

let scanned = 0;
const blocked = [];
const absent = [];
for (const d of snap.docs) {
  scanned += 1;
  const v = d.data().maxSquaresPerPlayer;
  // ABSENT is a separate state and is NOT blocked: `0 >= undefined` is false,
  // so those pools already behave as unlimited today.
  if (v === undefined || v === null) { absent.push({ id: d.id, name: d.data().name, status: d.data().status }); continue; }
  if (refusesFirstClaim(v)) {
    blocked.push({ id: d.id, name: d.data().name, status: d.data().status, maxSquaresPerPlayer: v, isLocked: d.data().isLocked === true });
  }
}

console.log(`scanned ${scanned} SQUARES pools`);
console.log(`${blocked.length} refuse a non-owner's FIRST square today (maxSquaresPerPlayer <= 0)`);
console.log(`${absent.length} have no value stored at all (already unlimited — not affected)`);
for (const b of blocked) console.log(`BLOCKED ${JSON.stringify(b)}`);
process.exit(0);
