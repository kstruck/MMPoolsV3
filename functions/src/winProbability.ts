// Real Live Win Probability (ADR 0004). ESPN's scoreboard has no win-prob, so this hits the
// SEPARATE summary endpoint per in-progress game, fully isolated from the score sync — a
// failure here never blocks scores. Stored per-game at nfl_games/{id}/winprob/current so the
// season-wide score subscription isn't bloated. Best-effort: absent -> clients show empty state.
import * as admin from "firebase-admin";
import { ESPN_SITE_API } from './lib/espnHost';
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { withHeartbeat } from "./lib/heartbeat";

const MAX_HISTORY = 30;

interface WinProbPoint { homePct: number; at: number }

/** Fetch the latest home win probability (0-100) for one ESPN event, or null. */
async function fetchHomeWinPct(eventId: string): Promise<number | null> {
  try {
    const res = await fetch(`${ESPN_SITE_API}/football/nfl/summary?event=${eventId}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const wp = data?.winprobability;
    if (!Array.isArray(wp) || wp.length === 0) return null;
    const last = wp[wp.length - 1];
    const pct = last?.homeWinPercentage;
    if (typeof pct !== 'number') return null;
    return Math.max(0, Math.min(100, Math.round(pct * 100)));
  } catch {
    return null; // isolated — never throw
  }
}

export const syncWinProbabilityJob = onSchedule('*/5 * * * *', withHeartbeat('syncWinProbabilityJob', async () => {
  const db = admin.firestore();
  const liveSnap = await db.collection('nfl_games').where('status', '==', 'IN_PROGRESS').get();
  if (liveSnap.empty) return;

  for (const doc of liveSnap.docs) {
    const g: any = doc.data();
    const eventId = String(doc.id).replace(/^espn_/, '') || g.espnGameId;
    if (!eventId) continue;
    const homePct = await fetchHomeWinPct(eventId);
    if (homePct === null) continue; // best-effort; leave prior data / empty state

    const ref = doc.ref.collection('winprob').doc('current');
    const prior = (await ref.get()).data() as { history?: WinProbPoint[] } | undefined;
    const history = [...(prior?.history || []), { homePct, at: Date.now() }].slice(-MAX_HISTORY);
    await ref.set({
      homePct,
      awayPct: 100 - homePct,
      history,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}));
