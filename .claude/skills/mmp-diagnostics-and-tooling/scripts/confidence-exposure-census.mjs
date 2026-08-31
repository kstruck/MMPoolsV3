#!/usr/bin/env node
/**
 * READ-ONLY census: what breaks if six games move from preseason week 1 to week 2?
 *
 * Answers T1(a)(b)(c) for PR #392's data repair. It performs ZERO writes — there is
 * no code path in this file that calls set/update/delete/add/commit. Run it as many
 * times as you like.
 *
 * The six games being re-filed (measured 2026-08-06, season 2026 seasonType 1):
 *   espn_401873272 DET@CIN   espn_401873275 GB@PIT    espn_401873273 IND@NE
 *   espn_401873274 LAC@HOU   espn_401873640 ARI@LV    espn_401874392 TEN@SF
 *
 * WHY THIS EXISTS. Confidence values are validated ONLY at submit
 * (functions/src/nflPools.ts:475) against the legal set [17-N .. 16] where N is the
 * number of games in the week (functions/src/nflScoringEngine.ts:183-186). Scoring
 * never revalidates — it just sums stored values
 * (functions/src/nflScoringEngine.ts:165). Re-filing games changes N for BOTH weeks,
 * so a stored value can end up out of range or collide with one already used in the
 * destination week, and a game-count check will not show it.
 *
 * ⚠️ AN EMPTY RESULT FROM A RESTRICTED COLLECTION IS NOT EVIDENCE OF ABSENCE.
 * An unauthenticated REST read of `pools` returns 403 while `nfl_games` returns 200,
 * so a "zero" from an under-privileged identity is rules hiding data, not a real
 * zero. This script therefore FAILS LOUDLY if it cannot read `pools` at all, rather
 * than reporting zero.
 *
 * Usage (PowerShell 5.1 — one command per line, no && chaining):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\gridiron-admin.json"
 *   node <this file>
 *   node <this file> --json
 */

import admin from 'firebase-admin';

const PROJECT = 'gridiron-gamble-uzuqo';
const SEASON = '2026';
const SEASON_TYPE = 1;
const MOVING_IDS = [
  'espn_401873272', 'espn_401873275', 'espn_401873273',
  'espn_401873274', 'espn_401873640', 'espn_401874392',
];
const asJson = process.argv.includes('--json');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'REFUSING TO RUN: neither GOOGLE_APPLICATION_CREDENTIALS nor FIRESTORE_EMULATOR_HOST is set.\n' +
    'Without credentials the Admin SDK cannot read `pools`, and a zero result would be\n' +
    'indistinguishable from "rules hid everything" — the exact mistake this census exists\n' +
    'to avoid. Point GOOGLE_APPLICATION_CREDENTIALS at a service-account key.',
  );
  process.exit(2);
}

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

/** Legal confidence set for an N-game week: [17-N .. 16], unique. */
const legalRange = (n) => ({ min: 17 - n, max: 16 });

async function main() {
  // ---- 1. The games, before and after ----------------------------------------
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', SEASON)
    .where('seasonType', '==', SEASON_TYPE)
    .get();

  if (gamesSnap.empty) {
    throw new Error(
      `nfl_games returned ZERO docs for season ${SEASON} seasonType ${SEASON_TYPE}. ` +
      'That contradicts the measured state (week1=7, week2=10, week3=16, week4=16) and ' +
      'means this identity cannot see the collection. Not reporting a zero.',
    );
  }

  const byWeek = new Map();
  const teamsById = new Map();
  for (const d of gamesSnap.docs) {
    const g = d.data();
    const w = Number(g.week);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(d.id);
    teamsById.set(d.id, [g.homeTeam?.abbreviation, g.awayTeam?.abbreviation].filter(Boolean));
  }

  const week1Ids = new Set(byWeek.get(1) ?? []);
  const week2Ids = new Set(byWeek.get(2) ?? []);
  const moving = new Set(MOVING_IDS.filter((id) => week1Ids.has(id)));
  const movingNotInWeek1 = MOVING_IDS.filter((id) => !week1Ids.has(id));

  // Post-repair sizes: the six leave week 1 and join week 2.
  const before = { week1: week1Ids.size, week2: week2Ids.size };
  const after = { week1: week1Ids.size - moving.size, week2: week2Ids.size + moving.size };

  // Teams playing in the six moved games — Survivor/Margin key picks by WEEK and
  // store a TEAM abbreviation, never a game id, so "picks on those game ids" has to
  // be answered through the teams.
  const movingTeams = new Set();
  for (const id of moving) for (const t of teamsById.get(id) ?? []) movingTeams.add(t);

  // ⚠️ A TEAM IN A MOVING GAME IS NOT NECESSARILY STRANDED, and the first version of
  // this script got that wrong. Measured 2026-08-07: week 1's surviving game is
  // espn_401873271 CAR@ARI, and ARI ALSO plays espn_401873640 ARI@LV, which moves.
  // A Margin pick of ARI therefore still resolves in week 1 after the repair, but a
  // `movingTeams.has(pick)` test reported it as exposed — one false positive out of
  // one flagged entry. Stranded means the team plays in a moving game AND has no
  // game left in the week afterwards.
  const week1TeamsAfter = new Set();
  for (const id of week1Ids) {
    if (moving.has(id)) continue;
    for (const t of teamsById.get(id) ?? []) week1TeamsAfter.add(t);
  }
  const isStranded = (team) => movingTeams.has(team) && !week1TeamsAfter.has(team);

  // ---- 2. The pools -----------------------------------------------------------
  // Scanned, not queried: `season` is a string on NFL pools but the field has been
  // written by more than one path, and a where() on the wrong type silently returns
  // nothing — which would read as "no exposure".
  const poolsSnap = await db.collection('pools').get();
  if (poolsSnap.empty) {
    throw new Error(
      'pools returned ZERO docs. This identity cannot read the collection (rules), or ' +
      'the project is wrong. Refusing to report zero exposure — see the header note.',
    );
  }

  const NFL_TYPES = new Set(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);
  const candidates = poolsSnap.docs.filter((d) => {
    const p = d.data();
    if (!NFL_TYPES.has(p.type)) return false;
    if (String(p.season) !== SEASON) return false;
    return Number(p.seasonType ?? 2) === SEASON_TYPE;
  });

  const report = {
    scannedPools: poolsSnap.size,
    games: { before, after, movingFound: [...moving], movingNotInWeek1 },
    legalRange: {
      week1Before: legalRange(before.week1), week1After: legalRange(after.week1),
      week2Before: legalRange(before.week2), week2After: legalRange(after.week2),
    },
    pools: [],
    totals: {
      nflPreseasonPools: candidates.length,
      confidencePools: 0,
      confidenceEntriesWithWeek1or2Picks: 0,
      survivorMarginPoolsWithAffectedWeek1Pick: 0,
      entriesWithOutOfRangeConfidenceAfter: 0,
      entriesWithCollidingConfidenceInWeek2After: 0,
    },
  };

  for (const doc of candidates) {
    const p = doc.data();
    const confidenceMode = p.settings?.confidenceMode === true;
    if (p.type === 'NFL_PICKEM' && confidenceMode) report.totals.confidencePools++;

    const entriesSnap = await doc.ref.collection('entries').get();
    const row = {
      poolId: doc.id, type: p.type, confidenceMode,
      pickMode: p.settings?.pickMode, entries: entriesSnap.size,
      entriesTouchingWeek1or2: 0, affectedEntries: [],
    };

    for (const e of entriesSnap.docs) {
      const entry = e.data();
      const picks = entry.picks ?? {};
      const conf = entry.confidence ?? {};

      if (p.type === 'NFL_PICKEM') {
        const w1 = Object.keys(picks).filter((k) => week1Ids.has(k));
        const w2 = Object.keys(picks).filter((k) => week2Ids.has(k));
        if (w1.length === 0 && w2.length === 0) continue;
        row.entriesTouchingWeek1or2++;
        if (!confidenceMode) continue;
        report.totals.confidenceEntriesWithWeek1or2Picks++;

        // After the move: week 1 keeps only its non-moving ids; week 2 gains them.
        const stayW1 = w1.filter((id) => !moving.has(id));
        const movedToW2 = w1.filter((id) => moving.has(id));
        const r1 = legalRange(after.week1);
        const r2 = legalRange(after.week2);

        const outOfRange = [
          ...stayW1.filter((id) => conf[id] !== undefined && (conf[id] < r1.min || conf[id] > r1.max))
            .map((id) => ({ id, value: conf[id], week: 1, legal: r1 })),
          ...[...movedToW2, ...w2].filter((id) => conf[id] !== undefined && (conf[id] < r2.min || conf[id] > r2.max))
            .map((id) => ({ id, value: conf[id], week: 2, legal: r2 })),
        ];

        // Collisions inside the destination week AFTER the move.
        const seen = new Map();
        const collisions = [];
        for (const id of [...w2, ...movedToW2]) {
          const v = conf[id];
          if (v === undefined) continue;
          if (seen.has(v)) collisions.push({ value: v, ids: [seen.get(v), id] });
          else seen.set(v, id);
        }

        if (outOfRange.length) report.totals.entriesWithOutOfRangeConfidenceAfter++;
        if (collisions.length) report.totals.entriesWithCollidingConfidenceInWeek2After++;
        if (outOfRange.length || collisions.length) {
          // uid only — no email, no display name.
          row.affectedEntries.push({ uid: e.id, outOfRange, collisions });
        }
      } else {
        // Survivor / Margin: picks[week] = TEAM abbreviation.
        const w1pick = picks['1'] ?? picks[1];
        if (w1pick === undefined) continue;
        row.entriesTouchingWeek1or2++;
        if (isStranded(w1pick)) {
          row.affectedEntries.push({
            uid: e.id, week1Team: w1pick,
            reason: 'team plays ONLY in a game moving to week 2 — the week-1 pick is stranded',
          });
        }
      }
    }

    if (p.type !== 'NFL_PICKEM' && row.affectedEntries.length > 0) {
      report.totals.survivorMarginPoolsWithAffectedWeek1Pick++;
    }
    report.pools.push(row);
  }

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  const t = report.totals;
  console.log('=== Confidence / pick exposure for the week 1 -> week 2 re-file ===\n');
  console.log(`project ${PROJECT}   season ${SEASON}   seasonType ${SEASON_TYPE}`);
  console.log(`pools scanned: ${report.scannedPools}   NFL preseason pools: ${t.nflPreseasonPools}\n`);
  console.log(`games  week1 ${before.week1} -> ${after.week1}    week2 ${before.week2} -> ${after.week2}`);
  console.log(`       six moving ids found in week 1: ${report.games.movingFound.length}/6`);
  if (report.games.movingNotInWeek1.length) {
    console.log(`       ⚠️ NOT currently in week 1: ${report.games.movingNotInWeek1.join(', ')}`);
  }
  console.log(`legal confidence  week1 [${report.legalRange.week1Before.min}..16] -> [${report.legalRange.week1After.min}..16]`);
  console.log(`                  week2 [${report.legalRange.week2Before.min}..16] -> [${report.legalRange.week2After.min}..16]\n`);
  console.log(`(a) NFL_PICKEM pools with confidenceMode === true ......... ${t.confidencePools}`);
  console.log(`(b) confidence entries holding week 1 or 2 picks ........... ${t.confidenceEntriesWithWeek1or2Picks}`);
  console.log(`    of those, stored value out of range after the move .... ${t.entriesWithOutOfRangeConfidenceAfter}`);
  console.log(`    of those, colliding value inside week 2 after ......... ${t.entriesWithCollidingConfidenceInWeek2After}`);
  console.log(`(c) Survivor/Margin pools with a week 1 pick on a moved game ${t.survivorMarginPoolsWithAffectedWeek1Pick}\n`);
  for (const r of report.pools) {
    const flag = r.affectedEntries.length ? '⚠️ ' : '   ';
    console.log(`${flag}${r.poolId}  ${r.type}${r.confidenceMode ? ' [confidence]' : ''}  entries=${r.entries} touchingW1/W2=${r.entriesTouchingWeek1or2} affected=${r.affectedEntries.length}`);
    for (const a of r.affectedEntries) console.log(`      ${JSON.stringify(a)}`);
  }
  console.log('\nIf (a) and (c) are both 0 AND out-of-range/collision counts are 0, the repair is');
  console.log('safe as PLAN-NFL-IMPORT-SCOPE §6 currently writes it — amend §6 with this output');
  console.log('as the evidence. Otherwise §6 needs the remediation steps (T2).');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nCENSUS FAILED — verdict UNKNOWN, do NOT read this as zero exposure:\n', err);
  process.exit(1);
});
