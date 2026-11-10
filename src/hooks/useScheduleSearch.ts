import { useCallback, useRef, useState } from 'react';
import { fetchGamesOn, type ScheduleGame, type ScheduleLeague } from '../services/espnSchedule';

/**
 * "Find the games on a day" — the state behind a game picker.
 *
 * Two screens offer one: the squares create wizard's matchup step and the
 * matchup step on the squares manage page. They look nothing alike, so each
 * draws its own controls; this is the part they must not each reinvent. The
 * manage page's own search asked for a season type and a week and offered only
 * the postseason, so a regular-season game could not be linked there at all.
 *
 * THE LIST ON SCREEN IS ALWAYS THE ANSWER TO THE QUESTION ON SCREEN (qodo, PR
 * #760). Two ways it was not: changing the league or the date left the old
 * results showing under the new controls, and a slow search that finished
 * after a newer one replaced the newer one's results. Either way a
 * commissioner could click an NFL game while the dropdown read "College" and
 * link an NFL game id as a college game — a pool the score feed can never
 * find. So: changing either input clears the list, an answer to a question
 * that is no longer being asked is dropped, and every game carries the league
 * it was found in (`ScheduleGame.league`), which is the one a picker links.
 */

export const todayIso = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface ScheduleSearch {
  league: ScheduleLeague;
  setLeague: (league: ScheduleLeague) => void;
  /** `YYYY-MM-DD`, as a date input holds it. */
  date: string;
  setDate: (date: string) => void;
  /** `null` until a search has run; an empty array is "none that day". */
  games: ScheduleGame[] | null;
  loading: boolean;
  error: string | null;
  find: () => Promise<void>;
  /** Forget the last result (after a game is picked). */
  clear: () => void;
}

export function useScheduleSearch(initialLeague: ScheduleLeague = 'nfl'): ScheduleSearch {
  const [league, setLeagueState] = useState<ScheduleLeague>(initialLeague);
  const [date, setDateState] = useState(todayIso);
  const [games, setGames] = useState<ScheduleGame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which question is current. Every change of input and every new search
  // takes the next number; an answer is used only if its number still is.
  const asked = useRef(0);

  const forget = useCallback(() => {
    asked.current += 1;
    setGames(null);
    setError(null);
    setLoading(false);
  }, []);

  const setLeague = useCallback((next: ScheduleLeague) => { setLeagueState(next); forget(); }, [forget]);
  const setDate = useCallback((next: string) => { setDateState(next); forget(); }, [forget]);

  const find = useCallback(async () => {
    const mine = ++asked.current;
    setLoading(true);
    setError(null);
    try {
      const found = await fetchGamesOn(league, date);
      if (asked.current !== mine) return;
      setGames(found);
    } catch (e) {
      if (asked.current !== mine) return;
      setGames(null);
      setError(e instanceof Error && e.message ? e.message : 'The schedule could not be loaded. Try again in a moment.');
    } finally {
      if (asked.current === mine) setLoading(false);
    }
  }, [league, date]);

  return { league, setLeague, date, setDate, games, loading, error, find, clear: forget };
}
