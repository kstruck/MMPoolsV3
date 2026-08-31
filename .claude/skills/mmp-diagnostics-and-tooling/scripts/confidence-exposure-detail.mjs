#!/usr/bin/env node
/**
 * READ-ONLY detail pass behind confidence-exposure-census.mjs.
 *
 * The census answers "how many". This answers "so what", for the two things a
 * count cannot settle:
 *
 *  1. IS THE CONFIDENCE ZERO REAL? The census only flags a stored confidence value
 *     it can SEE — `conf[id] !== undefined`. An entry with picks but no stored
 *     confidence is skipped, so "0 out of range" could mean "no exposure" or "my
 *     predicate stepped over the gap". This prints every week-1/week-2 pick with
 *     its stored value or an explicit MISSING, so the zero can be read rather than
 *     trusted. Same rule as the 403 lesson: an empty result from a filter is not
 *     evidence of absence until you have seen what the filter skipped.
 *
 *  2. WHAT HAPPENS TO A STRANDED SURVIVOR/MARGIN PICK? Those pick maps are keyed by
 *     WEEK and hold a TEAM abbreviation, so when a game changes week the pick does
 *     not follow it. Three stored facts decide the remediation and none are
 *     derivable from the census: whether the entry also holds a pick for the
 *     destination week, whether the source week has ALREADY been scored (a stale
 *     `weeklyScores[week]` is never rewritten — see below), and whether the team is
 *     banked in `usedTeams` (Margin/Survivor forbid reuse, so a stranded pick can
 *     burn a team on a game the member never got scored for).
 *
 * WHY THE STALE-VALUE CASE IS THE DANGEROUS ONE. After the re-file, a Margin entry
 * whose picked team no longer plays that week is SKIPPED, not zeroed:
 *   functions/src/nflPools.ts:1271  `if (!weeklyPickReady(pick)) continue;`
 *   functions/src/nflPools.ts:1289  `if (res === null) continue;`
 * `continue` writes nothing. So a `weeklyScores[week]` written by an EARLIER pass —
 * when the game was still in that week — survives the re-score untouched and keeps
 * counting toward `seasonTotal`, which is re-summed over the whole map
 * (functions/src/nflPools.ts:1302). Re-scoring does not clear it.
 *
 * Zero writes. No set/update/delete/add/commit anywhere in this file.
 *
 * Usage (PowerShell 5.1 — one command per line, never && chaining):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\gridiron-admin.json"
 *   node .claude\skills\mmp-diagnostics-and-tooling\scripts\confidence-exposure-detail.mjs
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
    'A zero from an under-privileged identity is rules hiding data, not a real zero.',
  );
  process.exit(2);
}

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const NFL_TYPES = new Set(['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN']);
const legalRange = (n) => `[${17 - n}..16]`;
/** Pick a subset of keys, so nothing personal (userName, email) is ever printed. */
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

async function main() {
  const gamesSnap = await db.collection('nfl_games')
    .where('season', '==', SEASON).where('seasonType', '==', SEASON_TYPE).get();
  if (gamesSnap.empty) throw new Error('nfl_games returned ZERO — this identity cannot read it. Not reporting a zero.');

  const meta = new Map();       // gameId -> {week, home, away, status}
  for (const d of gamesSnap.docs) {
    const g = d.data();
    meta.set(d.id, {
      week: Number(g.week), home: g.homeTeam?.abbreviation, away: g.awayTeam?.abbreviation,
      status: g.status, startTime: g.startTime,
    });
  }
  const idsInWeek = (w) => [...meta.entries()].filter(([, m]) => m.week === w).map(([id]) => id);
  const week1 = new Set(idsInWeek(1));
  const week2 = new Set(idsInWeek(2));
  const moving = new Set(MOVING_IDS.filter((id) => week1.has(id)));

  // Post-repair membership.
  const week1After = new Set([...week1].filter((id) => !moving.has(id)));
  const week2After = new Set([...week2, ...moving]);
  const teamsAfter = (set) => new Set([...set].flatMap((id) => [meta.get(id)?.home, meta.get(id)?.away]).filter(Boolean));
  const week1TeamsAfter = teamsAfter(week1After);
  const movingTeams = teamsAfter(moving);

  const poolsSnap = await db.collection('pools').get();
  if (poolsSnap.empty) throw new Error('pools returned ZERO — rules hid it, or wrong project. Not reporting a zero.');

  const out = { games: {}, pools: [] };
  out.games = {
    week1Before: [...week1].map((id) => ({ id, ...meta.get(id) })),
    week2Count: week2.size,
    moving: [...moving].map((id) => ({ id, ...meta.get(id) })),
    week1AfterIds: [...week1After],
    legal: {
      week1: `${legalRange(week1.size)} -> ${legalRange(week1After.size)}`,
      week2: `${legalRange(week2.size)} -> ${legalRange(week2After.size)}`,
    },
  };

  const candidates = poolsSnap.docs.filter((d) => {
    const p = d.data();
    return NFL_TYPES.has(p.type) && String(p.season) === SEASON && Number(p.seasonType ?? 2) === SEASON_TYPE;
  });

  for (const doc of candidates) {
    const p = doc.data();
    const standings = await doc.ref.collection('standings').doc('current').get().catch(() => null);
    const row = {
      poolId: doc.id, type: p.type, status: p.status,
      settings: pick(p.settings ?? {}, ['confidenceMode', 'pickMode', 'lockMode', 'lockBufferMinutes', 'payoutMode', 'maxStrikes', 'maxRebuys', 'entryFee']),
      weekLockOverrides: p.settings?.weekLockOverrides ?? null,
      hardLockByWeek: p.hardLockByWeek ?? null,
      scoredWeeks: p.scoredWeeks ?? null,
      publishedWeeks: p.publishedWeeks ?? null,
      scoredThroughWeek: p.scoredThroughWeek ?? null,
      lastScoredAt: p.lastScoredAt ?? null,
      finalizedAt: p.finalizedAt ?? null,
      standingsLastScoredWeek: standings?.exists ? (standings.data()?.lastScoredWeek ?? null) : null,
      entries: [],
    };

    const entriesSnap = await doc.ref.collection('entries').get();
    for (const e of entriesSnap.docs) {
      const en = e.data();
      const picks = en.picks ?? {};
      const conf = en.confidence ?? {};
      const rec = {
        uid: e.id,
        ...pick(en, ['status', 'seasonTotal', 'totalScore', 'negativeBurden', 'eliminatedWeek', 'lastRebuyWeek', 'resultsVersion']),
        usedTeams: en.usedTeams ?? null,
        strikeWeeks: en.strikeWeeks ?? null,
        exemptWeeks: en.exemptWeeks ?? null,
        weeklyScores: en.weeklyScores ?? null,
        weeklyPoints: en.weeklyPoints ?? null,
        weeklyResultWeeks: en.weeklyResults ? Object.keys(en.weeklyResults) : null,
      };

      if (p.type === 'NFL_PICKEM') {
        // Every week-1/week-2 pick with its stored confidence, or an explicit
        // MISSING — this is the line that makes "0 out of range" readable.
        const sheet = [];
        for (const gameId of Object.keys(picks)) {
          if (!week1.has(gameId) && !week2.has(gameId)) continue;
          sheet.push({
            gameId,
            weekBefore: meta.get(gameId)?.week,
            weekAfter: moving.has(gameId) ? 2 : meta.get(gameId)?.week,
            confidence: Object.prototype.hasOwnProperty.call(conf, gameId) ? conf[gameId] : 'MISSING',
          });
        }
        if (sheet.length === 0) continue;
        rec.sheet = sheet.sort((a, b) => a.weekBefore - b.weekBefore);
        rec.confidenceKeysNotInW1W2 = Object.keys(conf).filter((k) => !week1.has(k) && !week2.has(k)).length;
      } else {
        const w1 = picks['1'] ?? picks[1];
        const w2 = picks['2'] ?? picks[2];
        if (w1 === undefined && w2 === undefined) continue;
        rec.week1Pick = w1 ?? null;
        rec.week2Pick = w2 ?? null;
        rec.week1PickStrandedAfter = w1 !== undefined && movingTeams.has(w1) && !week1TeamsAfter.has(w1);
        rec.week1AlreadyScored = en.weeklyScores?.[1] ?? en.weeklyScores?.['1'] ?? null;
        rec.destinationWeekOccupied = w2 !== undefined;
        rec.teamBankedInUsedTeams = Array.isArray(en.usedTeams) && w1 !== undefined ? en.usedTeams.includes(w1) : null;
      }
      row.entries.push(rec);
    }
    out.pools.push(row);
  }

  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  console.log('=== Detail pass: what the counts could not settle ===\n');
  console.log(`project ${PROJECT}   season ${SEASON}   seasonType ${SEASON_TYPE}`);
  console.log(`legal confidence  week1 ${out.games.legal.week1}   week2 ${out.games.legal.week2}\n`);
  console.log('week 1 as stored today:');
  for (const g of out.games.week1Before) {
    console.log(`  ${g.id}  ${g.away}@${g.home}  ${g.status}  ${moving.has(g.id) ? '-> MOVES TO WEEK 2' : '-> STAYS'}`);
  }
  console.log(`\nweek 1 after the repair: ${out.games.week1AfterIds.join(', ') || '(none)'}\n`);

  for (const r of out.pools) {
    console.log(`--- ${r.poolId}  ${r.type}  status=${r.status ?? 'n/a'}`);
    console.log(`    settings ${JSON.stringify(r.settings)}`);
    console.log(`    scoredWeeks=${JSON.stringify(r.scoredWeeks)} publishedWeeks=${JSON.stringify(r.publishedWeeks)} scoredThroughWeek=${r.scoredThroughWeek} standingsLastScoredWeek=${r.standingsLastScoredWeek}`);
    console.log(`    hardLockByWeek=${JSON.stringify(r.hardLockByWeek)} weekLockOverrides=${JSON.stringify(r.weekLockOverrides)}`);
    if (r.entries.length === 0) { console.log('    (no entries touching weeks 1-2)'); continue; }
    for (const en of r.entries) {
      console.log(`    entry ${en.uid}`);
      if (en.sheet) {
        const missing = en.sheet.filter((s) => s.confidence === 'MISSING').length;
        console.log(`      confidence sheet (${en.sheet.length} picks, ${missing} MISSING, ${en.confidenceKeysNotInW1W2} conf keys outside W1/W2):`);
        for (const s of en.sheet) console.log(`        ${s.gameId}  week ${s.weekBefore} -> ${s.weekAfter}   confidence=${s.confidence}`);
      } else {
        console.log(`      week1Pick=${en.week1Pick} week2Pick=${en.week2Pick} strandedAfter=${en.week1PickStrandedAfter}`);
        console.log(`      week1AlreadyScored=${en.week1AlreadyScored}  destinationWeekOccupied=${en.destinationWeekOccupied}  teamBankedInUsedTeams=${en.teamBankedInUsedTeams}`);
        console.log(`      usedTeams=${JSON.stringify(en.usedTeams)} weeklyScores=${JSON.stringify(en.weeklyScores)} seasonTotal=${en.seasonTotal}`);
      }
    }
  }
  console.log('\nRead `weeklyScores` on any stranded entry carefully: a value already there');
  console.log('SURVIVES the re-score, because the scorer `continue`s that entry and writes');
  console.log('nothing (nflPools.ts:1271, 1289) while seasonTotal re-sums the whole map.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nDETAIL PASS FAILED — verdict UNKNOWN, do NOT read as zero exposure:\n', err);
  process.exit(1);
});
