/**
 * ESPN scoreboard fetches for a DATE WINDOW, without a date RANGE.
 *
 * ⚠️ WHY THIS EXISTS. `/scoreboard?dates=YYYYMMDD-YYYYMMDD` — one request for a
 * span — stopped working on 2026-09-15 (~21:55Z). ESPN now answers every range
 * with `HTTP 400 {"code":400,"message":"Failed to get events endpoint."}`.
 * Measured host-wide, for past seasons' dates too, so it is an ESPN API change
 * and not our data. The public /scoreboard page built exactly that URL for a
 * ±7-day window and threw `Failed to fetch scores` on every refresh.
 *
 * What still answers 200, measured from the live site's own origin on
 * 2026-09-23:
 *
 *   dates=202609            -> 200, 48 NFL events / 323 college-football events
 *   dates=20260920          -> 200, a single day
 *   (no dates)              -> 200, the current week only
 *   dates=20260916-20260930 -> 400
 *
 * So a window is covered by fetching the MONTHS it spans — one or two requests
 * for a ±7-day window — and filtering client-side. Per-day fetches would also
 * work and cost fifteen requests every 30-second refresh instead of two.
 *
 * ⚠️ DO NOT RAISE `limit` ABOVE 500. Measured the same day on college-football
 * for `dates=202609`: limit 200, 300 and 500 all return the full 323 events
 * (ESPN ignores the cap), but **limit=900 returns 25** — it silently falls back
 * to something like the current week. A bigger number quietly returns LESS.
 */

/**
 * The ±`days` window around an instant, as the page means it.
 *
 * Takes the instant as a NUMBER rather than reading the clock itself, which is
 * the whole point: the caller passes `now()` from `utils/serverClock`, the
 * server-corrected clock every lock and countdown in this app already uses. A
 * device clock that is wrong by a day silently shifts this window, and the page
 * then presents another week's games as the current ones with no way for the
 * viewer to tell. (qodo #1 on PR #701.)
 *
 * Day arithmetic is LOCAL, matching what it replaced and what the viewer means
 * by "the last week" — only the month keys derived from it are UTC, because
 * that is what ESPN's `dates=` parameter is.
 */
export function windowAround(nowMs: number, days = 7): { start: Date; end: Date } {
  const start = new Date(nowMs);
  start.setDate(start.getDate() - days);
  const end = new Date(nowMs);
  end.setDate(end.getDate() + days);
  return { start, end };
}

/** ESPN's `dates=` month form, e.g. `202609`. */
export function monthKeysForWindow(start: Date, end: Date): string[] {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end.getTime() < start.getTime()) return [];
  const keys: string[] = [];
  // Iterated on a UTC cursor so a window crossing a YEAR boundary (a December
  // NFL week reaching into January) rolls the year over instead of emitting
  // month 13. The dates in `dates=` are UTC as far as ESPN is concerned.
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor.getTime() <= last.getTime()) {
    keys.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

export type FootballLeaguePath = 'nfl' | 'college-football';

/** One URL per month the window touches, in chronological order. */
export function scoreboardMonthUrls(
  leaguePath: FootballLeaguePath,
  start: Date,
  end: Date,
  limit = 200,
): string[] {
  return monthKeysForWindow(start, end).map(
    (m) => `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard?dates=${m}&limit=${limit}`,
  );
}

/** The inclusive day bounds of a window, as epoch ms. */
function dayBounds(start: Date, end: Date): { from: number; to: number } {
  const from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const to = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999);
  return { from, to };
}

export interface ScoreboardWindowResult<T> {
  events: T[];
  /** How many month requests were made, and how many of them failed. */
  monthsRequested: number;
  monthsFailed: number;
}

/**
 * Fetch every month the window touches and return the events inside it.
 *
 * PARTIAL FAILURE IS REPORTED, NOT SWALLOWED. One month failing while the other
 * succeeds still renders the games we have — a blank page would be a worse
 * answer than a short one — but `monthsFailed` lets the caller say so. Only when
 * EVERY request fails does this throw, which is the honest "we know nothing"
 * case the page's error state is for.
 */
export async function fetchScoreboardWindow<T extends { id?: string; date?: string }>(
  leaguePath: FootballLeaguePath,
  start: Date,
  end: Date,
  fetchImpl: typeof fetch = fetch,
  limit = 200,
): Promise<ScoreboardWindowResult<T>> {
  const urls = scoreboardMonthUrls(leaguePath, start, end, limit);
  if (urls.length === 0) throw new Error('Failed to fetch scores');
  const { from, to } = dayBounds(start, end);

  // Deduped by id: ESPN can return the same event under two months only if it
  // moved, but a flex that crosses a month boundary is exactly the case where
  // showing one game twice would look like a data bug.
  const byId = new Map<string, T>();
  const unidentified: T[] = [];
  let monthsFailed = 0;

  for (const url of urls) {
    try {
      const resp = await fetchImpl(url);
      if (!resp.ok) { monthsFailed++; continue; }
      const data = await resp.json() as { events?: T[] };
      for (const ev of data?.events ?? []) {
        const at = ev?.date ? new Date(ev.date).getTime() : NaN;
        // An event with no usable date is KEPT. The window is a convenience,
        // and dropping a live game because ESPN changed a field name is the
        // failure this page exists to avoid.
        if (Number.isFinite(at) && (at < from || at > to)) continue;
        if (typeof ev?.id === 'string') byId.set(ev.id, ev); else unidentified.push(ev);
      }
    } catch {
      monthsFailed++;
    }
  }

  if (monthsFailed === urls.length) throw new Error('Failed to fetch scores');
  return { events: [...byId.values(), ...unidentified], monthsRequested: urls.length, monthsFailed };
}
