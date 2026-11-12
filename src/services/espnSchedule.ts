/**
 * The games on a given day, from ESPN's public scoreboard — for the squares
 * create wizard's game picker (PLAN-SQUARES-REOPEN C1).
 *
 * BY DATE, not by week. The legacy picker on the squares admin page asks for a
 * season type and a week and only ever offered the postseason, so a
 * regular-season game — Thanksgiving, say — could not be linked at all, and an
 * unlinked pool is never scored for you. A commissioner knows the day their
 * game is on; they should not have to know it is "week 12".
 */

export type ScheduleLeague = 'nfl' | 'college';

export interface ScheduleGame {
  /** ESPN event id — what `gameId` on the pool is. */
  id: string;
  /**
   * The league whose schedule this game was FOUND in. A game id means nothing
   * without it — the score feed is asked for `(league, id)` — so it travels
   * with the game, and a picker links `game.league`, never whatever its league
   * dropdown happens to show by the time the game is clicked.
   */
  league: ScheduleLeague;
  /** Kickoff, epoch ms. */
  kickoff: number;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeLogo: string;
  awayLogo: string;
  /** ESPN season type: '1' preseason, '2' regular season, '3' postseason. */
  seasonType?: '1' | '2' | '3';
  week?: number;
  /** `pre` | `in` | `post` as ESPN reports it. */
  state: string;
}

const LEAGUE_PATH: Record<ScheduleLeague, string> = { nfl: 'nfl', college: 'college-football' };

/** `2026-11-26` → `20261126`, the form ESPN's `dates` parameter takes. `null` if it is not a date. */
export function espnDateParam(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Reject 2026-02-31 and the like, which `Date` would roll over to March.
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}${mo}${d}`;
}

export function scheduleUrl(league: ScheduleLeague, isoDate: string): string | null {
  const dates = espnDateParam(isoDate);
  if (!dates) return null;
  const base = `https://site.api.espn.com/apis/site/v2/sports/football/${LEAGUE_PATH[league]}/scoreboard?dates=${dates}`;
  // College: every FBS game, not ESPN's default top-25 slice.
  return league === 'college' ? `${base}&groups=80&limit=200` : base;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * ESPN's scoreboard payload → the games on it, earliest first.
 *
 * Tolerant by design: an event with no competition, a missing side, or an
 * unreadable date is LEFT OUT rather than shown half-filled — a game the
 * commissioner can pick must carry everything a link needs.
 */
export function mapScoreboard(payload: unknown, league: ScheduleLeague): ScheduleGame[] {
  const events = Array.isArray(obj(payload).events) ? (obj(payload).events as unknown[]) : [];
  const games: ScheduleGame[] = [];

  for (const raw of events) {
    const event = obj(raw);
    const competition = obj(Array.isArray(event.competitions) ? event.competitions[0] : undefined);
    const competitors = Array.isArray(competition.competitors) ? (competition.competitors as unknown[]).map(obj) : [];
    const home = obj(competitors.find((c) => c.homeAway === 'home')?.team);
    const away = obj(competitors.find((c) => c.homeAway === 'away')?.team);
    const id = str(event.id);
    const kickoff = Date.parse(str(event.date) || str(competition.date));
    const homeTeam = str(home.displayName) || str(home.name);
    const awayTeam = str(away.displayName) || str(away.name);
    if (!id || !Number.isFinite(kickoff) || !homeTeam || !awayTeam) continue;

    const seasonType = String(obj(event.season).type ?? '');
    const week = Number(obj(event.week).number);
    games.push({
      id,
      league,
      kickoff,
      homeTeam,
      awayTeam,
      homeAbbr: str(home.abbreviation),
      awayAbbr: str(away.abbreviation),
      homeLogo: str(home.logo),
      awayLogo: str(away.logo),
      ...(seasonType === '1' || seasonType === '2' || seasonType === '3' ? { seasonType } : {}),
      ...(Number.isInteger(week) && week > 0 ? { week } : {}),
      state: str(obj(obj(obj(event.status).type)).state) || str(obj(obj(competition.status).type).state) || 'pre',
    });
  }

  return games.sort((a, b) => a.kickoff - b.kickoff || a.id.localeCompare(b.id));
}

/** Kicked off — by the feed's own state, or by the clock if the feed is behind. */
export function hasStarted(g: Pick<ScheduleGame, 'state' | 'kickoff'>, nowMs: number = Date.now()): boolean {
  return g.state !== 'pre' || g.kickoff <= nowMs;
}

/** The games ESPN lists on `isoDate` — the day as the league schedule gives it (US Eastern). Throws on a network or ESPN failure. */
export async function fetchGamesOn(league: ScheduleLeague, isoDate: string): Promise<ScheduleGame[]> {
  const url = scheduleUrl(league, isoDate);
  if (!url) throw new Error('Pick a date first.');
  const response = await fetch(url);
  if (!response.ok) throw new Error('The schedule could not be loaded. Try again in a moment.');
  return mapScoreboard(await response.json(), league);
}
