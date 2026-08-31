#!/usr/bin/env node
/**
 * Re-file the six mis-stamped preseason games from week 1 to week 2.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. (mmp-change-control Rule 1.)
 *
 * ## ALREADY EXECUTED — 2026-08-07 against gridiron-gamble-uzuqo
 *
 * Dry run first, then --apply; 6 documents written. Verified after:
 * nfl_games 2026/seasonType 1 counts week1=1 (espn_401873271 CAR@ARI, FINAL),
 * week2=16, week3=16, week4=16; espn_401873271 spread locked=true value=-1.5.
 * It is committed as the record of that repair and as the pattern for the next
 * one — re-running it now REFUSES, by design, because the six documents are no
 * longer in the expected pre-repair state.
 *
 * ## Why this exists instead of a re-import
 *
 * PLAN-NFL-IMPORT-SCOPE §6 specifies the repair as a SuperAdmin re-import of
 * preseason weeks 1 and 2, which is correct and safe on the hardened importer.
 * This script is the SMALLER instrument for the same outcome, and it is what
 * the original task description asked for: "a targeted SUPER_ADMIN callable that
 * rewrites week 1→2 on exactly those six IDs."
 *
 * The only thing wrong with those documents is the `week` field. Everything else
 * — kickoff, teams, status, scores, spread — was written correctly by the
 * original import. A re-import re-fetches ESPN, rewrites every field, runs an
 * orphan sweep and touches spreads; this rewrites ONE integer on SIX documents
 * by id. Strictly less can go wrong, and nothing here can unlock a spread.
 *
 * It does NOT replace the importer fix (#392). That fix is what stops the
 * mis-filing happening again on the next import; this only repairs what is
 * already stored.
 *
 * ## Safety
 *
 *  - Dry run unless --apply.
 *  - REFUSES unless every one of the six documents is currently exactly
 *    { season: 2026, seasonType: 1, week: 1 }. A partially-repaired or
 *    unexpected state aborts the whole run rather than half-applying.
 *  - Writes `week` ONLY, via a top-level field on update(). No merge semantics
 *    to get wrong, no nested map to clobber.
 *  - Never touches `spread`, and never touches the HOF game espn_401873271.
 *  - Prints the before/after counts per week so the change is verifiable rather
 *    than asserted.
 *
 * Usage (PowerShell 5.1 — one command per line):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\gridiron-admin.json"
 *   node .claude\skills\mmp-diagnostics-and-tooling\scripts\restamp-preseason-weeks.mjs
 *   node .claude\skills\mmp-diagnostics-and-tooling\scripts\restamp-preseason-weeks.mjs --apply
 */

import admin from 'firebase-admin';

const PROJECT = 'gridiron-gamble-uzuqo';
const SEASON = '2026';
const SEASON_TYPE = 1;
const FROM_WEEK = 1;
const TO_WEEK = 2;

/** The six games that kick off Aug 13/14 and belong to week 2. */
const TARGETS = [
  { id: 'espn_401873272', label: 'DET@CIN' },
  { id: 'espn_401873275', label: 'GB@PIT' },
  { id: 'espn_401873273', label: 'IND@NE' },
  { id: 'espn_401873274', label: 'LAC@HOU' },
  { id: 'espn_401873640', label: 'ARI@LV' },
  { id: 'espn_401874392', label: 'TEN@SF' },
];

/** Must never be touched: the played HOF game, whose spread is locked. */
const MUST_NOT_TOUCH = 'espn_401873271';

const apply = process.argv.includes('--apply');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('REFUSING TO RUN: GOOGLE_APPLICATION_CREDENTIALS is not set.');
  process.exit(2);
}
if (TARGETS.some((t) => t.id === MUST_NOT_TOUCH)) {
  console.error(`REFUSING TO RUN: ${MUST_NOT_TOUCH} is in the target list. It must never be re-filed.`);
  process.exit(2);
}

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

async function weekCounts() {
  const snap = await db.collection('nfl_games')
    .where('season', '==', SEASON).where('seasonType', '==', SEASON_TYPE).get();
  const counts = {};
  for (const d of snap.docs) {
    const w = Number(d.data().week);
    counts[w] = (counts[w] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  console.log(`=== Re-file ${TARGETS.length} preseason games: week ${FROM_WEEK} -> ${TO_WEEK} ===`);
  console.log(`project ${PROJECT}   season ${SEASON}   seasonType ${SEASON_TYPE}`);
  console.log(apply ? '\n*** LIVE RUN — THIS WILL WRITE ***\n' : '\n--- DRY RUN (pass --apply to write) ---\n');

  const before = await weekCounts();
  console.log('week counts BEFORE:', JSON.stringify(before));

  const refs = TARGETS.map((t) => db.collection('nfl_games').doc(t.id));
  const docs = await db.getAll(...refs);

  const problems = [];
  const plan = [];
  docs.forEach((doc, i) => {
    const t = TARGETS[i];
    if (!doc.exists) { problems.push(`${t.id} (${t.label}): DOES NOT EXIST`); return; }
    const d = doc.data();
    const state = { season: String(d.season), seasonType: Number(d.seasonType), week: Number(d.week) };
    if (state.season !== SEASON || state.seasonType !== SEASON_TYPE || state.week !== FROM_WEEK) {
      problems.push(
        `${t.id} (${t.label}): expected season ${SEASON} / type ${SEASON_TYPE} / week ${FROM_WEEK}, ` +
        `found season ${state.season} / type ${state.seasonType} / week ${state.week}`,
      );
      return;
    }
    plan.push({
      ...t,
      ref: doc.ref,
      startTime: d.startTime,
      status: d.status,
      spreadLocked: d.spread?.locked ?? null,
    });
  });

  if (problems.length > 0) {
    console.error('\nREFUSING — the stored state is not what this repair expects:\n');
    for (const p of problems) console.error('  ' + p);
    console.error(
      '\nNothing was written. If the games were already re-filed, that is good news — ' +
      're-run confidence-exposure-detail.mjs to confirm week 1 holds only the HOF game.',
    );
    process.exit(1);
  }

  console.log(`\nAll ${plan.length} target(s) verified in the expected state:\n`);
  for (const p of plan) {
    console.log(
      `  ${p.id}  ${p.label.padEnd(8)} ${p.status.padEnd(10)} ` +
      `kickoff ${new Date(p.startTime).toISOString()}  spread.locked=${p.spreadLocked}  ` +
      `week ${FROM_WEEK} -> ${TO_WEEK}`,
    );
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. ${plan.length} document(s) would change.`);
    console.log(`Expected after: week1 ${before[1]} -> ${before[1] - plan.length}, week2 ${before[2] ?? 0} -> ${(before[2] ?? 0) + plan.length}`);
    return;
  }

  // ONE field, on SIX documents, by id. `week` is top-level, so there is no
  // nested map for update() to replace.
  const batch = db.batch();
  for (const p of plan) batch.update(p.ref, { week: TO_WEEK });
  await batch.commit();
  console.log(`\nWROTE ${plan.length} document(s).`);

  const after = await weekCounts();
  console.log('week counts AFTER: ', JSON.stringify(after));

  const hof = await db.collection('nfl_games').doc(MUST_NOT_TOUCH).get();
  const s = hof.data()?.spread;
  console.log(`${MUST_NOT_TOUCH} spread: locked=${s?.locked} value=${s?.value}  (must be locked=true value=-1.5)`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
