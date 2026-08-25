// syncScanCensus.mjs — READ-ONLY production measurement for the
// PLAN-AUDIT-SCAN-BOUNDS Phase 2 decision gate.
//
// Why this exists and not firestore-census.mjs: the census script answers
// lifecycle questions over /pools (stuck-open, missing billing, test pools). It
// never touches system_logs and it does not replay the two queries
// syncGameStatus actually issues, which is exactly what the Phase 2 gate needs.
//
// Three sections:
//   1. LOG HISTORY — syncGameStatus writes one `SYNC_GAME_STATUS` doc to
//      system_logs per run that found pools (details.{activePools,
//      completedPools, totalPoolsFound, poolsProcessed, errors} and, since
//      PR #549, skippedDead). Note the job writes NOTHING on a zero-pool run
//      (early return at scoreUpdates.ts `allPools.length === 0`), so missing
//      days mean "found nothing", not "did not run" — check system/scoreSync.
//   2. LIVE READ SET — replays both production queries and classifies the
//      results with the same isDeadSyncPool predicate the job uses. Independent
//      of log retention.
//   3. POOL POPULATION — the denominator, plus how many pools the `!= "post"`
//      query can never match (Firestore `!=` skips docs missing the field).
//
// THIS SCRIPT NEVER WRITES. Safe against prod at any time.
//
// Usage (repo root; PowerShell — one command per line, no `&&`):
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\mmp-census.json"
//   node scripts/syncScanCensus.mjs
//   node scripts/syncScanCensus.mjs --scan 20000
//
// --scan N caps how many system_logs docs the history pass reads (default
// 12000). Each one is a billed read, so raise it deliberately.

import admin from "firebase-admin";

const args = process.argv.slice(2);
const scanIdx = args.indexOf("--scan");
const SCAN = scanIdx >= 0 && args[scanIdx + 1] ? Number(args[scanIdx + 1]) : 12000;

const TERMINAL_STATUSES = ["CANCELED", "COMPLETED"];
const ADMIN_CLOSE = "ADMIN_CLOSE";
const DEAD_PRE_MS = 7 * 24 * 60 * 60 * 1000;

// Mirrors functions/src/lib/scanBounds.ts:isDeadSyncPool exactly.
function isDeadSyncPool(pool, nowMs) {
  if (pool?.status && TERMINAL_STATUSES.includes(pool.status)) return true;
  if (pool?.closedVia === ADMIN_CLOSE) return true;
  if (pool?.scores?.gameStatus === "pre" && pool.scores.startTime) {
    const start = new Date(pool.scores.startTime).getTime();
    if (Number.isFinite(start) && start > 0 && nowMs - start > DEAD_PRE_MS) return true;
  }
  return false;
}

function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    max: s[s.length - 1],
    mean: Number((s.reduce((a, b) => a + b, 0) / s.length).toFixed(3)),
    nonzero: s.filter((v) => v > 0).length,
  };
}

async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const now = Date.now();
  const out = { generatedAt: new Date(now).toISOString(), scanLimit: SCAN };

  // ---- 1. SYNC_GAME_STATUS history ----------------------------------------
  // A (type == X AND timestamp >= T) composite query needs an index this
  // project does not have (FAILED_PRECONDITION / code 9), so scan newest-first
  // and filter in memory. system_logs.timestamp is mixed-typed (server jobs
  // write Timestamps, logClientError writes epoch-ms numbers); Firestore orders
  // numbers before timestamps, so `desc` puts the server docs first.
  const snap = await db.collection("system_logs").orderBy("timestamp", "desc").limit(SCAN).get();
  const act = [], comp = [], tot = [], dur = [], skip = [];
  const byDay = new Map();
  const byStatus = {};
  let sampled = 0, oldest = null, newest = null;
  for (const d of snap.docs) {
    const v = d.data();
    if (v.type !== "SYNC_GAME_STATUS") continue;
    sampled++;
    const ts = v.timestamp?.toMillis ? v.timestamp.toMillis() : Number(v.timestamp);
    if (Number.isFinite(ts)) {
      if (oldest === null || ts < oldest) oldest = ts;
      if (newest === null || ts > newest) newest = ts;
      const day = new Date(ts).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    byStatus[v.status || "?"] = (byStatus[v.status || "?"] || 0) + 1;
    if (Number.isFinite(v.durationMs)) dur.push(v.durationMs);
    const det = v.details;
    if (!det) continue;
    if (Number.isFinite(det.activePools)) act.push(det.activePools);
    if (Number.isFinite(det.completedPools)) comp.push(det.completedPools);
    if (Number.isFinite(det.totalPoolsFound)) tot.push(det.totalPoolsFound);
    if (Number.isFinite(det.skippedDead)) skip.push(det.skippedDead);
  }
  out.logHistory = {
    systemLogsDocsScanned: snap.size,
    syncGameStatusDocs: sampled,
    oldest: oldest ? new Date(oldest).toISOString() : null,
    newest: newest ? new Date(newest).toISOString() : null,
    statusCounts: byStatus,
    runsPerDay: Object.fromEntries([...byDay.entries()].sort()),
    activePools_notEqualPostQuery: stats(act),
    completedPools_recentPostQuery: stats(comp),
    totalPoolsFound: stats(tot),
    skippedDead_phase1Counter: stats(skip),
    durationMs: stats(dur),
  };

  // ---- 2. Live replay of both production queries ---------------------------
  const fields = ["status", "closedVia", "gameId", "type", "scores"];
  const activeSnap = await db.collection("pools")
    .where("scores.gameStatus", "!=", "post").select(...fields).get();
  const sixHoursAgo = admin.firestore.Timestamp.fromMillis(now - 6 * 60 * 60 * 1000);
  const completedSnap = await db.collection("pools")
    .where("scores.gameStatus", "==", "post")
    .where("updatedAt", ">=", sixHoursAgo).select(...fields).get();

  const classify = (s) => {
    const r = { returned: s.size, noGameId: 0, dead: 0, live: 0, byType: {}, byGameStatus: {} };
    for (const d of s.docs) {
      const p = d.data();
      r.byType[p.type || "(none)"] = (r.byType[p.type || "(none)"] || 0) + 1;
      r.byGameStatus[p.scores?.gameStatus || "(none)"] =
        (r.byGameStatus[p.scores?.gameStatus || "(none)"] || 0) + 1;
      if (!p.gameId) { r.noGameId++; continue; }
      if (isDeadSyncPool(p, now)) r.dead++; else r.live++;
    }
    return r;
  };
  const a = classify(activeSnap), c = classify(completedSnap);
  // Firestore bills a minimum of one read for a query that matches nothing.
  const billed = Math.max(a.returned, 1) + Math.max(c.returned, 1);
  out.liveReadSet = {
    activeQuery: a,
    recentPostQuery: c,
    billedDocReadsPerRun: billed,
    wastedDocReadsPerRun: a.dead + a.noGameId + c.dead + c.noGameId,
    readsPerDay_at1440Runs: billed * 1440,
  };

  // ---- 3. Pool population --------------------------------------------------
  const allPools = await db.collection("pools").select("scores").get();
  let withGs = 0, post = 0;
  for (const d of allPools.docs) {
    const gs = d.data()?.scores?.gameStatus;
    if (gs !== undefined && gs !== null) withGs++;
    if (gs === "post") post++;
  }
  out.poolPopulation = {
    totalPools: allPools.size,
    withScoresGameStatus: withGs,
    gameStatusPost: post,
    noGameStatusField_neverMatchedByNotEquals: allPools.size - withGs,
  };

  // ---- 4. Heartbeat --------------------------------------------------------
  const hb = await db.doc("system/scoreSync").get();
  const hbData = hb.exists ? hb.data() : null;
  out.scoreSyncHeartbeat = hbData
    ? { ...hbData, ageSeconds: Math.round((now - Number(hbData.lastSyncAt)) / 1000) }
    : null;

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FAILED:", e.code || "", e.message);
  process.exit(1);
});
