// firestore-census.mjs — READ-ONLY production Firestore diagnostics for March Melee Pools.
//
// Answers, in one pass over /pools plus two single-doc reads:
//   1. Stuck-open pools: event is over (scores.gameStatus=='post' or isFinal==true)
//      but the pool is not CANCELED/COMPLETED and was never admin-closed.
//      (Mirrors isAutoCloseEligible in functions/src/lib/lifecycle.ts:71-77.)
//   2. Pools missing the `billing` field (Firestore cannot query for a missing
//      field, so this needs a scan — that is why this script exists).
//   3. Test-pool census: pools whose NAME contains the word "test" (case-
//      insensitive, word-bounded — covers every simulator prefix AND names
//      like "… TEST 5") or whose slug starts "sim-". Naming is a heuristic
//      for finding candidates; `isTestPool: true` is the real marker.
//   4. Freshness of system/scoreSync (squares score-sync heartbeat) and
//      health/latest (hourly adminHealth snapshot).
//
// THIS SCRIPT NEVER WRITES. It is safe to run against prod at any time.
//
// Usage (from repo root D:\march-melee-pools; run `npm --prefix functions install` first —
// firebase-admin is resolved from functions/node_modules):
//   node .claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs
//   node .claude/skills/mmp-diagnostics-and-tooling/scripts/firestore-census.mjs --json
//
// Credentials (checked in order):
//   1. FIRESTORE_EMULATOR_HOST set        -> emulator, no key needed
//   2. GOOGLE_APPLICATION_CREDENTIALS set -> that key file (keep it OUTSIDE the repo)
//   3. <repoRoot>/scripts/service-account.json (legacy repo convention;
//      gitignored since 2026-07-26 — still prefer option 2)

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// .claude/skills/mmp-diagnostics-and-tooling/scripts -> 4 levels up = repo root
const REPO_ROOT = join(SCRIPT_DIR, '..', '..', '..', '..');
const require = createRequire(join(REPO_ROOT, 'functions', 'package.json'));
const admin = require('firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'gridiron-gamble-uzuqo';
const AS_JSON = process.argv.includes('--json');
const SAMPLE_CAP = 20;

const TERMINAL_STATUSES = ['CANCELED', 'COMPLETED']; // lib/lifecycle.ts:17
// Word-boundary "test" anywhere in the name, case-insensitive. Replaces a
// PREFIX-ONLY list ('AI Test -', 'Bracket Test -', 'Playoff Test -',
// 'Props Test -', 'E2E Full Tournament Test' — all of which this still
// matches) because the prefix form could not see a pool with "Test" at the
// END of its name: "Kevin Struck's 2026 NFL Weekly Pick'em TEST 5"
// (XMKNsLhj1B1w5njsR5sm) counted toward the public totals and the census
// never listed it (K12, 2026-07-26). The word boundary keeps "Contest" /
// "Greatest" from matching. Recall over precision: a false positive is one
// extra row for Kevin to glance at, a false negative is a test pool silently
// inside the public stats.
const TEST_NAME_PATTERN = /\btest\b/i;

function initApp() {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
        admin.initializeApp({ projectId: PROJECT_ID });
        return `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST} (project ${PROJECT_ID})`;
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
        return `PRODUCTION via GOOGLE_APPLICATION_CREDENTIALS (project ${PROJECT_ID})`;
    }
    const saPath = join(REPO_ROOT, 'scripts', 'service-account.json');
    if (existsSync(saPath)) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
        return `PRODUCTION via ${saPath}`;
    }
    console.error('No credentials. Set FIRESTORE_EMULATOR_HOST, or GOOGLE_APPLICATION_CREDENTIALS,');
    console.error(`or place a service-account key at ${saPath} (and keep it out of git).`);
    process.exit(1);
}

// Name/slug HEURISTIC. Renamed from isTestPool to end a collision with the real
// predicate below — they answer different questions and one of them is authority.
function looksLikeTestPoolByName(name, slug) {
    if (typeof slug === 'string' && slug.startsWith('sim-')) return true;
    if (typeof name !== 'string') return false;
    return TEST_NAME_PATTERN.test(name);
}

// Deliberately does NOT import shared/testPool.ts and re-run the discriminator
// here. Two reasons, and the second is the important one:
//   1. It would tie this read-only diagnostic to a specific merge order.
//   2. A second copy of that rule is the defect PLAN-STATS-INTEGRITY §2.4 is
//      about. Printing the three INPUTS the predicate reads is strictly better
//      than printing a verdict: it stays true whatever the predicate does next,
//      and it shows Kevin *why* a pool is or is not caught.

function ageMinutes(ms) {
    return typeof ms === 'number' ? Math.round((Date.now() - ms) / 60000) : null;
}

async function run() {
    const mode = initApp();
    const db = admin.firestore();

    // Single field-masked scan of /pools (read-only; ~1 read per pool doc).
    const snap = await db
        .collection('pools')
        .select(
            'name', 'slug', 'status', 'closedVia', 'isFinal', 'type', 'billing', 'scores.gameStatus',
            // Stats discriminator inputs (PLAN-STATS-INTEGRITY §8.1 / K12).
            'simRunId', 'season', 'seasonType', 'isTestPool', 'createdAt', 'isLocked', 'scoredThroughWeek',
        )
        .get();

    const stuckOpen = [];
    const missingBilling = [];
    const testPools = [];
    // K12 (§8.2): every pool the NAME heuristic calls a test pool, with the three
    // discriminator inputs alongside. §2.6 predicted this set — the legacy
    // Squares/Props/Playoff runners create through the normal path, so they carry
    // no simRunId and a non-preseason type, and no filter can find them.
    //
    // A row where simRunId is null AND season is not `sim-…` AND seasonType is not
    // 1 AND isTestPool is null is one the discriminator does NOT catch: THAT is
    // the pool Kevin labels with `isTestPool: true`. If every row has at least one
    // marker, the discriminator is complete and §8.2 step 0b never happens.
    const unmarkedLegacyTestPools = [];
    const byTypeAndSeasonType = {};

    for (const doc of snap.docs) {
        const d = doc.data();
        const row = { id: doc.id, name: d.name ?? null, type: d.type ?? null, status: d.status ?? null };

        const eventOver = d.scores?.gameStatus === 'post' || d.isFinal === true;
        const terminal = TERMINAL_STATUSES.includes(d.status);
        if (eventOver && !terminal && d.closedVia !== 'ADMIN_CLOSE') stuckOpen.push(row);

        if (d.billing === undefined) missingBilling.push(row);

        const byName = looksLikeTestPoolByName(d.name, d.slug);
        if (byName) testPools.push({ ...row, slug: d.slug ?? null });

        const key = `${d.type ?? '?'}/seasonType=${d.seasonType ?? '(unset)'}`;
        byTypeAndSeasonType[key] = (byTypeAndSeasonType[key] ?? 0) + 1;

        if (byName) {
            unmarkedLegacyTestPools.push({
                ...row,
                slug: d.slug ?? null,
                season: d.season ?? null,
                seasonType: d.seasonType ?? null,
                simRunId: d.simRunId ?? null,
                isTestPool: d.isTestPool ?? null,
                createdAt: d.createdAt ?? null,
                isLocked: d.isLocked ?? null,
                scoredThroughWeek: d.scoredThroughWeek ?? null,
            });
        }
    }

    // Heartbeats (single-doc reads; Admin SDK bypasses rules).
    const [scoreSync, healthLatest] = await Promise.all([
        db.doc('system/scoreSync').get(),
        db.doc('health/latest').get(),
    ]);
    const ss = scoreSync.data() ?? {};
    const hl = healthLatest.data() ?? {};

    const report = {
        mode,
        scannedPools: snap.size,
        stuckOpen: { count: stuckOpen.length, sample: stuckOpen.slice(0, SAMPLE_CAP) },
        missingBilling: { count: missingBilling.length, sample: missingBilling.slice(0, SAMPLE_CAP) },
        testPools: { count: testPools.length, sample: testPools.slice(0, SAMPLE_CAP) },
        // K12 — no sample cap: this list is meant to be acted on, not skimmed.
        unmarkedLegacyTestPools: { count: unmarkedLegacyTestPools.length, rows: unmarkedLegacyTestPools },
        byTypeAndSeasonType,
        heartbeats: {
            scoreSync: {
                exists: scoreSync.exists,
                status: ss.status ?? null,
                lastSyncAt: ss.lastSyncAt ?? null,
                ageMinutes: ageMinutes(ss.lastSyncAt),
            },
            healthLatest: {
                exists: healthLatest.exists,
                updatedAt: hl.updatedAt ?? null,
                ageMinutes: ageMinutes(hl.updatedAt),
                failingChecks: hl.latest?.checks
                    ? Object.entries(hl.latest.checks)
                        .filter(([, c]) => c && c.ok === false)
                        .map(([k, c]) => `${k}: ${c.detail}`)
                    : [],
            },
        },
    };

    if (AS_JSON) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    console.log(`\n=== Firestore census (READ-ONLY) — ${mode} ===`);
    console.log(`Scanned ${report.scannedPools} pool docs.\n`);
    for (const [label, section] of [
        ['Stuck-open pools (event over, never closed)', report.stuckOpen],
        ['Pools missing `billing` field', report.missingBilling],
        ['Test/sim pools (Test Suite leftovers)', report.testPools],
    ]) {
        console.log(`-- ${label}: ${section.count}`);
        for (const r of section.sample) {
            console.log(`   ${r.id}  [${r.type ?? '?'}/${r.status ?? '?'}] ${r.name ?? '(no name)'}${r.slug ? `  slug=${r.slug}` : ''}`);
        }
        if (section.count > SAMPLE_CAP) console.log(`   ... and ${section.count - SAMPLE_CAP} more (use --json for full sample cap)`);
        console.log('');
    }
    console.log('-- Pools by type / seasonType (stats scope):');
    for (const [k, n] of Object.entries(report.byTypeAndSeasonType).sort()) console.log(`   ${k}: ${n}`);
    console.log('');

    console.log(`-- K12: test-named pools with their discriminator inputs: ${report.unmarkedLegacyTestPools.count}`);
    console.log('   LABEL any row marked NEEDS-LABEL: set `isTestPool: true` (boolean) on that');
    console.log('   pool doc in the Firestore console. Rows marked "caught by" are already excluded.');
    for (const r of report.unmarkedLegacyTestPools.rows) {
        const caughtBy =
            r.simRunId ? 'simRunId'
            : (typeof r.season === 'string' && r.season.startsWith('sim-')) ? 'sim- season'
            : Number(r.seasonType || 2) === 1 ? 'preseason seasonType=1'
            : r.isTestPool === true ? 'isTestPool flag'
            : null;
        console.log(`   ${r.id}  [${r.type ?? '?'}/seasonType=${r.seasonType ?? '(unset)'}] season=${r.season ?? '(unset)'} simRunId=${r.simRunId ?? '-'} isTestPool=${r.isTestPool ?? '-'}  ${caughtBy ? `caught by ${caughtBy}` : '*** NEEDS-LABEL ***'}  ${r.name ?? '(no name)'}`);
    }
    console.log('');

    const hb = report.heartbeats;
    console.log(`-- system/scoreSync: ${hb.scoreSync.exists ? `status=${hb.scoreSync.status}, ${hb.scoreSync.ageMinutes} min old` : 'MISSING'}`);
    console.log(`-- health/latest:    ${hb.healthLatest.exists ? `${hb.healthLatest.ageMinutes} min old, failing: ${hb.healthLatest.failingChecks.length ? hb.healthLatest.failingChecks.join('; ') : 'none'}` : 'MISSING'}`);
    console.log('\nNo writes were made.');
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
