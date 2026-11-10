import React from 'react';
import { Calendar, RefreshCw, Shield } from 'lucide-react';
import type { GameState } from '../../types';
import { DebouncedInput } from './DebouncedInputs';
import { getTeamLogo } from '../../constants';
import { hasStarted, type ScheduleGame, type ScheduleLeague } from '../../services/espnSchedule';
import { useScheduleSearch } from '../../hooks/useScheduleSearch';

interface WizardStepMatchupProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    /** Link the pool to the game picked from the schedule. */
    onLinkGame: (game: ScheduleGame, league: ScheduleLeague) => void;
}

const kickoffText = (ms: number): string =>
    new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The matchup step on the squares manage page.
 *
 * THE SEARCH IS BY DATE (PLAN-SQUARES-REOPEN C1). It used to ask for a season
 * type and a week, and the season-type list held one entry — Postseason — so a
 * regular-season game could not be found here at all. It is the same search the
 * create wizard uses.
 *
 * THE TWO TEAM CARDS ARE LABELLED THE WAY THE GRID DRAWS THEM: the home team's
 * digits run across the top (columns), the away team's down the side (rows).
 * They were labelled the other way round, on the one screen a commissioner
 * reads to learn which side is which.
 */
export const WizardStepMatchup: React.FC<WizardStepMatchupProps> = ({ gameState, updateConfig, onLinkGame }) => {
    // Prefer API logos, fallback to local map
    const homeLogo = gameState.homeTeamLogo || getTeamLogo(gameState.homeTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined));
    const awayLogo = gameState.awayTeamLogo || getTeamLogo(gameState.awayTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined));

    const [showSchedule, setShowSchedule] = React.useState(false);
    const search = useScheduleSearch(gameState.league === 'college' || gameState.league === 'ncaa' ? 'college' : 'nfl');
    const selectCls = 'rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-[color:var(--text)] text-sm outline-none cursor-pointer focus:border-navy-600';

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-200">
            <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">The Matchup</h3>
                        <p className="text-muted text-sm">
                            {gameState.gameId
                                ? 'Linked to a game: scores come in on their own and the grid locks itself at kickoff.'
                                : 'No game linked. Find it on the schedule and the pool is scored and locked for you.'}
                        </p>
                    </div>
                    <button onClick={() => setShowSchedule(!showSchedule)} className={`px-5 py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-[0.05em] transition-ui duration-150 flex items-center gap-2 ${showSchedule ? 'bg-card hover:bg-surface text-muted border border-line' : 'bg-brandred-600 hover:bg-brandred-500 text-white shadow-[0_6px_16px_rgba(196,52,46,0.28)] fine:hover:-translate-y-px'}`}>
                        <Calendar size={18} />
                        {showSchedule ? 'Hide Schedule' : gameState.gameId ? 'Change Game' : 'Find Game'}
                    </button>
                </div>
                {showSchedule && (
                    <div className="mb-6 bg-card border border-line rounded-xl p-4 animate-in fade-in" data-testid="admin-game-search">
                        <div className="flex flex-wrap items-end gap-3 mb-4">
                            <label htmlFor="admin-game-league" className="block text-xs text-faint">
                                <span className="block mb-1">League</span>
                                <select id="admin-game-league" value={search.league} onChange={(e) => search.setLeague(e.target.value as ScheduleLeague)} className={`${selectCls} font-bold`}>
                                    <option value="nfl">NFL</option>
                                    <option value="college">College football</option>
                                </select>
                            </label>
                            <label htmlFor="admin-game-date" className="block text-xs text-faint">
                                <span className="block mb-1">Game day</span>
                                <input id="admin-game-date" type="date" value={search.date} onChange={(e) => search.setDate(e.target.value)} className={selectCls} />
                            </label>
                            <button onClick={search.find} disabled={search.loading || !search.date} className="bg-brandred-600 hover:bg-brandred-500 text-white px-3 py-1.5 rounded-md font-display font-bold uppercase tracking-[0.05em] text-sm ml-auto flex items-center gap-2 transition-ui duration-150 fine:hover:-translate-y-px disabled:opacity-50">
                                {search.loading ? 'Looking…' : <><RefreshCw size={14} /> Find Games</>}
                            </button>
                        </div>
                        {search.error && <p role="alert" className="text-brandred-600 text-sm mb-2">{search.error}</p>}
                        <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                            {search.games && search.games.length === 0 && (
                                <div className="text-faint text-sm text-center py-4">No games found on that day. Check the date.</div>
                            )}
                            {(search.games ?? []).map((game) => {
                                // A game that has kicked off cannot be linked: the grid
                                // would lock at once, on whatever numbers it has.
                                const started = hasStarted(game);
                                return (
                                    <button
                                        type="button"
                                        key={game.id}
                                        disabled={started}
                                        onClick={() => { onLinkGame(game, search.league); search.clear(); setShowSchedule(false); }}
                                        className="flex w-full items-center justify-between p-2 rounded hover:bg-surface border border-transparent hover:border-navy-600/30 group transition-ui text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent"
                                    >
                                        <span className="flex items-center gap-3">
                                            <span className="num text-xs text-faint w-32">{kickoffText(game.kickoff)}</span>
                                            <span className="flex items-center gap-2">
                                                {game.awayLogo && <img src={game.awayLogo} className="w-5 h-5 object-contain" alt="" />}
                                                <span className="text-sm text-muted font-bold">{game.awayAbbr || game.awayTeam}</span>
                                            </span>
                                            <span className="text-xs text-faint">@</span>
                                            <span className="flex items-center gap-2">
                                                {game.homeLogo && <img src={game.homeLogo} className="w-5 h-5 object-contain" alt="" />}
                                                <span className="text-sm text-muted font-bold">{game.homeAbbr || game.homeTeam}</span>
                                            </span>
                                        </span>
                                        <span className="text-xs text-navy-600 dark:text-gold-400 font-display font-bold uppercase">{started ? 'Already started' : 'Select'}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    <div className="bg-card border border-line rounded-xl p-6 relative group hover:border-navy-600/50 transition-colors">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-navy-600 dark:text-navy-500 mb-4 text-center">Row Team (Down the Side) — Away</label>
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-24 h-24 bg-page rounded-full flex items-center justify-center border-2 border-line p-4 shadow-xl">
                                {awayLogo ? <img src={awayLogo} className="w-full h-full object-contain" alt="Away Logo" /> : <Shield size={40} className="text-faint" />}
                            </div>
                            <DebouncedInput
                                value={gameState.awayTeam}
                                onChange={(val) => {
                                    updateConfig({ awayTeam: val });
                                    if (!gameState.name || gameState.name === 'New Pool') {
                                        updateConfig({ name: `${val} vs ${gameState.homeTeam || 'Home'} Squares` });
                                    }
                                }}
                                className="w-full bg-page border-[1.5px] border-line rounded-md px-4 py-2 text-[color:var(--text)] text-center font-bold text-lg focus:border-navy-600 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="Select a game above"
                                disabled={true}
                            />
                        </div>
                    </div>
                    <div className="bg-card border border-line rounded-xl p-6 relative group hover:border-gold-600/50 transition-colors">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-gold-700 dark:text-gold-400 mb-4 text-center">Column Team (Across the Top) — Home</label>
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-24 h-24 bg-page rounded-full flex items-center justify-center border-2 border-line p-4 shadow-xl">
                                {homeLogo ? <img src={homeLogo} className="w-full h-full object-contain" alt="Home Logo" /> : <Shield size={40} className="text-faint" />}
                            </div>
                            <DebouncedInput
                                value={gameState.homeTeam}
                                onChange={(val) => {
                                    updateConfig({ homeTeam: val });
                                    if (!gameState.name || gameState.name === 'New Pool') {
                                        updateConfig({ name: `${gameState.awayTeam || 'Away'} vs ${val} Squares` });
                                    }
                                }}
                                className="w-full bg-page border-[1.5px] border-line rounded-md px-4 py-2 text-[color:var(--text)] text-center font-bold text-lg focus:border-navy-600 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="Select a game above"
                                disabled={true}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
