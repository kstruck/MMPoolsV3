import React, { useState, useEffect, useMemo } from 'react';
import { Lock, AlertCircle, Save, RotateCcw, Shield, ShieldAlert, Heart, Check, CheckCircle2 } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import { useToast } from '../ui/Toast';
import { getUserMessage } from '../../utils/errorMessages';
import { now as serverNow } from '../../utils/serverClock';
import { formatTimeWithZone } from '../../utils/formatTime';
import type { User, Pool, NFLGame } from '../../types';

interface SurvivorPickEntryProps {
  pool: Pool;
  user: User;
  week: number;
  games: NFLGame[];
  entry: any; // SurvivorEntry or null
  isWeekLocked: boolean;
}

export const SurvivorPickEntry: React.FC<SurvivorPickEntryProps> = ({
  pool,
  week,
  games,
  entry,
  isWeekLocked
}) => {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRebuying, setIsRebuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const toast = useToast();

  const settings = (pool as any).settings || {};
  const maxStrikes = settings.maxStrikes ?? 0;
  const maxRebuys = settings.maxRebuys ?? 0;
  const rebuyDeadlineWeek = settings.rebuyDeadlineWeek ?? 4;
  const rebuyCost = settings.rebuyCost ?? settings.entryFee ?? 0;
  const pickLosersMode = settings.pickLosersMode ?? false;

  // Load existing pick for this week when entry or week changes
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
    // Allow changing the current week's pick if not locked
    const currentWeekPick = entry.picks?.[week];
    if (currentWeekPick) {
      teams.delete(currentWeekPick);
    }
    return teams;
  }, [entry, week]);

  // Check if a specific game is locked (server-corrected clock — device time can drift)
  const isGameLocked = (game: NFLGame): boolean => {
    if (isWeekLocked) return true;
    const bufferMs = (settings.lockBufferMinutes ?? 5) * 60 * 1000;
    return serverNow() >= (game.startTime - bufferMs);
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

  // Check if eligible for rebuy
  const canRebuy = useMemo(() => {
    if (!entry) return false;
    if (entry.status !== 'ELIMINATED') return false;
    if (week > rebuyDeadlineWeek) return false;
    return (entry.rebuysUsed ?? 0) < maxRebuys;
  }, [entry, week, rebuyDeadlineWeek, maxRebuys]);

  const handleTeamSelect = (teamAbbreviation: string, game: NFLGame) => {
    if (isGameLocked(game) || (entry && entry.status === 'ELIMINATED')) return;
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
      setSubmittedAt(serverNow());
      toast.success(`Survivor pick locked in: ${selectedTeam}`);
    } catch (err: any) {
      logger.error('Failed to submit Survivor pick:', err);
      const message = getUserMessage(err, 'Your pick was NOT saved. Please try again.');
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRebuy = async () => {
    if (!canRebuy) return;
    const ok = await toast.confirm({
      title: `Rebuy for $${rebuyCost}?`,
      message: (
        <>
          <p>This restores your ALIVE status and adds <strong>${rebuyCost}</strong> to what you owe the commissioner.</p>
          <p className="mt-2 text-slate-400">Rebuys used: {(entry?.rebuysUsed ?? 0)} of {maxRebuys}. Available through Week {rebuyDeadlineWeek}.</p>
        </>
      ),
      confirmLabel: `Rebuy — $${rebuyCost}`,
    });
    if (!ok) return;

    setIsRebuying(true);
    setError(null);

    try {
      await dbService.executeSurvivorRebuy(pool.id, week);
      toast.success(`Rebuy confirmed — you're back in the game! $${rebuyCost} due to the commissioner.`);
    } catch (err: any) {
      logger.error('Failed to execute Survivor rebuy:', err);
      const message = getUserMessage(err, 'The rebuy did not go through. Please contact the commissioner.');
      setError(message);
      toast.error(message);
    } finally {
      setIsRebuying(false);
    }
  };

  const branding = (pool as any).branding || {};
  const primaryAccent = branding.secondaryColor || '#6366f1';

  // Check if spreads are fully incorporated for all active games
  const allSpreadsLocked = useMemo(() => {
    return games.filter(g => g.status !== 'CANCELLED').every(g => g.spread?.locked);
  }, [games]);

  if (!allSpreadsLocked) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-8 rounded-3xl text-center">
        <AlertCircle size={48} className="mx-auto mb-4 opacity-50" />
        <h3 className="font-black text-xl mb-2">Spreads Not Yet Finalized</h3>
        <p className="font-bold text-sm">Pick sheets for this week are locked until all spreads have been fully incorporated. Please check back later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Status Panel Card */}
      {entry && (
        <div className="relative overflow-hidden bg-slate-900/50 border border-slate-800 rounded-3xl p-6 backdrop-blur-md">
          {/* Decorative background glow */}
          <div
            className="absolute -right-16 -top-16 w-40 h-40 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ backgroundColor: primaryAccent }}
          />

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Your Entry:</span>
                <span className="text-white font-extrabold text-sm">{entry.userName}</span>
              </div>
              <div className="flex items-center gap-3">
                {entry.status === 'ALIVE' ? (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-black tracking-wide uppercase animate-pulse">
                    <Heart size={12} className="fill-emerald-400/20" /> Active & Alive
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full text-xs font-black tracking-wide uppercase">
                    <ShieldAlert size={12} /> Eliminated
                  </div>
                )}

                {entry.strikesUsed > 0 && (
                  <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 border border-amber-500/20 rounded-md">
                    Strikes: {entry.strikesUsed} / {maxStrikes}
                  </span>
                )}
                {maxRebuys > 0 && (
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 border border-indigo-500/20 rounded-md">
                    Rebuys: {entry.rebuysUsed ?? 0} / {maxRebuys}
                  </span>
                )}
              </div>
            </div>

            {/* Rebuy CTA */}
            {canRebuy && (
              <button
                onClick={handleRebuy}
                disabled={isRebuying}
                className="w-full md:w-auto bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black px-6 py-3 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-orange-500/10 transition-all hover:scale-[1.02] cursor-pointer"
              >
                <RotateCcw size={16} className={isRebuying ? 'animate-spin' : ''} />
                Rebuy / Buy-Back (${rebuyCost})
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-xs font-bold flex gap-2 items-center">
          <AlertCircle size={18} aria-hidden="true" /> {error}
        </div>
      )}

      {/* Persistent receipt — survives the toast so the user can always verify */}
      {submittedAt && !error && (
        <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-4 rounded-2xl text-xs font-bold flex gap-2 items-center">
          <CheckCircle2 size={18} aria-hidden="true" />
          Week {week} pick ({selectedTeam}) submitted at {formatTimeWithZone(submittedAt)}. You can change it until the game locks.
        </div>
      )}

      {/* 2. Mode Header */}
      <div className="bg-slate-900/30 border border-slate-800 rounded-2xl px-5 py-4 flex items-center gap-3">
        <div className="p-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl">
          <Shield size={18} />
        </div>
        <div>
          <h4 className="text-sm font-extrabold text-white uppercase tracking-wider">
            {pickLosersMode ? 'Pick the Loser' : 'Pick the Winner'}
          </h4>
          <p className="text-[11px] text-slate-400">
            {pickLosersMode 
              ? 'Select a team you expect to LOSE their game this week. If they lose or tie, you survive!'
              : 'Select a team you expect to WIN their game this week. If they win or tie, you survive!'}
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
            
            // Check if user is eliminated
            const isEliminated = entry?.status === 'ELIMINATED';

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
                    disabled={locked || isAwayUsed || isEliminated}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-2xl border transition-all text-center relative ${
                      isAwaySelected
                        ? 'bg-indigo-600/10 border-indigo-500/70 shadow-md shadow-indigo-500/5'
                        : isAwayUsed
                          ? 'bg-slate-950/20 border-slate-900/50 opacity-40 cursor-not-allowed'
                          : (locked || isEliminated)
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
                      <span className="absolute top-2 right-2 bg-indigo-500 text-slate-950 p-0.5 rounded-full">
                        <Check size={10} className="stroke-[4]" />
                      </span>
                    )}

                    {game.awayTeam.logoUrl && (
                      <img src={game.awayTeam.logoUrl} className="w-12 h-12 object-contain mb-2" alt={`${game.awayTeam.name} logo`} />
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
                    disabled={locked || isHomeUsed || isEliminated}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-2xl border transition-all text-center relative ${
                      isHomeSelected
                        ? 'bg-indigo-600/10 border-indigo-500/70 shadow-md shadow-indigo-500/5'
                        : isHomeUsed
                          ? 'bg-slate-950/20 border-slate-900/50 opacity-40 cursor-not-allowed'
                          : (locked || isEliminated)
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
                      <span className="absolute top-2 right-2 bg-indigo-500 text-slate-950 p-0.5 rounded-full">
                        <Check size={10} className="stroke-[4]" />
                      </span>
                    )}

                    {game.homeTeam.logoUrl && (
                      <img src={game.homeTeam.logoUrl} className="w-12 h-12 object-contain mb-2" alt={`${game.homeTeam.name} logo`} />
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
                <Save size={18} /> Lock In Survivor Selection
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
