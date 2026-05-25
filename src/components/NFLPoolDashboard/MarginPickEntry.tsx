import React, { useState, useEffect, useMemo } from 'react';
import { Lock, AlertCircle, Save, Percent, ArrowUpRight, ArrowDownRight, Check } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import type { User, Pool, NFLGame } from '../../types';

interface MarginPickEntryProps {
  pool: Pool;
  user: User;
  week: number;
  games: NFLGame[];
  entry: any; // MarginEntry or null
  isWeekLocked: boolean;
}

export const MarginPickEntry: React.FC<MarginPickEntryProps> = ({
  pool,
  week,
  games,
  entry,
  isWeekLocked
}) => {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = (pool as any).settings || {};

  // Load existing selection for this week when entry or week changes
  useEffect(() => {
    if (entry && entry.picks && entry.picks[week]) {
      setSelectedTeam(entry.picks[week]);
    } else {
      setSelectedTeam(null);
    }
    setError(null);
  }, [entry, week]);

  // Extract previously used teams (excluding the pick for the current week if already set)
  const usedTeams = useMemo(() => {
    if (!entry) return new Set<string>();
    const teams = new Set<string>(entry.usedTeams || []);
    const currentWeekPick = entry.picks?.[week];
    if (currentWeekPick) {
      teams.delete(currentWeekPick);
    }
    return teams;
  }, [entry, week]);

  // Check if a specific game is locked
  const isGameLocked = (game: NFLGame): boolean => {
    if (isWeekLocked) return true;
    const bufferMs = (settings.lockBufferMinutes ?? 5) * 60 * 1000;
    return Date.now() >= (game.startTime - bufferMs);
  };

  // Determine if the user has selected a team in a game that is locked
  const activePickGame = useMemo(() => {
    if (!selectedTeam) return null;
    return games.find(g => g.homeTeam.abbreviation === selectedTeam || g.awayTeam.abbreviation === selectedTeam) || null;
  }, [selectedTeam, games]);

  const isSelectionLocked = useMemo(() => {
    if (isWeekLocked) return true;
    if (activePickGame) {
      return isGameLocked(activePickGame);
    }
    return false;
  }, [activePickGame, isWeekLocked]);

  const handleTeamSelect = (teamAbbreviation: string, game: NFLGame) => {
    if (isGameLocked(game)) return;
    if (usedTeams.has(teamAbbreviation)) return;

    setSelectedTeam(teamAbbreviation);
  };

  const handleSubmit = async () => {
    if (!selectedTeam || isSelectionLocked) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await dbService.submitNFLPicks({
        poolId: pool.id,
        week,
        picks: {
          [week]: selectedTeam
        }
      });
      alert('Margin selection locked in successfully!');
    } catch (err: any) {
      logger.error('Failed to submit Margin pick:', err);
      setError(err.message || 'Failed to submit selection. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Score details for this week
  const currentWeekScore = useMemo(() => {
    if (!entry || !entry.weeklyScores) return null;
    return entry.weeklyScores[week] !== undefined ? entry.weeklyScores[week] : null;
  }, [entry, week]);

  const branding = (pool as any).branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  return (
    <div className="space-y-6">
      {/* 1. Margin Stats Dashboard */}
      {entry && (
        <div className="relative overflow-hidden bg-slate-900/50 border border-slate-800 rounded-3xl p-6 backdrop-blur-md">
          {/* Decorative background glow */}
          <div
            className="absolute -right-16 -top-16 w-40 h-40 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ backgroundColor: primaryAccent }}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
            <div className="bg-slate-950/40 p-4 border border-slate-800 rounded-2xl">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Season Score</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-white">{entry.seasonTotal ?? 0}</span>
                <span className="text-slate-400 text-xs font-bold">pts</span>
              </div>
            </div>

            <div className="bg-slate-950/40 p-4 border border-slate-800 rounded-2xl">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Negative Burden</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-rose-400">-{entry.negativeBurden ?? 0}</span>
                <span className="text-slate-500 text-xs font-bold">pts</span>
              </div>
            </div>

            <div className="bg-slate-950/40 p-4 border border-slate-800 rounded-2xl">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Best Week</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-emerald-400">+{entry.bestWeek ?? 0}</span>
                <span className="text-slate-500 text-xs font-bold">pts</span>
              </div>
            </div>

            <div className="bg-slate-950/40 p-4 border border-slate-800 rounded-2xl">
              <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">Win Rate</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-white">
                  {entry.positiveWeeks ?? 0}
                </span>
                <span className="text-slate-400 text-xs font-bold">weeks</span>
              </div>
            </div>
          </div>

          {currentWeekScore !== null && (
            <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between items-center text-sm font-semibold">
              <span className="text-slate-400">Week {week} Result:</span>
              <span className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black ${
                currentWeekScore >= 0
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
              }`}>
                {currentWeekScore >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {currentWeekScore >= 0 ? `+${currentWeekScore}` : `${currentWeekScore}`} Points
              </span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-xs font-bold flex gap-2 items-center">
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {/* 2. Rules Helper */}
      <div className="bg-slate-900/30 border border-slate-800 rounded-2xl px-5 py-4 flex items-center gap-3">
        <div className="p-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl">
          <Percent size={18} />
        </div>
        <div>
          <h4 className="text-sm font-extrabold text-white uppercase tracking-wider">Margin of Victory Selection</h4>
          <p className="text-[11px] text-slate-400">
            Pick one team each week. Your score is their victory margin (e.g. if they win by 14, you get +14).
            If they lose, the negative margin counts against you. You cannot pick the same team twice in a season.
          </p>
        </div>
      </div>

      {/* 3. Game / Team Matchup Grid */}
      <div className="space-y-4">
        {games.length === 0 ? (
          <div className="bg-slate-900/30 p-8 border border-slate-800 rounded-3xl text-center">
            <p className="text-slate-500 font-bold">No NFL matchups scheduled for Week {week}.</p>
          </div>
        ) : (
          games.map(game => {
            const locked = isGameLocked(game);

            const homeAbbrev = game.homeTeam.abbreviation;
            const awayAbbrev = game.awayTeam.abbreviation;

            const isHomeSelected = selectedTeam === homeAbbrev;
            const isAwaySelected = selectedTeam === awayAbbrev;

            const isHomeUsed = usedTeams.has(homeAbbrev);
            const isAwayUsed = usedTeams.has(awayAbbrev);

            return (
              <div
                key={game.id}
                className="bg-slate-900/40 border border-slate-800 rounded-3xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all relative overflow-hidden backdrop-blur-sm hover:border-slate-700/80"
              >
                {/* Visual Lock overlay */}
                {locked && game.status === 'SCHEDULED' && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-slate-950/70 border border-slate-800 rounded-full px-2 py-0.5 text-[9px] text-slate-500 font-bold tracking-wider uppercase">
                    <Lock size={9} /> Locked
                  </div>
                )}

                {/* Team Buttons Grid */}
                <div className="flex-grow flex items-center justify-center gap-6 w-full">
                  
                  {/* AWAY TEAM */}
                  <button
                    onClick={() => handleTeamSelect(awayAbbrev, game)}
                    disabled={locked || isAwayUsed}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-2xl border transition-all text-center relative ${
                      isAwaySelected
                        ? 'bg-blue-600/10 border-blue-500/70 shadow-md shadow-blue-500/5'
                        : isAwayUsed
                          ? 'bg-slate-950/20 border-slate-900/50 opacity-40 cursor-not-allowed'
                          : locked
                            ? 'bg-slate-950/40 border-slate-850 opacity-80 cursor-not-allowed'
                            : 'bg-slate-950/40 border-slate-850 hover:border-slate-700 hover:scale-[1.01]'
                    }`}
                  >
                    {isAwayUsed && (
                      <span className="absolute top-2 left-2 bg-slate-900 border border-slate-800 text-slate-500 text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded-full uppercase">
                        Used
                      </span>
                    )}
                    {isAwaySelected && (
                      <span className="absolute top-2 right-2 bg-blue-500 text-slate-950 p-0.5 rounded-full">
                        <Check size={10} className="stroke-[4]" />
                      </span>
                    )}

                    {game.awayTeam.logoUrl && (
                      <img src={game.awayTeam.logoUrl} className="w-12 h-12 object-contain mb-2" alt="Away Logo" />
                    )}
                    <span className="text-white font-extrabold text-sm leading-tight truncate w-full">
                      {game.awayTeam.name}
                    </span>
                    <span className="text-slate-500 text-[10px] font-bold tracking-widest mt-0.5">
                      {awayAbbrev}
                    </span>
                  </button>

                  {/* SCORE OR VS STATUS */}
                  <div className="flex flex-col items-center justify-center min-w-[60px]">
                    {game.status === 'FINAL' ? (
                      <div className="text-center font-mono">
                        <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block mb-1">Final</span>
                        <span className="text-base font-black text-white">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                      </div>
                    ) : game.status === 'IN_PROGRESS' ? (
                      <div className="text-center font-mono">
                        <span className="relative flex h-1.5 w-1.5 mx-auto mb-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                        </span>
                        <span className="text-sm font-black text-red-500">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                        <span className="text-[9px] text-slate-500 block mt-0.5 leading-none">{game.clock}</span>
                      </div>
                    ) : (
                      <div className="text-slate-600 text-xs font-black font-mono tracking-widest">VS</div>
                    )}
                  </div>

                  {/* HOME TEAM */}
                  <button
                    onClick={() => handleTeamSelect(homeAbbrev, game)}
                    disabled={locked || isHomeUsed}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-2xl border transition-all text-center relative ${
                      isHomeSelected
                        ? 'bg-blue-600/10 border-blue-500/70 shadow-md shadow-blue-500/5'
                        : isHomeUsed
                          ? 'bg-slate-950/20 border-slate-900/50 opacity-40 cursor-not-allowed'
                          : locked
                            ? 'bg-slate-950/40 border-slate-850 opacity-80 cursor-not-allowed'
                            : 'bg-slate-950/40 border-slate-850 hover:border-slate-700 hover:scale-[1.01]'
                    }`}
                  >
                    {isHomeUsed && (
                      <span className="absolute top-2 left-2 bg-slate-900 border border-slate-800 text-slate-500 text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded-full uppercase">
                        Used
                      </span>
                    )}
                    {isHomeSelected && (
                      <span className="absolute top-2 right-2 bg-blue-500 text-slate-950 p-0.5 rounded-full">
                        <Check size={10} className="stroke-[4]" />
                      </span>
                    )}

                    {game.homeTeam.logoUrl && (
                      <img src={game.homeTeam.logoUrl} className="w-12 h-12 object-contain mb-2" alt="Home Logo" />
                    )}
                    <span className="text-white font-extrabold text-sm leading-tight truncate w-full">
                      {game.homeTeam.name}
                    </span>
                    <span className="text-slate-500 text-[10px] font-bold tracking-widest mt-0.5">
                      {homeAbbrev}
                    </span>
                  </button>

                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Action Save Footer */}
      {games.length > 0 && selectedTeam && !isSelectionLocked && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-sm flex justify-center">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-extrabold px-8 py-3.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] cursor-pointer"
          >
            {isSubmitting ? 'Locking in...' : (
              <>
                <Save size={18} /> Lock In Margin Selection
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
