import { logger } from '../utils/logger';
import React, { useState } from 'react';
import { RefreshCw, Calendar, CheckCircle } from 'lucide-react';
import type { GameState } from '../types';
import { getTeamLogo } from '../constants';
import { Button } from './ui';

interface ESPNCompetitor {
    homeAway: string;
    team: {
        id: string;
        displayName: string;
        logo: string;
        abbreviation: string;
    };
}

interface ESPNCompetition {
    competitors: ESPNCompetitor[];
}

interface ESPNEvent {
    id: string;
    date: string;
    competitions: ESPNCompetition[];
}

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
    const [seasonType, setSeasonType] = useState('3'); // Default to Postseason per user request
    const [week, setWeek] = useState('1'); // Default to Week 1 or calculate dynamically
    const [scheduleGames, setScheduleGames] = useState<ESPNEvent[]>([]);
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
            const league = gameState.league || 'nfl';
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
            const upcoming = events.filter((e: ESPNEvent) => new Date(e.date) > now);
            setScheduleGames(upcoming);

        } catch (e) {
            logger.error("Schedule Fetch Error", e);
        }
        setIsLoadingSchedule(false);
    };

    const selectGame = (game: ESPNEvent) => {
        const comp = game.competitions[0];
        const home = comp.competitors.find((c) => c.homeAway === 'home')?.team;
        const away = comp.competitors.find((c) => c.homeAway === 'away')?.team;
        const gameDate = new Date(game.date);

        if (!home || !away) return;

        // Auto-Name
        const candidateName = `${away.displayName} @ ${home.displayName}`;

        // Update Config
        updateConfig({
            name: candidateName,
            gameId: game.id,
            homeTeam: home.displayName,
            awayTeam: away.displayName,
            homeTeamLogo: home.logo,
            awayTeamLogo: away.logo,
            lockDate: gameDate.getTime(),
            gameTime: gameDate.getTime(),
            league: gameState.league || 'nfl'
        });

        setShowSchedule(false);
    };

    const homeLogo = gameState.homeTeamLogo || getTeamLogo(gameState.homeTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined));
    const awayLogo = gameState.awayTeamLogo || getTeamLogo(gameState.awayTeam, gameState.league === 'college' ? 'ncaa' : (gameState.league as 'nfl' | 'ncaa' | undefined));

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-card border border-line rounded-xl p-6 shadow-card">

                {/* Header Section with "Find Game" Button */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2">Game Details</h3>
                        <p className="text-muted font-body text-sm">Select a game to auto-fill details, or enter manually.</p>
                    </div>
                    <button
                        onClick={() => {
                            const nextState = !showSchedule;
                            setShowSchedule(nextState);
                            if (nextState) {
                                // Smart defaults on open

                                // Always default to Postseason now as regular season is over
                                setSeasonType('3');
                                setWeek('1');
                            }
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-all duration-150 flex items-center gap-2 ${showSchedule ? 'bg-surface text-muted border border-line' : 'bg-brandred-600 text-white shadow-red-cta hover:bg-brandred-500 hover:-translate-y-px'}`}
                    >
                        <Calendar size={16} />
                        {showSchedule ? 'Hide Finder' : 'Find Game'}
                    </button>
                </div>

                {/* GAME FINDER UI */}
                {showSchedule && (
                    <div className="mb-8 bg-surface border border-line rounded-xl p-4 animate-in fade-in">
                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <select
                                value={gameState.league || 'nfl'}
                                onChange={(e) => updateConfig({ league: e.target.value as 'nfl' | 'college' })}
                                className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 font-body text-sm font-bold text-[color:var(--text)] transition-colors focus:border-navy-600 focus:outline-none cursor-pointer"
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
                                className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 font-body text-sm text-[color:var(--text)] transition-colors focus:border-navy-600 focus:outline-none cursor-pointer"
                            >
                                <option value="1" disabled>Preseason</option>
                                <option value="2" disabled>Regular</option>
                                <option value="3">Postseason</option>
                            </select>

                            <span className="text-muted font-body text-sm">Week</span>
                            <select value={week} onChange={(e) => setWeek(e.target.value)} className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 font-body text-sm text-[color:var(--text)] transition-colors focus:border-navy-600 focus:outline-none cursor-pointer">
                                {seasonType === '2' ? (
                                    Array.from({ length: 18 }).map((_, i) => {
                                        const w = i + 1;
                                        if (w < currentEstimatedWeek) return null; // Hide past weeks
                                        return <option key={i} value={w}>Week {w}</option>;
                                    })
                                ) : seasonType === '3' ? (
                                    <>
                                        <option value="1">Wild Card</option>
                                        <option value="2">Divisional</option>
                                        <option value="3">Conf. Champ</option>
                                        <option value="4">Pro Bowl</option>
                                        <option value="5">Super Bowl</option>
                                    </>
                                ) : (
                                    Array.from({ length: 5 }).map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)
                                )}
                            </select>

                            {(gameState.league === 'college') && (
                                <select
                                    value={cfbConference}
                                    onChange={(e) => setCfbConference(e.target.value)}
                                    className="rounded-md border-[1.5px] border-line bg-page px-2 py-1 font-body text-sm text-[color:var(--text)] transition-colors focus:border-navy-600 focus:outline-none cursor-pointer max-w-[120px]"
                                >
                                    {CFB_CONFERENCES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            )}

                            <button
                                onClick={fetchSchedule}
                                disabled={isLoadingSchedule}
                                className="bg-brandred-600 hover:bg-brandred-500 text-white px-3 py-1 rounded-[8px] text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ml-auto flex items-center gap-2"
                            >
                                {isLoadingSchedule ? 'Loading...' : <><RefreshCw size={14} /> Search</>}
                            </button>
                        </div>

                        {/* Results List */}
                        <div className="max-h-60 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                            {scheduleGames.length === 0 && !isLoadingSchedule && (
                                <div className="text-muted font-body text-sm text-center py-4">No future games found.</div>
                            )}
                            {scheduleGames.map((game) => {
                                const comp = game.competitions[0];
                                const home = comp.competitors.find((c) => c.homeAway === 'home')?.team;
                                const away = comp.competitors.find((c) => c.homeAway === 'away')?.team;
                                if (!home || !away) return null;
                                const dateStr = new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                                return (
                                    <div key={game.id} onClick={() => selectGame(game)} className="flex items-center justify-between p-2 rounded hover:bg-card cursor-pointer border border-transparent hover:border-navy-600/30 group transition-all">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs text-muted num w-28">{dateStr}</span>
                                            <div className="flex items-center gap-2">
                                                <img src={away.logo} className="w-5 h-5 object-contain" alt="" />
                                                <span className="text-sm text-[color:var(--text)] font-display font-bold">{away.abbreviation}</span>
                                            </div>
                                            <span className="text-xs text-faint">@</span>
                                            <div className="flex items-center gap-2">
                                                <img src={home.logo} className="w-5 h-5 object-contain" alt="" />
                                                <span className="text-sm text-[color:var(--text)] font-display font-bold">{home.abbreviation}</span>
                                            </div>
                                        </div>
                                        <span className="text-xs text-gold-600 opacity-0 group-hover:opacity-100 font-display font-bold uppercase tracking-[0.05em] transition-opacity">Select</span>
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
                            <span className="text-2xl font-display font-extrabold uppercase text-faint">VS</span>
                            {homeLogo && <img src={homeLogo} className="w-16 h-16 object-contain" alt="Home" />}
                        </div>
                    )}

                    <div>
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Pool Name</label>
                        <input
                            type="text"
                            value={gameState.name || ''}
                            onChange={(e) => updateConfig({ name: e.target.value })}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-lg font-bold text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                            placeholder="e.g. Super Bowl LIX Props"
                        />
                    </div>

                    <div>
                        <label className="block mb-1.5 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)]">Lock Time (Game Start)</label>
                        <p className="text-xs font-body text-faint mb-2">Players cannot submit or edit cards after this time.</p>
                        <input
                            type="datetime-local"
                            value={(() => {
                                const t = gameState.lockDate;
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
                                updateConfig({ lockDate: date.getTime() });
                            }}
                            className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] num transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                        />
                        {gameState.lockDate && (
                            <p className="text-[10px] text-[#0F7B4A] font-body mt-2 flex items-center gap-1">
                                <CheckCircle size={10} /> Auto-Lock enabled for this time.
                            </p>
                        )}
                    </div>
                </div>

                <div className="pt-8 flex justify-end">
                    <Button
                        variant="primary"
                        onClick={onNext}
                        disabled={!gameState.name || !gameState.lockDate}
                    >
                        Next: Grid Settings
                    </Button>
                </div>
            </div>
        </div>
    );
};
