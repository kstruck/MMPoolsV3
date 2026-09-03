import React from 'react';
import { Calendar, RefreshCw, Shield } from 'lucide-react';
import type { GameState } from '../../types';
import type { ESPNGame, ESPNCompetitor } from '../../types/espn';
import { DebouncedInput } from './DebouncedInputs';
import { getTeamLogo } from '../../constants';

interface WizardStepMatchupProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    seasonType: string;
    setSeasonType: (type: string) => void;
    week: string;
    setWeek: (week: string) => void;
    scheduleGames: ESPNGame[];
    isLoadingSchedule: boolean;
    showSchedule: boolean;
    setShowSchedule: (show: boolean) => void;
    fetchSchedule: () => void;
    selectGame: (game: ESPNGame) => void;
    currentEstimatedWeek: number;
    cfbConference?: string;
    setCfbConference?: (conf: string) => void;
}

const CFB_CONFERENCES = [
    { id: '80', name: 'All FBS (Div I-A)' },
    { id: '81', name: 'All FCS (Div I-AA)' },
    { id: '1', name: 'ACC' },
    { id: '4', name: 'Big 12' },
    { id: '5', name: 'Big Ten' },
    { id: '8', name: 'SEC' },
    { id: '9', name: 'Pac-12' },
    { id: '151', name: 'American' },
    { id: '12', name: 'C-USA' },
    { id: '15', name: 'MAC' },
    { id: '17', name: 'Mountain West' },
    { id: '37', name: 'Sun Belt' },
];

export const WizardStepMatchup: React.FC<WizardStepMatchupProps> = ({
    gameState,
    updateConfig,
    seasonType,
    setSeasonType,
    week,
    setWeek,
    scheduleGames,
    isLoadingSchedule,
    showSchedule,
    setShowSchedule,
    fetchSchedule,
    selectGame,
    currentEstimatedWeek,
    cfbConference = '80',
    setCfbConference = () => { }
}) => {
    // Prefer API logos, fallback to local map
    const homeLogo = gameState.homeTeamLogo || getTeamLogo(gameState.homeTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined));
    const awayLogo = gameState.awayTeamLogo || getTeamLogo(gameState.awayTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined));

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">The Matchup</h3>
                        <p className="text-muted text-sm">Select the teams. Import from the schedule to auto-fetch logos.</p>
                    </div>
                    <button onClick={() => {
                        setShowSchedule(!showSchedule);
                        if (!showSchedule) {
                            // Smart Defaults
                            const isCollege = gameState.league === 'college' || gameState.league === 'ncaa';
                            const month = new Date().getMonth();
                            if (isCollege && (month === 11 || month === 0)) {
                                setSeasonType('3'); // Postseason
                                setWeek('1');
                            } else {
                                setWeek(currentEstimatedWeek.toString());
                            }
                        }
                    }} className={`px-5 py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-[0.05em] transition duration-150 flex items-center gap-2 ${showSchedule ? 'bg-card hover:bg-surface text-muted border border-line' : 'bg-brandred-600 hover:bg-brandred-500 text-white shadow-[0_6px_16px_rgba(196,52,46,0.28)] hover:-translate-y-px'}`}>
                        <Calendar size={18} className={!showSchedule ? 'animate-pulse' : ''} />
                        {showSchedule ? 'Hide Schedule' : 'Find Game'}
                    </button>
                </div>
                {showSchedule && (
                    <div className="mb-6 bg-card border border-line rounded-xl p-4 animate-in fade-in">
                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <select value={gameState.league || 'nfl'} onChange={(e) => updateConfig({ league: e.target.value as 'nfl' | 'college' | 'ncaa' })} className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-[color:var(--text)] text-sm outline-none font-bold cursor-pointer focus:border-navy-600">
                                <option value="nfl">NFL (Pro)</option>
                                <option value="college">College (NCAA)</option>
                            </select>

                            <select value={seasonType} onChange={(e) => {
                                const newType = e.target.value;
                                setSeasonType(newType);
                                // Default to Divisional for postseason
                                setWeek('2');
                            }} className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-[color:var(--text)] text-sm outline-none cursor-pointer focus:border-navy-600">
                                <option value="3">Postseason</option>
                            </select>

                            <span className="text-faint text-sm">Round</span>
                            <select value={week} onChange={(e) => setWeek(e.target.value)} className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-[color:var(--text)] text-sm outline-none cursor-pointer focus:border-navy-600">
                                {seasonType === '3' && (
                                    <>
                                        <option value="1">Wild Card</option>
                                        <option value="2">Divisional</option>
                                        <option value="3">Conf. Champ</option>
                                        <option value="4">Pro Bowl</option>
                                        <option value="5">Super Bowl</option>
                                    </>
                                )}
                            </select>

                            {(gameState.league === 'college' || gameState.league === 'ncaa') && (
                                <select value={cfbConference} onChange={(e) => setCfbConference(e.target.value)} className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 text-[color:var(--text)] text-sm outline-none max-w-[150px] cursor-pointer focus:border-navy-600">
                                    {CFB_CONFERENCES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            )}

                            <button onClick={fetchSchedule} disabled={isLoadingSchedule} className="bg-brandred-600 hover:bg-brandred-500 text-white px-3 py-1 rounded-md font-display font-bold uppercase tracking-[0.05em] text-sm ml-auto flex items-center gap-2 transition duration-150 hover:-translate-y-px disabled:opacity-50">
                                {isLoadingSchedule ? 'Loading...' : <><RefreshCw size={14} /> Find Games</>}
                            </button>
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                            {scheduleGames.length === 0 && !isLoadingSchedule && (
                                <div className="text-faint text-sm text-center py-4">No future games found for this week.</div>
                            )}
                            {scheduleGames.map((game: ESPNGame) => {
                                const comp = game.competitions[0];
                                const home = comp.competitors.find((c: ESPNCompetitor) => c.homeAway === 'home')?.team;
                                const away = comp.competitors.find((c: ESPNCompetitor) => c.homeAway === 'away')?.team;
                                if (!home || !away) return null;
                                const dateStr = new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                                return (
                                    <div key={game.id} onClick={() => selectGame(game)} className="flex items-center justify-between p-2 rounded hover:bg-surface cursor-pointer border border-transparent hover:border-navy-600/30 group transition">
                                        <div className="flex items-center gap-3">
                                            <span className="num text-xs text-faint w-24">{dateStr}</span>
                                            <div className="flex items-center gap-2">
                                                <img src={away.logo} className="w-5 h-5 object-contain" alt={away.abbreviation} />
                                                <span className="text-sm text-muted font-bold">{away.abbreviation}</span>
                                            </div>
                                            <span className="text-xs text-faint">@</span>
                                            <div className="flex items-center gap-2">
                                                <img src={home.logo} className="w-5 h-5 object-contain" alt={home.abbreviation} />
                                                <span className="text-sm text-muted font-bold">{home.abbreviation}</span>
                                            </div>
                                        </div>
                                        <span className="text-xs text-navy-600 dark:text-gold-400 opacity-0 group-hover:opacity-100 font-display font-bold uppercase transition-opacity">Select</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    <div className="bg-card border border-line rounded-xl p-6 relative group hover:border-navy-600/50 transition-colors">
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-navy-600 dark:text-navy-500 mb-4 text-center">Column Team (Top)</label>
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
                        <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-gold-700 dark:text-gold-400 mb-4 text-center">Row Team (Left)</label>
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
