// Expert Picks ingestion (compliant data source — the deferred "expert picks" feature).
//
// Produces two PUBLIC, per-game "expert" predictions, stored on nfl_games/{id}.expertPredictions:
//   - espnFpi: ESPN's Football Power Index game projection (win % + predicted margin), fetched
//              from ESPN's public FPI predictor endpoint (same host already used for scores /
//              spreads / win probability — no new vendor, no new ToS posture).
//   - vegas:   the betting-market implied pick, DERIVED from the spread we already ingest
//              (nfl_games/{id}.spread.value; negative => home favored). No fetch.
//
// These are external-model predictions, NOT pool-member picks — so there is no pre-lock leak
// concern (unlike shared/consensus). Best-effort: a fetch failure leaves prior data / empty state
// and never throws, exactly like winProbability.ts.
//
// NOTE: the expert-as-a-tracked-profile (weekly W-L record, performance chart, leaderboard
// placement — the AP Pro Picks screenshots) is deliberately NOT here; it shares the Player
// Profile data model and is planned alongside it. This module only ingests the raw predictions.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";

export type PickSide = 'HOME' | 'AWAY' | 'EVEN';

export interface VegasPick { pick: PickSide; spread: number }
export interface EspnFpiPick { pick: PickSide; homeWinPct: number; awayWinPct: number; predMargin: number }

/** Betting-market implied pick from our stored spread (value<0 => home favored). null if no line. */
export function vegasPickFromSpread(spreadValue: number | null | undefined): VegasPick | null {
  if (typeof spreadValue !== 'number' || Number.isNaN(spreadValue)) return null;
  const pick: PickSide = spreadValue < 0 ? 'HOME' : spreadValue > 0 ? 'AWAY' : 'EVEN';
  return { pick, spread: spreadValue };
}

const statVal = (stats: any[], name: string): number | null => {
  const s = (stats || []).find((x) => x?.name === name);
  if (!s) return null;
  const raw = s.displayValue ?? s.value;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
};
const teamIdFromRef = (ref: string | undefined): string | null => {
  const m = /\/teams\/(\d+)/.exec(ref || '');
  return m ? m[1] : null;
};

/**
 * Parse ESPN's FPI predictor JSON into a home-relative pick. homeTeamId/awayTeamId are our
 * stored ESPN team ids, used to orient the two sides correctly (falls back to the endpoint's
 * own homeTeam/awayTeam ordering if the refs don't match). Returns null if the projection is
 * absent (e.g. too far out, or bye).
 */
export function parseFpiPredictor(json: any, homeTeamId?: string, awayTeamId?: string): EspnFpiPick | null {
  const sideOf = (t: any) => t ? {
    id: teamIdFromRef(t.team?.$ref),
    gp: statVal(t.statistics, 'gameProjection'),
    pd: statVal(t.statistics, 'teamPredPtDiff'),
  } : null;
  const a = sideOf(json?.homeTeam);
  const b = sideOf(json?.awayTeam);
  if (!a || !b) return null;

  // Orient: which parsed side is OUR home? Prefer team-id match; else trust endpoint ordering.
  let home = a, away = b;
  if (homeTeamId) {
    if (b.id === homeTeamId && a.id !== homeTeamId) { home = b; away = a; }
    else if (a.id === homeTeamId) { home = a; away = b; }
    else if (awayTeamId && a.id === awayTeamId) { home = b; away = a; }
  }
  if (home.gp === null && away.gp === null) return null;

  const homeWinPct = home.gp !== null ? Math.round(home.gp) : (away.gp !== null ? 100 - Math.round(away.gp) : 0);
  const awayWinPct = 100 - homeWinPct;
  const predMargin = home.pd !== null ? home.pd : (away.pd !== null ? -away.pd : 0);
  const pick: PickSide = homeWinPct === awayWinPct ? 'EVEN' : homeWinPct > awayWinPct ? 'HOME' : 'AWAY';
  return { pick, homeWinPct, awayWinPct, predMargin };
}

/** Fetch + parse the FPI predictor for one ESPN event. Best-effort: null on any failure. */
async function fetchEspnFpi(espnEventId: string, homeTeamId?: string, awayTeamId?: string): Promise<EspnFpiPick | null> {
  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${espnEventId}/competitions/${espnEventId}/predictor`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return parseFpiPredictor(await res.json(), homeTeamId, awayTeamId);
  } catch {
    return null; // isolated — never throw
  }
}

/** Games worth predicting: in the active window and not long-finished. */
async function targetGames(db: admin.firestore.Firestore, now: number) {
  const snap = await db.collection('nfl_games')
    .where('startTime', '>=', now - 6 * 60 * 60 * 1000)
    .where('startTime', '<=', now + 8 * 24 * 60 * 60 * 1000)
    .get();
  return snap.docs;
}

/** Recompute expert predictions for the active window. Idempotent (overwrites). */
export async function recomputeExpertPicks(db: admin.firestore.Firestore, now: number): Promise<{ games: number; fpi: number; vegas: number }> {
  const docs = await targetGames(db, now);
  let fpi = 0, vegas = 0;
  for (const doc of docs) {
    const g: any = doc.data();
    if (g.status === 'FINAL') continue;
    const espnEventId = String(doc.id).replace(/^espn_/, '') || g.espnGameId;
    const espnFpi = espnEventId ? await fetchEspnFpi(String(espnEventId), g.homeTeam?.id, g.awayTeam?.id) : null;
    const vegasPick = vegasPickFromSpread(g.spread?.value);
    if (!espnFpi && !vegasPick) continue;

    const expertPredictions: any = { updatedAt: FieldValue.serverTimestamp() };
    if (espnFpi) { expertPredictions.espnFpi = { ...espnFpi, updatedAt: FieldValue.serverTimestamp() }; fpi++; }
    if (vegasPick) { expertPredictions.vegas = { ...vegasPick, updatedAt: FieldValue.serverTimestamp() }; vegas++; }
    await doc.ref.set({ expertPredictions }, { merge: true });
  }
  return { games: docs.length, fpi, vegas };
}

/** Scheduled: refresh expert predictions hourly (FPI moves slowly; cheap — active window only). */
export const syncExpertPicksJob = onSchedule('15 * * * *', async () => {
  const db = admin.firestore();
  try {
    const r = await recomputeExpertPicks(db, Date.now());
    console.log(`[expertPicks] ${r.games} games, ${r.fpi} FPI, ${r.vegas} vegas`);
  } catch (e) {
    console.error('[expertPicks] failed:', e);
  }
});

/** On-demand refresh (SUPER_ADMIN) for testing / manual trigger. */
export const refreshExpertPicks = onCall(async (request) => {
  if (!request.auth || request.auth.token?.role !== 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
  return recomputeExpertPicks(admin.firestore(), Date.now());
});
