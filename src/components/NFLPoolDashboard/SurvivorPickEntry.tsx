import React, { useState, useEffect, useMemo } from 'react';
import { Lock, AlertCircle, Save, RotateCcw, Shield, ShieldAlert, Heart, Check, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui';
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
        },
        requestId: crypto.randomUUID()
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
          <p className="mt-2 text-muted num">Rebuys used: {(entry?.rebuysUsed ?? 0)} of {maxRebuys}. Available through Week {rebuyDeadlineWeek}.</p>
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
      <div className="bg-gold-400/10 border border-gold-500/40 text-gold-600 dark:text-gold-400 p-8 rounded-xl text-center">
        <AlertCircle size={48} className="mx-auto mb-4 opacity-50" />
        <h3 className="font-display font-bold uppercase text-xl mb-2">Spreads Not Yet Finalized</h3>
        <p className="font-body font-semibold text-sm">Pick sheets for this week are locked until all spreads have been fully incorporated. Please check back later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Status Panel Card */}
      {entry && (
        <div className="relative overflow-hidden bg-card border border-line rounded-xl p-6 shadow-card">
          {/* Decorative background glow */}
          <div
            className="absolute -right-16 -top-16 w-40 h-40 rounded-full blur-3xl opacity-10 pointer-events-none"
            style={{ backgroundColor: primaryAccent }}
          />

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted">Your Entry:</span>
                <span className="text-[color:var(--text)] font-display font-bold text-sm">{entry.userName}</span>
              </div>
              <div className="flex items-center gap-3">
                {entry.status === 'ALIVE' ? (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A] rounded-full text-xs font-display font-bold tracking-[0.08em] uppercase animate-pulse">
                    <Heart size={12} className="fill-[#0F7B4A]/20" /> Active & Alive
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-brandred-600/10 border border-brandred-600/20 text-brandred-600 rounded-full text-xs font-display font-bold tracking-[0.08em] uppercase">
                    <ShieldAlert size={12} /> Eliminated
                  </div>
                )}

                {entry.strikesUsed > 0 && (
                  <span className="text-xs font-display font-bold uppercase tracking-[0.05em] num text-gold-600 dark:text-gold-400 bg-gold-400/10 px-2 py-0.5 border border-gold-500/40 rounded-md">
                    Strikes: {entry.strikesUsed} / {maxStrikes}
                  </span>
                )}
                {maxRebuys > 0 && (
                  <span className="text-xs font-display font-bold uppercase tracking-[0.05em] num text-navy-700 dark:text-gold-400 bg-navy-700/10 dark:bg-gold-400/10 px-2 py-0.5 border border-line rounded-md">
                    Rebuys: {entry.rebuysUsed ?? 0} / {maxRebuys}
                  </span>
                )}
              </div>
            </div>

            {/* Rebuy CTA */}
            {canRebuy && (
              <Button
                variant="premium"
                onClick={handleRebuy}
                disabled={isRebuying}
                className="w-full md:w-auto num"
              >
                <RotateCcw size={16} className={isRebuying ? 'animate-spin' : ''} />
                Rebuy / Buy-Back (${rebuyCost})
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-brandred-600/10 border border-brandred-600/20 text-brandred-600 p-4 rounded-lg text-xs font-body font-bold flex gap-2 items-center">
          <AlertCircle size={18} aria-hidden="true" /> {error}
        </div>
      )}

      {/* Persistent receipt — survives the toast so the user can always verify */}
      {submittedAt && !error && (
        <div role="status" className="bg-gold-400/10 border border-gold-500/40 text-gold-700 dark:text-gold-400 p-4 rounded-lg text-xs font-body font-bold num flex gap-2 items-center">
          <CheckCircle2 size={18} aria-hidden="true" />
          Week {week} pick ({selectedTeam}) submitted at {formatTimeWithZone(submittedAt)}. You can change it until the game locks.
        </div>
      )}

      {/* 2. Mode Header */}
      <div className="bg-card border border-line rounded-lg px-5 py-4 flex items-center gap-3">
        <div className="p-2 bg-navy-700/10 text-navy-700 dark:bg-gold-400/10 dark:text-gold-400 border border-line rounded-xl">
          <Shield size={18} />
        </div>
        <div>
          <h4 className="text-sm font-display font-bold text-[color:var(--text)] uppercase tracking-[0.08em]">
            {pickLosersMode ? 'Pick the Loser' : 'Pick the Winner'}
          </h4>
          <p className="text-[11px] font-body text-muted">
            {pickLosersMode 
              ? 'Select a team you expect to LOSE their game this week. If they lose or tie, you survive!'
              : 'Select a team you expect to WIN their game this week. If they win or tie, you survive!'}
          </p>
        </div>
      </div>

      {/* 3. Game / Team Matchup Grid */}
      <div className="space-y-4">
        {games.length === 0 ? (
          <div className="bg-card p-8 border border-line rounded-xl text-center">
            <p className="text-muted font-body font-bold num">No NFL matchups scheduled for Week {week}.</p>
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
                className="bg-card border border-line rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-150 relative overflow-hidden shadow-card"
              >
                {/* Visual Lock overlay */}
                {locked && game.status === 'SCHEDULED' && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-page border border-line rounded-full px-2 py-0.5 text-[9px] text-muted font-display font-bold tracking-[0.08em] uppercase">
                    <Lock size={9} /> Locked
                  </div>
                )}

                {/* Team Buttons Grid */}
                <div className="flex-grow flex items-center justify-center gap-6 w-full">
                  
                  {/* AWAY TEAM */}
                  <button
                    onClick={() => handleTeamSelect(awayAbbrev, game)}
                    disabled={locked || isAwayUsed || isEliminated}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-lg border transition-all duration-150 text-center relative ${
                      isAwaySelected
                        ? 'bg-page border-navy-600 ring-2 ring-navy-600 dark:border-gold-500 dark:ring-gold-500'
                        : isAwayUsed
                          ? 'bg-page border-line opacity-40 cursor-not-allowed'
                          : (locked || isEliminated)
                            ? 'bg-page border-line opacity-80 cursor-not-allowed'
                            : 'bg-page border-line hover:-translate-y-1 hover:shadow-card-hover'
                    }`}
                  >
                    {isAwayUsed && (
                      <span className="absolute top-2 left-2 bg-page border border-line text-faint text-[8px] font-display font-bold tracking-[0.16em] px-1.5 py-0.5 rounded-full uppercase">
                        Used
                      </span>
                    )}
                    {isAwaySelected && (
                      <span className="absolute top-2 right-2 bg-navy-800 text-white dark:bg-gold-500 dark:text-ink p-0.5 rounded-full">
                        <Check size={10} className="stroke-[4]" />
                      </span>
                    )}

                    {game.awayTeam.logoUrl && (
                      <img src={game.awayTeam.logoUrl} className="w-12 h-12 object-contain mb-2" alt={`${game.awayTeam.name} logo`} />
                    )}
                    <span className="text-[color:var(--text)] font-display font-bold text-sm leading-tight truncate w-full">
                      {game.awayTeam.name}
                    </span>
                    <span className="text-muted text-[10px] font-display font-bold tracking-[0.16em] mt-0.5">
                      {awayAbbrev}
                    </span>
                  </button>

                  {/* SCORE OR VS STATUS */}
                  <div className="flex flex-col items-center justify-center min-w-[60px]">
                    {game.status === 'FINAL' ? (
                      <div className="text-center">
                        <span className="text-muted text-[9px] font-display font-bold uppercase tracking-[0.08em] block mb-1">Final</span>
                        <span className="text-base font-display font-bold text-[color:var(--text)] num">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                      </div>
                    ) : game.status === 'IN_PROGRESS' ? (
                      <div className="text-center">
                        <span className="relative flex h-1.5 w-1.5 mx-auto mb-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brandred-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brandred-600"></span>
                        </span>
                        <span className="text-sm font-display font-bold text-brandred-600 num">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                        <span className="text-[9px] text-muted num block mt-0.5 leading-none">{game.clock}</span>
                      </div>
                    ) : (
                      <div className="text-faint text-xs font-display font-bold tracking-[0.16em]">VS</div>
                    )}
                  </div>

                  {/* HOME TEAM */}
                  <button
                    onClick={() => handleTeamSelect(homeAbbrev, game)}
                    disabled={locked || isHomeUsed || isEliminated}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-lg border transition-all duration-150 text-center relative ${
                      isHomeSelected
                        ? 'bg-page border-navy-600 ring-2 ring-navy-600 dark:border-gold-500 dark:ring-gold-500'
                        : isHomeUsed
                          ? 'bg-page border-line opacity-40 cursor-not-allowed'
                          : (locked || isEliminated)
                            ? 'bg-page border-line opacity-80 cursor-not-allowed'
                            : 'bg-page border-line hover:-translate-y-1 hover:shadow-card-hover'
                    }`}
                  >
                    {isHomeUsed && (
                      <span className="absolute top-2 left-2 bg-page border border-line text-faint text-[8px] font-display font-bold tracking-[0.16em] px-1.5 py-0.5 rounded-full uppercase">
                        Used
                      </span>
                    )}
                    {isHomeSelected && (
                      <span className="absolute top-2 right-2 bg-navy-800 text-white dark:bg-gold-500 dark:text-ink p-0.5 rounded-full">
                        <Check size={10} className="stroke-[4]" />
                      </span>
                    )}

                    {game.homeTeam.logoUrl && (
                      <img src={game.homeTeam.logoUrl} className="w-12 h-12 object-contain mb-2" alt={`${game.homeTeam.name} logo`} />
                    )}
                    <span className="text-[color:var(--text)] font-display font-bold text-sm leading-tight truncate w-full">
                      {game.homeTeam.name}
                    </span>
                    <span className="text-muted text-[10px] font-display font-bold tracking-[0.16em] mt-0.5">
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
        <div className="bg-card border border-line rounded-xl p-6 shadow-card flex justify-center">
          <Button
            variant="primary"
            size="lg"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Locking in...' : (
              <>
                <Save size={18} /> Lock In Survivor Selection
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
