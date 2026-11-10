import { useCallback, useState } from 'react';
import { fetchGamesOn, type ScheduleGame, type ScheduleLeague } from '../services/espnSchedule';

/**
 * "Find the games on a day" — the state behind a game picker.
 *
 * Two screens offer one: the squares create wizard's matchup step and the
 * matchup step on the squares manage page. They look nothing alike, so each
 * draws its own controls; this is the part they must not each reinvent. The
 * manage page's own search asked for a season type and a week and offered only
 * the postseason, so a regular-season game could not be linked there at all.
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
  const [league, setLeague] = useState<ScheduleLeague>(initialLeague);
  const [date, setDate] = useState(todayIso);
  const [games, setGames] = useState<ScheduleGame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGames(await fetchGamesOn(league, date));
    } catch (e) {
      setGames(null);
      setError(e instanceof Error && e.message ? e.message : 'The schedule could not be loaded. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [league, date]);

  const clear = useCallback(() => setGames(null), []);

  return { league, setLeague, date, setDate, games, loading, error, find, clear };
}
