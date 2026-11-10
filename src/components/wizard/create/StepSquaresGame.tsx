import { useFormContext } from 'react-hook-form';
import { NumberField, SelectField, TextField } from '../fields';
import { HelpTip } from '../../ui/HelpTip';
import type { ScheduleGame, ScheduleLeague } from '../../../services/espnSchedule';
import { useScheduleSearch } from '../../../hooks/useScheduleSearch';

/**
 * The squares wizard's matchup step (PLAN-SQUARES-REOPEN C1).
 *
 * PICK THE GAME, DON'T JUST NAME THE TEAMS. A squares pool is only scored for
 * you if it is linked to a game on the live feed, and it only locks itself at
 * kickoff if it knows when kickoff is. The step this replaces had two free-text
 * team fields and nothing else — so every pool it created had to be scored and
 * locked by hand, and nothing on the form said so.
 *
 * The team fields stay, for a game that is not on the feed. Their labels now
 * say which side of the grid each team is on, and say it correctly: the grid
 * and the scorer both put the HOME team across the top (columns) and the AWAY
 * team down the side (rows). The old labels had it the other way round.
 */

const kickoffText = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const inputCls =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500';

export function StepSquaresGame() {
  const { setValue, watch } = useFormContext();
  const gameId = (watch('gameId') as string | undefined) || '';
  const gameTime = watch('gameTime') as number | undefined;
  const homeTeam = (watch('homeTeam') as string | undefined) || '';
  const awayTeam = (watch('awayTeam') as string | undefined) || '';

  const { league, setLeague, date, setDate, games, loading, error, find: findGames, clear, hasStarted } =
    useScheduleSearch((watch('league') as ScheduleLeague | undefined) || 'nfl');

  const set = (name: string, value: unknown) => setValue(name, value, { shouldDirty: true, shouldValidate: true });

  const pick = (g: ScheduleGame) => {
    set('gameId', g.id);
    set('gameTime', g.kickoff);
    // The league the game was FOUND in — not the dropdown, which may have moved.
    set('league', g.league);
    set('homeTeam', g.homeTeam);
    set('awayTeam', g.awayTeam);
    set('homeTeamLogo', g.homeLogo || undefined);
    set('awayTeamLogo', g.awayLogo || undefined);
    set('seasonType', g.seasonType);
    set('week', g.week);
    clear();
  };

  const unlink = () => {
    set('gameId', '');
    set('gameTime', undefined);
    set('league', undefined);
    set('homeTeamLogo', undefined);
    set('awayTeamLogo', undefined);
    set('seasonType', undefined);
    set('week', undefined);
  };

  return (
    <div>
      <h3 className="mb-1 text-lg font-bold text-white">The matchup &amp; grid</h3>
      <p className="mb-5 text-sm text-slate-400">Which game this pool is on, and how the grid works.</p>

      <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <div className="mb-3 flex items-center gap-1.5 text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wide">The game</span>
          <HelpTip helpId="squares.game" />
        </div>

        {gameId ? (
          <div data-testid="squares-linked-game">
            <p className="text-sm font-bold text-white">{awayTeam} at {homeTeam}</p>
            {typeof gameTime === 'number' && <p className="text-sm text-slate-300">{kickoffText(gameTime)}</p>}
            <p className="mt-2 text-xs text-emerald-400">
              Linked. Scores come in on their own, and the grid locks itself just before kickoff.
            </p>
            <button type="button" onClick={unlink} className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">
              Choose a different game
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label htmlFor="squares-game-league" className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span className="mb-1 block">League</span>
                <select id="squares-game-league" value={league} onChange={(e) => setLeague(e.target.value as ScheduleLeague)} className={`${inputCls} normal-case`}>
                  <option value="nfl">NFL</option>
                  <option value="college">College football</option>
                </select>
              </label>
              <label htmlFor="squares-game-date" className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span className="mb-1 block">Game day</span>
                <input id="squares-game-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </label>
              <button type="button" onClick={findGames} disabled={loading || !date} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60">
                {loading ? 'Looking…' : 'Find games'}
              </button>
            </div>

            {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}

            {games && games.length === 0 && (
              <p className="mt-3 text-sm text-slate-400">No games found on that day. Check the date, or type the teams in below.</p>
            )}

            {games && games.length > 0 && (
              <ul className="mt-3 space-y-1" data-testid="squares-game-list">
                {games.map((g) => {
                  // A game that has kicked off cannot take a new pool: nobody
                  // could claim a square on it. The server refuses it too —
                  // so it is the server's clock that is asked (the hook's).
                  const started = hasStarted(g);
                  return (
                    <li key={g.id}>
                      <button type="button" onClick={() => pick(g)} disabled={started} className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-800 px-3 py-2 text-left hover:border-indigo-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-800 disabled:hover:bg-transparent">
                        <span className="text-sm font-semibold text-white">{g.awayTeam} at {g.homeTeam}</span>
                        <span className="shrink-0 text-xs text-slate-400">{kickoffText(g.kickoff)}{started ? ' · already started' : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-xs text-amber-300">
              No game linked. You can still run the pool — you will enter the scores and lock the grid yourself.
            </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {/* One explanation, two fields (voice rule 10) — both point at the
            shared `matchup.teams` topic rather than repeating it. */}
        <TextField name="awayTeam" label="Away team — down the side" placeholder="Packers" helpId="matchup.teams" />
        <TextField name="homeTeam" label="Home team — across the top" placeholder="Lions" helpId="matchup.teams" />
      </div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <NumberField name="maxSquaresPerPlayer" label="Max squares per player (0 = no limit)" min={0} />
        <SelectField name="numberSets" label="Number sets" options={[
          { value: '1', label: 'One set of numbers' },
          { value: '4', label: 'New numbers each quarter' },
        ]} />
      </div>
    </div>
  );
}
