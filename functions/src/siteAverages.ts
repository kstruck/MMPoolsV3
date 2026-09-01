import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { isReservedSubjectId } from "./shared/profile";
import { withHeartbeat } from "./lib/heartbeat";
import { assertCallerRole } from "./lib/assertRole";

/**
 * Site-wide weekly averages for the Performance Chart's "league average" line
 * (original Player Profiles requirement: player's line vs an average line; CONTEXT.md:
 * league averages are REAL aggregates, never hardcoded constants).
 *
 * Daily job folds every PLAYER publicProfiles doc's weekly rows into
 * publicProfiles/_siteAverages — one doc, world-readable via the existing
 * publicProfiles rule, served to the chart alongside the player's own rows.
 * Experts and reserved ids are excluded (an expert in the average would skew the
 * "league"). '_siteAverages' itself can never collide with a real uid (auto uids
 * are 28-char alphanumerics — no underscore).
 */

export interface SiteAverageRow {
  season: string;
  week: number;
  avgAccuracy: number; // mean of per-player weekly accuracy, players with picks that week
  players: number;
}

/** Pure fold: player profiles' weekly rows -> per (season, week) averages. */
export function computeSiteAverages(
  profiles: Array<{ subjectKind?: string; weekly?: Array<{ season: string; week: number; correct: number; total: number }> }>,
): SiteAverageRow[] {
  const agg = new Map<string, { season: string; week: number; sumAcc: number; players: number }>();
  for (const p of profiles) {
    if (p.subjectKind === 'EXPERT') continue;
    for (const w of p.weekly || []) {
      if (!w || !(w.total > 0)) continue;
      const key = `${w.season}|${w.week}`;
      const a = agg.get(key) || { season: w.season, week: w.week, sumAcc: 0, players: 0 };
      a.sumAcc += (w.correct / w.total) * 100;
      a.players++;
      agg.set(key, a);
    }
  }
  return [...agg.values()]
    .map(a => ({ season: a.season, week: a.week, avgAccuracy: Math.round(a.sumAcc / a.players), players: a.players }))
    .sort((a, b) => (a.season === b.season ? a.week - b.week : a.season.localeCompare(b.season)));
}

/** Page size × page cap = the scan bound (PLAN-API-TRUST-BOUNDARY Phase 4). */
export const SITE_AVERAGES_PAGE_SIZE = 1000;
export const SITE_AVERAGES_MAX_PAGES = 50;

export async function recomputeSiteAverages(db: admin.firestore.Firestore): Promise<{ rows: number; profiles: number }> {
  // Field projection: profiles carry sizable arrays (pickHistory, teamByTeam) the
  // average never reads — fetch only the two fields the fold consumes.
  //
  // PAGED (Phase 4): orderBy(documentId()) + startAfter in PAGE_SIZE chunks,
  // hard page cap. Hitting the cap ABORTS WITHOUT WRITING — `_siteAverages` is
  // world-readable and the profile chart renders its rows unchecked, so a
  // truncated aggregate must never replace a complete one. The throw reaches
  // the scheduled job's catch (→ {ok:false}, heartbeat unhealthy) and the
  // callable's framework-generic internal.
  const profiles: Array<{ subjectKind?: string; weekly?: Array<{ season: string; week: number; correct: number; total: number }> }> = [];
  let lastDocId: string | undefined;
  let pages = 0;
  for (;;) {
    // PAGE_SIZE + 1 sentinel row: an exactly-cap-sized collection must still
    // publish; only a collection that PROVABLY has more docs aborts (codex
    // review of the diff — the pre-check threw at exactly 50k).
    let q = db.collection('publicProfiles')
      .orderBy(admin.firestore.FieldPath.documentId())
      .select('weekly', 'subjectKind')
      .limit(SITE_AVERAGES_PAGE_SIZE + 1);
    if (lastDocId) q = q.startAfter(lastDocId);
    const snap = await q.get();
    pages++;
    const page = snap.docs.slice(0, SITE_AVERAGES_PAGE_SIZE);
    for (const d of page) {
      if (!isReservedSubjectId(d.id) && d.id !== '_siteAverages') profiles.push(d.data() as (typeof profiles)[number]);
    }
    const hasMore = snap.docs.length > SITE_AVERAGES_PAGE_SIZE;
    if (!hasMore) break;
    if (pages >= SITE_AVERAGES_MAX_PAGES) {
      throw new Error(
        `[siteAverages] publicProfiles exceeds ${SITE_AVERAGES_MAX_PAGES * SITE_AVERAGES_PAGE_SIZE} docs — aborting WITHOUT writing (the last complete aggregate stays published). Raise SITE_AVERAGES_MAX_PAGES deliberately.`,
      );
    }
    lastDocId = page[page.length - 1].id;
  }
  const weekly = computeSiteAverages(profiles);
  await db.collection('publicProfiles').doc('_siteAverages').set({
    kind: 'SITE_AVERAGES',
    weekly,
    profilesCounted: profiles.length,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { rows: weekly.length, profiles: profiles.length };
}

/** Daily refresh (cheap: one collection scan, bounded by user count). Best-effort. */
export const siteAveragesJob = onSchedule(
  // 03:30 ET. Was '30 7 * * *' unpinned == 07:30 UTC == 03:30 ET during EDT;
  // now fixed at 03:30 ET year-round. See __tests__/scheduleTimezones.test.ts.
  { schedule: '30 3 * * *', timeZone: 'America/New_York' },
  withHeartbeat('siteAveragesJob', async () => {
  try {
    const r = await recomputeSiteAverages(admin.firestore());
    console.log(`[siteAverages] ${r.rows} week-rows from ${r.profiles} profiles`);
    return { detail: { rows: r.rows, profiles: r.profiles } };
  } catch (e) {
    // The catch keeps a scheduled failure from becoming an unhandled rejection,
    // but the run did NOTHING. Without this the heartbeat would call that
    // healthy — the failure mode the wrapper exists to end.
    console.error('[siteAverages] failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}));

/** On-demand refresh (SUPER_ADMIN — claim+doc agreement, PLAN-AUDIT-AUTH-HARDENING A1). */
export const refreshSiteAverages = onCall(async (request) => {
  await assertCallerRole(request, 'SUPER_ADMIN');
  return recomputeSiteAverages(admin.firestore());
});
