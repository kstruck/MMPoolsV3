import React, { useState, useEffect, useMemo } from 'react';
import { Lock, AlertCircle, Save, Percent, ArrowUpRight, ArrowDownRight, Check, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import { useToast } from '../ui/Toast';
import { getUserMessage } from '../../utils/errorMessages';
import { now as serverNow } from '../../utils/serverClock';
import { formatTimeWithZone } from '../../utils/formatTime';
import type { User, Pool, NFLGame } from '../../types';
import { poolSeasonType } from '../../utils/nflPending';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { pickHighlightClass, pickHighlightLabel, pickBadgeClass } from '../../utils/pickHighlight';

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
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const toast = useToast();

  const settings = (pool as any).settings || {};

  // The session receipt describes ONE week's submit — reset on week change
  // only. NOT in the load effect below: that also fires when the entry
  // snapshot refreshes right after a successful submit, and would wipe the
  // receipt it just earned. Same shape as PickemPickEntry (codex r1).
  useEffect(() => {
    setSubmittedAt(null);
  }, [week]);

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

  const handleTeamSelect = (teamAbbreviation: string, game: NFLGame) => {
    if (isGameLocked(game)) return;
    if (usedTeams.has(teamAbbreviation)) return;

    setSelectedTeam(teamAbbreviation);
  };

  // The pick the SERVER already holds for this week — the source of truth the
  // submit path compares against. `selectedTeam` alone cannot distinguish "I
  // just clicked this" from "this was loaded from my saved entry".
  const savedPick: string | null = entry?.picks?.[week] ?? null;

  const handleSubmit = async () => {
    if (!selectedTeam || isSelectionLocked) return;

    // Re-submitting the pick that is already saved is not an error — it is a
    // member double-checking. The server would reject it (its usedTeams guard
    // does not exempt the current week's own pick), and the rejection rendered
    // as "Your pick was NOT saved", telling someone their SAVED pick failed.
    // Answer the actual question — "is my pick in?" — without a server call.
    if (savedPick && selectedTeam === savedPick) {
      setError(null);
      setSubmittedAt(entry?.submittedAt ?? serverNow());
      toast.success(`You're all set — your ${nflWeekLabel(poolSeasonType(pool), week)} pick (${selectedTeam}) is already saved.`);
      return;
    }

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
      toast.success(`Margin pick locked in: ${selectedTeam}`);
    } catch (err: any) {
      logger.error('Failed to submit Margin pick:', err);
      const message = getUserMessage(err, 'Your pick was NOT saved. Please try again.');
      setError(message);
      toast.error(message);
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
      {/* 1. Margin Stats Dashboard */}
      {entry && (
        <div className="relative overflow-hidden bg-card border border-line rounded-xl p-6 shadow-card">
          {/* Decorative background glow */}
          <div
            className="absolute -right-16 -top-16 w-40 h-40 rounded-full blur-3xl opacity-10 pointer-events-none"
            style={{ backgroundColor: primaryAccent }}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
            <div className="bg-page p-4 border border-line rounded-lg">
              <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted block mb-1">Season Score</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-display font-bold text-[color:var(--text)] num">{entry.seasonTotal ?? 0}</span>
                <span className="text-muted text-xs font-body font-bold">pts</span>
              </div>
            </div>

            <div className="bg-page p-4 border border-line rounded-lg">
              <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted block mb-1">Negative Burden</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-display font-bold text-brandred-600 dark:text-brandred-500 num">-{entry.negativeBurden ?? 0}</span>
                <span className="text-muted text-xs font-body font-bold">pts</span>
              </div>
            </div>

            <div className="bg-page p-4 border border-line rounded-lg">
              <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted block mb-1">Best Week</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-display font-bold text-gold-600 dark:text-gold-400 num">+{entry.bestWeek ?? 0}</span>
                <span className="text-muted text-xs font-body font-bold">pts</span>
              </div>
            </div>

            <div className="bg-page p-4 border border-line rounded-lg">
              <span className="font-display font-bold uppercase text-[10px] tracking-[0.08em] text-muted block mb-1">Win Rate</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-display font-bold text-[color:var(--text)] num">
                  {entry.positiveWeeks ?? 0}
                </span>
                <span className="text-muted text-xs font-body font-bold">weeks</span>
              </div>
            </div>
          </div>

          {currentWeekScore !== null && (
            <div className="mt-4 pt-4 border-t border-line flex justify-between items-center text-sm font-body font-semibold">
              <span className="text-muted num">{nflWeekLabel(poolSeasonType(pool), week)} Result:</span>
              <span className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-display font-bold uppercase num ${
                currentWeekScore >= 0
                  ? 'bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A]'
                  : 'bg-brandred-600/10 border border-brandred-600/20 text-brandred-600'
              }`}>
                {currentWeekScore >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {currentWeekScore >= 0 ? `+${currentWeekScore}` : `${currentWeekScore}`} Points
              </span>
            </div>
          )}
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
          {nflWeekLabel(poolSeasonType(pool), week)} pick ({selectedTeam}) submitted at {formatTimeWithZone(submittedAt)}. You can change it until the game locks.
        </div>
      )}

      {/* Saved-state banner from the SERVER's entry, not session state. The
          receipt above only exists after a submit in this browser session, so a
          member who saved yesterday and reloads sees nothing telling them their
          pick is in — which is precisely the doubt that made a real user
          re-submit the same pick and read the rejection as "not saved". */}
      {savedPick && !submittedAt && !error && (
        <div role="status" className="bg-gold-400/10 border border-gold-500/40 text-gold-700 dark:text-gold-400 p-4 rounded-lg text-xs font-body font-bold num flex gap-2 items-center">
          <CheckCircle2 size={18} aria-hidden="true" />
          Your {nflWeekLabel(poolSeasonType(pool), week)} pick is saved: {savedPick}.
          {isSelectionLocked ? ' Picks are locked for this week.' : ' You can change it until lock.'}
        </div>
      )}

      {/* 2. Rules Helper */}
      <div className="bg-card border border-line rounded-lg px-5 py-4 flex items-center gap-3">
        <div className="p-2 bg-navy-700/10 text-navy-700 dark:bg-gold-400/10 dark:text-gold-400 border border-line rounded-xl">
          <Percent size={18} />
        </div>
        <div>
          <h4 className="text-sm font-display font-bold text-[color:var(--text)] uppercase tracking-[0.08em]">Margin of Victory Selection</h4>
          <p className="text-[11px] font-body text-muted">
            Pick one team each week. Your score is their victory margin (e.g. if they win by 14, you get +14).
            If they lose, the negative margin counts against you. You cannot pick the same team twice in a season.
          </p>
        </div>
      </div>

      {/* 3. Game / Team Matchup Grid */}
      <div className="space-y-4">
        {games.length === 0 ? (
          <div className="bg-card p-8 border border-line rounded-xl text-center">
            <p className="text-muted font-body font-bold num">No NFL matchups scheduled for {nflWeekLabel(poolSeasonType(pool), week)}.</p>
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
                    disabled={locked || isAwayUsed}
                    title={pickHighlightLabel(isAwaySelected, savedPick === awayAbbrev) || undefined}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-lg border transition-all duration-150 text-center relative ${
                      isAwaySelected
                        ? pickHighlightClass(true, savedPick === awayAbbrev)
                        : isAwayUsed
                          ? 'bg-page border-line opacity-40 cursor-not-allowed'
                          : locked
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
                      <span className={`absolute top-2 right-2 p-0.5 rounded-full ${pickBadgeClass(savedPick === awayAbbrev)}`}>
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
                    disabled={locked || isHomeUsed}
                    title={pickHighlightLabel(isHomeSelected, savedPick === homeAbbrev) || undefined}
                    className={`flex-1 max-w-[240px] flex flex-col items-center p-4 rounded-lg border transition-all duration-150 text-center relative ${
                      isHomeSelected
                        ? pickHighlightClass(true, savedPick === homeAbbrev)
                        : isHomeUsed
                          ? 'bg-page border-line opacity-40 cursor-not-allowed'
                          : locked
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
                      <span className={`absolute top-2 right-2 p-0.5 rounded-full ${pickBadgeClass(savedPick === homeAbbrev)}`}>
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
            {isSubmitting ? 'Locking in...' : savedPick === selectedTeam ? (
              // The selection on screen IS the saved pick. Label with the fact
              // rather than an action, so "did it save?" is answered before the
              // click — clicking still works and confirms via handleSubmit's
              // short-circuit.
              <>
                <Check size={18} /> Pick Saved: {selectedTeam}
              </>
            ) : (
              <>
                <Save size={18} /> {savedPick ? `Change Pick to ${selectedTeam}` : 'Lock In Margin Selection'}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
