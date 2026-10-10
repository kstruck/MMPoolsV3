#!/usr/bin/env node
// Membership census (PLAN-ADMIN-PICK-IMPLICIT-JOIN, SWEEPS S3) — READ-ONLY.
// For every NFL pool, lists Member Records (`pools/{id}/members/{uid}`) whose
// uid is MISSING from `pool.participantIds` — the drift the implicit join
// prevents. Expected after the one-off repair and the fix: no rows.
//   GOOGLE_APPLICATION_CREDENTIALS=<key.json> node functions/scripts/censusMembership.mjs
//   node functions/scripts/censusMembership.mjs --all-types     # every pool type
// or against the emulator with FIRESTORE_EMULATOR_HOST set. Never writes.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
// Emulator runs use the fake project the test suites use (`demo-mmp`), never the
// production id by default (qodo round 3 on PR #686).
if (process.env.FIRESTORE_EMULATOR_HOST) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-mmp' });
else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'gridiron-gamble-uzuqo' });
else { console.error('Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST). This script never writes.'); process.exit(2); }
const db = admin.firestore();
// `joinedAt` is a number on the NFL join paths but `FieldValue.serverTimestamp()`
// (an admin-SDK Timestamp) on participant.ts's path; `new Date(Timestamp)` is an
// Invalid Date and `toISOString()` throws (qodo round 3 on PR #686).
const iso = (v) => {
  if (v == null) return null;
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? `unparseable:${String(v)}` : d.toISOString();
};
const NFL_TYPES = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];
const allTypes = process.argv.includes('--all-types');
const pools = allTypes
  ? await db.collection('pools').select('name', 'type', 'status', 'ownerId', 'participantIds').get()
  : await db.collection('pools').where('type', 'in', NFL_TYPES).select('name', 'type', 'status', 'ownerId', 'participantIds').get();
let scanned = 0; const drift = [];
for (const p of pools.docs) {
  scanned += 1;
  const d = p.data();
  const ids = Array.isArray(d.participantIds) ? d.participantIds : [];
  const members = await p.ref.collection('members').select('userName', 'role', 'joinedAt').get();
  const missing = members.docs
    .filter((m) => !ids.includes(m.id))
    .map((m) => ({ uid: m.id, name: m.data().userName, role: m.data().role, joinedAt: iso(m.data().joinedAt) }));
  if (missing.length) drift.push({ poolId: p.id, name: d.name, type: d.type, status: d.status, members: members.size, participantIds: ids.length, missing });
}
console.log(`scanned ${scanned} ${allTypes ? '' : 'NFL '}pools; ${drift.length} with Member Records missing from participantIds`);
for (const row of drift) console.log(JSON.stringify(row));
// The guarantee, stated at exit as well as in the header: this file contains no
// set/update/delete/batch/runTransaction call — `grep -nE "\.(set|update|delete|batch|runTransaction)\(" functions/scripts/censusMembership.mjs` is empty.
console.log('READ-ONLY CHECK COMPLETE — no Firestore writes were made.');
process.exit(0);
