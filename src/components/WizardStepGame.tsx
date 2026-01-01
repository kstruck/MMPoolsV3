import React, { useState } from 'react';
import { RefreshCw, Calendar, CheckCircle } from 'lucide-react';
import type { GameState } from '../types';
import { getTeamLogo } from '../constants';

interface WizardStepGameProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    onNext: () => void;
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

export const WizardStepGame: React.FC<WizardStepGameProps> = ({ gameState, updateConfig, onNext }) => {
    // --- Game Finder State ---
    const [seasonType, setSeasonType] = useState('2');
    const [week, setWeek] = useState('1'); // Default to Week 1 or calculate dynamically
    const [scheduleGames, setScheduleGames] = useState<any[]>([]);
    const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
    const [showSchedule, setShowSchedule] = useState(false);
    const [cfbConference, setCfbConference] = useState('80');

    // Helper to estimate week (simplified from AdminPanel)
    const getEstimatedWeek = () => {
        const now = new Date();
        let year = now.getFullYear();
        if (now.getMonth() < 6) year--;
        const seasonStart = new Date(year, 8, 5);
        const diff = now.getTime() - seasonStart.getTime();
        if (diff < 0) return 1;
        const weekNum = Math.ceil(diff / (1000 * 60 * 60 * 24 * 7));
        return Math.max(1, weekNum);
    };

    const currentEstimatedWeek = getEstimatedWeek();

    const fetchSchedule = async () => {
        setIsLoadingSchedule(true);
        setScheduleGames([]);
        // Force show schedule container so user sees loading state or results
        setShowSchedule(true);
        try {
            const league = (gameState as any).league || 'nfl';
            const leaguePath = league === 'college' || league === 'ncaa' ? 'college-football' : 'nfl';
            let url = `https://site.api.espn.com/apis/site/v2/sports/football/${leaguePath}/scoreboard?seasontype=${seasonType}&week=${week}`;

            if (leaguePath === 'college-football') {
                url += `&groups=${cfbConference}&limit=100`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch schedule');

            const data = await response.json();
            const events = data.events || [];

            // Filter future only
            const now = new Date();
            const upcoming = events.filter((e: any) => new Date(e.date) > now);
            setScheduleGames(upcoming);

        } catch (e) {
            console.error("Schedule Fetch Error", e);
        }
        setIsLoadingSchedule(false);
    };

    const selectGame = (game: any) => {
        const comp = game.competitions[0];
        const home = comp.competitors.find((c: any) => c.homeAway === 'home').team;
        const away = comp.competitors.find((c: any) => c.homeAway === 'away').team;
        const gameDate = new Date(game.date);

        // Auto-Name
        let candidateName = `${away.displayName} @ ${home.displayName}`;

        // Update Config
        updateConfig({
            name: candidateName,
            gameId: game.id,
            homeTeam: home.displayName,
            awayTeam: away.displayName, // Ensure these fields exist on GameState/PropsPool in types.ts or use 'as any'
            homeTeamLogo: home.logo,
            awayTeamLogo: away.logo,
            lockDate: gameDate.getTime(), // Common field for Props
            date: gameDate.getTime(), // Common field
            gameTime: gameDate.getTime(), // Explicitly set gameTime
            league: (gameState as any).league || 'nfl'
        } as any);

        setShowSchedule(false);
    };

    const homeLogo = (gameState as any).homeTeamLogo || getTeamLogo((gameState as any).homeTeam);
    const awayLogo = (gameState as any).awayTeamLogo || getTeamLogo((gameState as any).awayTeam);

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">

                {/* Header Section with "Find Game" Button */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-2">Game Details</h3>
                        <p className="text-slate-400 text-sm">Select a game to auto-fill details, or enter manually.</p>
                    </div>
                    <button
                        onClick={() => {
                            const nextState = !showSchedule;
                            setShowSchedule(nextState);
                            if (nextState) {
                                // Smart defaults on open
                                const isCollege = (gameState as any).league === 'college';
                                const month = new Date().getMonth();
                                if (isCollege && (month === 11 || month === 0)) {
                                    setSeasonType('3'); setWeek('1');
                                } else {
                                    setWeek(currentEstimatedWeek.toString());
                                }
                            }
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${showSchedule ? 'bg-slate-800 text-slate-400' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:scale-105'}`}
                    >
                        <Calendar size={16} />
                        {showSchedule ? 'Hide Finder' : 'Find Game'}
                    </button>
                </div>

                {/* GAME FINDER UI */}
                {showSchedule && (
                    <div className="mb-8 bg-slate-950 border border-slate-700 rounded-xl p-4 animate-in fade-in">
                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <select
                                value={(gameState as any).league || 'nfl'}
                                onChange={(e) => updateConfig({ league: e.target.value } as any)}
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm font-bold"
                            >
                                <option value="nfl">NFL</option>
                                <option value="college">College</option>
                            </select>

                            <select
                                value={seasonType}
                                onChange={(e) => {
                                    setSeasonType(e.target.value);
                                    if (e.target.value === '2') setWeek(currentEstimatedWeek.toString());
                                    else setWeek('1');
                                }}
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm"
                            >
                                <option value="1">Preseason</option>
                                <option value="2">Regular</option>
                                <option value="3">Postseason</option>
                            </select>

                            <span className="text-slate-500 text-sm">Week</span>
                            <select value={week} onChange={(e) => setWeek(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm">
                                {seasonType === '2' ? (
                                    Array.from({ length: 18 }).map((_, i) => {
                                        const w = i + 1;
                                        if (w < currentEstimatedWeek) return null; // Hide past weeks
                                        return <option key={i} value={w}>{w}</option>;
                                    })
                                ) : (
                                    Array.from({ length: 5 }).map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)
                                )}
                            </select>

                            {((gameState as any).league === 'college') && (
                                <select
                                    value={cfbConference}
                                    onChange={(e) => setCfbConference(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-sm max-w-[120px]"
                                >
                                    {CFB_CONFERENCES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            )}

                            <button
                                onClick={fetchSchedule}
                                disabled={isLoadingSchedule}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm font-bold ml-auto flex items-center gap-2"
                            >
                                {isLoadingSchedule ? 'Loading...' : <><RefreshCw size={14} /> Search</>}
                            </button>
                        </div>

                        {/* Results List */}
                        <div className="max-h-60 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                            {scheduleGames.length === 0 && !isLoadingSchedule && (
                                <div className="text-slate-500 text-sm text-center py-4">No future games found.</div>
                            )}
                            {scheduleGames.map((game: any) => {
                                const comp = game.competitions[0];
                                const home = comp.competitors.find((c: any) => c.homeAway === 'home').team;
                                const away = comp.competitors.find((c: any) => c.homeAway === 'away').team;
                                const dateStr = new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                                return (
                                    <div key={game.id} onClick={() => selectGame(game)} className="flex items-center justify-between p-2 rounded hover:bg-slate-800 cursor-pointer border border-transparent hover:border-indigo-500/30 group transition-all">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs text-slate-500 w-28">{dateStr}</span>
                                            <div className="flex items-center gap-2">
                                                <img src={away.logo} className="w-5 h-5 object-contain" alt="" />
                                                <span className="text-sm text-slate-300 font-bold">{away.abbreviation}</span>
                                            </div>
                                            <span className="text-xs text-slate-600">@</span>
                                            <div className="flex items-center gap-2">
                                                <img src={home.logo} className="w-5 h-5 object-contain" alt="" />
                                                <span className="text-sm text-slate-300 font-bold">{home.abbreviation}</span>
                                            </div>
                                        </div>
                                        <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 font-bold transition-opacity">Select</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* MANUAL / SELECTED INPUTS */}
                <div className="space-y-4">
                    {/* TEAM LOGO PREVIEWS (Optional visual flair) */}
                    {(homeLogo || awayLogo) && (
                        <div className="flex justify-center items-center gap-8 py-4 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
                            {awayLogo && <img src={awayLogo} className="w-16 h-16 object-contain" alt="Away" />}
                            <span className="text-2xl font-black text-slate-700">VS</span>
                            {homeLogo && <img src={homeLogo} className="w-16 h-16 object-contain" alt="Home" />}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Name</label>
                        <input
                            type="text"
                            value={gameState.name || ''}
                            onChange={(e) => updateConfig({ name: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none font-bold text-lg"
                            placeholder="e.g. Super Bowl LIX Props"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Lock Time (Game Start)</label>
                        <p className="text-xs text-slate-500 mb-2">Players cannot submit or edit cards after this time.</p>
                        <input
                            type="datetime-local"
                            value={(() => {
                                const t = (gameState as any).lockDate;
                                if (!t) return '';
                                const d = new Date(t);
                                const offset = d.getTimezoneOffset() * 60000;
                                const localISOTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
                                return localISOTime;
                            })()}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (!val) return;
                                const date = new Date(val);
                                updateConfig({ lockDate: date.getTime(), date: date.getTime() } as any);
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-4 py-3 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                        {(gameState as any).lockDate && (
                            <p className="text-[10px] text-emerald-400 mt-2 flex items-center gap-1">
                                <CheckCircle size={10} /> Auto-Lock enabled for this time.
                            </p>
                        )}
                    </div>
                </div>

                <div className="pt-8 flex justify-end">
                    <button
                        onClick={onNext}
                        disabled={!gameState.name || !(gameState as any).lockDate}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-indigo-500/20 transition-all hover:scale-105"
                    >
                        Next: Branding
                    </button>
                </div>
            </div>
        </div>
    );
};
