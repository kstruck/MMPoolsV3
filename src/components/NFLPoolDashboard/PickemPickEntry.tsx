import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Lock, AlertCircle, AlertTriangle, ArrowRight, Save, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui';
import { dbService } from '../../services/dbService';
import { logger } from '../../utils/logger';
import { useToast } from '../ui/Toast';
import { getUserMessage, isLockError } from '../../utils/errorMessages';
import { now as serverNow } from '../../utils/serverClock';
import { formatTimeWithZone } from '../../utils/formatTime';
import { poolSeasonType } from '../../utils/nflPending';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { loadDraft, saveDraft, clearDraft } from '../../utils/draftStore';
import type { User, Pool, NFLGame } from '../../types';

interface PickemDraft {
  picks: Record<string, string>;
  confidence: Record<string, number>;
  tiebreakerPrediction: number;
}

interface PickemPickEntryProps {
  pool: Pool;
  user: User;
  week: number;
  games: NFLGame[];
  entry: any; // NFLPickemEntry or null
  isWeekLocked: boolean;
  /** Navigate the dashboard to another week (enables the post-submit "Next Week" CTA) */
  onGoToWeek?: (week: number) => void;
}

export const PickemPickEntry: React.FC<PickemPickEntryProps> = ({
  pool,
  week,
  games,
  entry,
  isWeekLocked,
  onGoToWeek
}) => {
  const castPool = pool as any;
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [tiebreakerPrediction, setTiebreakerPrediction] = useState<number>(40);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const toast = useToast();
  const errorRef = useRef<HTMLDivElement>(null);
  // Only persist drafts after the user actually edits — otherwise entry hydration
  // would immediately write a no-op draft and "Draft restored" would fire forever
  const dirtyRef = useRef(false);

  const confidenceMode = castPool.settings?.confidenceMode ?? false;
  const bufferMinutes = castPool.settings?.lockBufferMinutes ?? 5;
  const draftKey = `pickem:${pool.id}:${week}`;

  // Re-evaluate lock state every 30s so the UI flips to locked in place at T-0
  // instead of accepting taps the server will reject
  const [, setLockTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setLockTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Load existing picks when week, games, or entry changes; unsaved drafts win over
  // the last submitted entry (they are newer edits the user never got to submit)
  useEffect(() => {
    dirtyRef.current = false;
    const base: PickemDraft = entry
      ? { picks: entry.picks || {}, confidence: entry.confidence || {}, tiebreakerPrediction: entry.weeklyTiebreakers?.[week] ?? 40 }
      : { picks: {}, confidence: {}, tiebreakerPrediction: 40 };

    const draft = loadDraft<PickemDraft>(draftKey);
    if (draft && JSON.stringify(draft) !== JSON.stringify(base)) {
      setPicks(draft.picks);
      setConfidence(draft.confidence);
      setTiebreakerPrediction(draft.tiebreakerPrediction);
      dirtyRef.current = true;
      toast.info('Restored your unsubmitted picks from last time — submit to lock them in.');
    } else {
      if (draft) clearDraft(draftKey);
      setPicks(base.picks);
      setConfidence(base.confidence);
      setTiebreakerPrediction(base.tiebreakerPrediction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, week, draftKey]);

  // Persist edits so a closed tab never loses work
  useEffect(() => {
    if (!dirtyRef.current || isWeekLocked) return;
    saveDraft<PickemDraft>(draftKey, { picks, confidence, tiebreakerPrediction });
  }, [picks, confidence, tiebreakerPrediction, draftKey, isWeekLocked]);

  // Compute confidence range for this week: [17 - N .. 16]
  const N = games.length;
  const minVal = 17 - N;
  const availableConfidenceValues = useMemo(() => {
    return Array.from({ length: N }, (_, i) => minVal + i).reverse(); // high to low e.g., 16, 15, 14...
  }, [N, minVal]);

  // Check if a game is locked (server-corrected clock — device time can drift)
  const isGameLocked = (game: NFLGame): boolean => {
    if (isWeekLocked) return true; // Whole week locks
    const bufferMs = bufferMinutes * 60 * 1000;
    return serverNow() >= (game.startTime - bufferMs);
  };

  // Check for duplicate confidence selections
  const duplicateConfidenceValues = useMemo(() => {
    if (!confidenceMode) return new Set<number>();
    const seen = new Set<number>();
    const duplicates = new Set<number>();

    Object.entries(confidence).forEach(([gameId, value]) => {
      // Only audit games playing in this active week
      const gamePlaying = games.some(g => g.id === gameId);
      if (!gamePlaying) return;

      if (seen.has(value)) {
        duplicates.add(value);
      }
      seen.add(value);
    });

    return duplicates;
  }, [confidence, confidenceMode, games]);

  // Validate form completeness before permitting submission
  const canSubmit = useMemo(() => {
    if (games.length === 0) return false;

    // Check if every game has a pick
    const allPicked = games.every(g => !!picks[g.id]);
    if (!allPicked) return false;

    // In confidence mode, all values must be unique and set
    if (confidenceMode) {
      const allConfidenceSet = games.every(g => !!confidence[g.id]);
      if (!allConfidenceSet) return false;
      if (duplicateConfidenceValues.size > 0) return false;
    }

    return true;
  }, [games, picks, confidence, confidenceMode, duplicateConfidenceValues]);

  const handlePickSelect = (gameId: string, teamAbbreviation: string) => {
    const game = games.find(g => g.id === gameId);
    if (!game || isGameLocked(game)) return;

    dirtyRef.current = true;
    setPicks(prev => ({
      ...prev,
      [gameId]: teamAbbreviation
    }));
  };

  const handleConfidenceSelect = (gameId: string, val: number) => {
    const game = games.find(g => g.id === gameId);
    if (!game || isGameLocked(game)) return;

    dirtyRef.current = true;
    setConfidence(prev => ({
      ...prev,
      [gameId]: val
    }));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setValidationError(null);

    // Same requestId on retry — the server treats a resend as a no-op success,
    // so a lost response can never double-write
    const payload = {
      poolId: pool.id,
      week,
      picks,
      confidence: confidenceMode ? confidence : undefined,
      tiebreakerPrediction,
      requestId: crypto.randomUUID()
    };

    // Inside the final 10 minutes a transient failure gets ONE automatic retry —
    // "network blipped at T-30s" must not cost someone their week
    const earliestKickoff = games.length ? Math.min(...games.map(g => g.startTime)) : Infinity;
    const nearLock = earliestKickoff - serverNow() < 10 * 60 * 1000;

    try {
      try {
        await dbService.submitNFLPicks(payload);
      } catch (firstErr: any) {
        const retryable = nearLock && !isLockError(firstErr) && !String(firstErr?.code ?? '').includes('invalid-argument');
        if (!retryable) throw firstErr;
        logger.warn('Submit failed near lock — retrying once', firstErr);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await dbService.submitNFLPicks(payload);
      }
      clearDraft(draftKey);
      dirtyRef.current = false;
      setSubmittedAt(serverNow());
      toast.success(`Week ${week} picks submitted!`);
    } catch (err: any) {
      logger.error('Failed to submit pick sheet:', err);
      const message = getUserMessage(err, 'Your picks were NOT saved. Please try again.');
      setValidationError(message);
      toast.error(message);
      // Make sure a failed save is impossible to miss — the banner may be scrolled away
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pickedCount = useMemo(() => games.filter(g => !!picks[g.id]).length, [games, picks]);

  // Find if there is a scheduled MNF tiebreaker game
  const showTiebreaker = useMemo(() => {
    return games.some(g => g.isMonday);
  }, [games]);

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
      {validationError && (
        <div ref={errorRef} role="alert" className="bg-brandred-600/10 border border-brandred-600/20 text-brandred-600 p-4 rounded-lg text-xs font-body font-bold flex gap-2 items-center">
          <AlertCircle size={18} aria-hidden="true" /> {validationError}
        </div>
      )}

      {/* Persistent receipt — survives the toast so the user can always verify */}
      {submittedAt && !validationError && (
        <div role="status" className="bg-gold-400/10 border border-gold-500/40 text-gold-700 dark:text-gold-400 p-4 rounded-lg text-xs font-body font-bold num flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex gap-2 items-center flex-1">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{nflWeekLabel(poolSeasonType(pool), week)} picks submitted at {formatTimeWithZone(submittedAt)}. You can change unlocked picks and resubmit until kickoff.</span>
          </div>
          {onGoToWeek && week < (poolSeasonType(castPool) === 1 ? 4 : 18) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onGoToWeek(week + 1)}
              className="shrink-0 num"
            >
              Pick Week {week + 1} <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}

      {/* Progress — how much of the sheet is done */}
      {games.length > 0 && !isWeekLocked && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-line rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-150 ${pickedCount === games.length ? 'bg-gold-foil' : 'bg-navy-600 dark:bg-gold-500'}`}
              style={{ width: `${(pickedCount / games.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-display font-bold uppercase tracking-[0.05em] text-muted num whitespace-nowrap">
            {pickedCount} of {games.length} picked
          </span>
        </div>
      )}

      {/* Matchups list */}
      <div className="space-y-4">
        {games.length === 0 ? (
          <div className="bg-card p-8 border border-line rounded-xl text-center">
            <p className="text-muted font-body font-bold num">No NFL matchups scheduled for {nflWeekLabel(poolSeasonType(pool), week)}.</p>
          </div>
        ) : (
          games.map(game => {
            const locked = isGameLocked(game);
            const myPick = picks[game.id];
            
            const homePicked = myPick === game.homeTeam.abbreviation;
            const awayPicked = myPick === game.awayTeam.abbreviation;

            const homeWon = game.status === 'FINAL' && (game.scores?.home ?? 0) > (game.scores?.away ?? 0);
            const awayWon = game.status === 'FINAL' && (game.scores?.away ?? 0) > (game.scores?.home ?? 0);

            const isCorrect = 
              (homeWon && homePicked) || (awayWon && awayPicked);

            return (
              <div
                key={game.id}
                className={`bg-card border rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-150 relative overflow-hidden shadow-card ${
                  game.status === 'FINAL'
                    ? isCorrect
                      ? 'border-[#BEE7D0] bg-[#0F7B4A]/5'
                      : 'border-brandred-600/30 bg-brandred-600/5'
                    : 'border-line'
                }`}
              >
                {/* Visual Lock overlay */}
                {locked && game.status === 'SCHEDULED' && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-page border border-line rounded-full px-2 py-0.5 text-[9px] text-muted font-display font-bold tracking-[0.08em] uppercase">
                    <Lock size={9} /> Locked
                  </div>
                )}

                {/* Team Buttons */}
                <div className="flex-grow flex items-center justify-center gap-6 w-full md:w-auto">
                  {/* AWAY TEAM */}
                  <button
                    onClick={() => handlePickSelect(game.id, game.awayTeam.abbreviation)}
                    disabled={locked}
                    className={`flex-1 max-w-[200px] flex flex-col items-center p-3 rounded-lg border transition-all duration-150 text-center ${
                      awayPicked
                        ? 'bg-page border-navy-600 ring-2 ring-navy-600 dark:border-gold-500 dark:ring-gold-500'
                        : 'bg-page border-line'
                    } ${locked ? 'cursor-not-allowed opacity-90' : 'hover:-translate-y-1 hover:shadow-card-hover'}`}
                  >
                    {game.awayTeam.logoUrl && (
                      <img src={game.awayTeam.logoUrl} className="w-10 h-10 object-contain mb-2" alt={`${game.awayTeam.name} logo`} />
                    )}
                    <span className="text-[color:var(--text)] font-display font-bold text-sm leading-tight truncate w-full">
                      {game.awayTeam.name}
                    </span>
                    <span className="text-muted text-[10px] font-display font-bold tracking-[0.16em] mt-0.5">
                      {game.awayTeam.abbreviation}
                    </span>
                  </button>

                  <div className="flex flex-col items-center justify-center">
                    {game.status === 'FINAL' ? (
                      <div className="text-center">
                        <span className="text-muted text-[10px] font-display font-bold uppercase tracking-[0.08em] block mb-1">Final</span>
                        <span className="text-xl font-display font-bold text-[color:var(--text)] num">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                      </div>
                    ) : game.status === 'IN_PROGRESS' ? (
                      <div className="text-center">
                        <span className="relative flex h-2 w-2 mx-auto mb-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brandred-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-brandred-600"></span>
                        </span>
                        <span className="text-sm font-display font-bold text-brandred-600 num">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                        <span className="text-[10px] text-muted num block mt-0.5">{game.clock}</span>
                      </div>
                    ) : (
                      <div className="text-faint text-xs font-display font-bold tracking-[0.16em]">VS</div>
                    )}
                    {castPool.settings?.pickMode === 'ATS' && game.spread && (
                      <div className="text-center mt-2">
                        <span className="bg-page border border-line text-muted text-[10px] px-2 py-1 rounded-full font-display font-bold uppercase tracking-[0.05em] num">
                          Spread: {game.spread.value > 0 ? `+${game.spread.value}` : game.spread.value === 0 ? 'EVEN' : game.spread.value}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* HOME TEAM */}
                  <button
                    onClick={() => handlePickSelect(game.id, game.homeTeam.abbreviation)}
                    disabled={locked}
                    className={`flex-1 max-w-[200px] flex flex-col items-center p-3 rounded-lg border transition-all duration-150 text-center ${
                      homePicked
                        ? 'bg-page border-navy-600 ring-2 ring-navy-600 dark:border-gold-500 dark:ring-gold-500'
                        : 'bg-page border-line'
                    } ${locked ? 'cursor-not-allowed opacity-90' : 'hover:-translate-y-1 hover:shadow-card-hover'}`}
                  >
                    {game.homeTeam.logoUrl && (
                      <img src={game.homeTeam.logoUrl} className="w-10 h-10 object-contain mb-2" alt={`${game.homeTeam.name} logo`} />
                    )}
                    <span className="text-[color:var(--text)] font-display font-bold text-sm leading-tight truncate w-full">
                      {game.homeTeam.name}
                    </span>
                    <span className="text-muted text-[10px] font-display font-bold tracking-[0.16em] mt-0.5">
                      {game.homeTeam.abbreviation}
                    </span>
                  </button>
                </div>

                {/* Confidence Assignments */}
                {confidenceMode && (
                  <div className="flex flex-col items-center justify-center bg-page p-3 border border-line rounded-lg min-w-[120px] w-full md:w-auto">
                    <span className="text-[9px] text-muted font-display font-bold uppercase tracking-[0.08em] block mb-1">Confidence Weight</span>
                    <select
                      value={confidence[game.id] || ''}
                      disabled={locked}
                      onChange={e => handleConfidenceSelect(game.id, parseInt(e.target.value))}
                      aria-label={`Confidence weight for ${game.awayTeam.abbreviation} at ${game.homeTeam.abbreviation}`}
                      className={`bg-page text-[color:var(--text)] border border-line rounded-xl px-2 py-2.5 focus:outline-none text-xs font-body font-bold num w-full text-center ${
                        duplicateConfidenceValues.has(confidence[game.id]) ? 'border-gold-500 focus:ring-gold-500' : ''
                      } ${locked ? 'opacity-85 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Set weight...</option>
                      {availableConfidenceValues.map(v => (
                        <option key={v} value={v}>Confidence {v}</option>
                      ))}
                    </select>

                    {duplicateConfidenceValues.has(confidence[game.id]) && (
                      <span className="text-[9px] text-gold-600 dark:text-gold-400 font-body font-bold flex items-center gap-1 mt-1">
                        <AlertTriangle size={9} aria-hidden="true" /> Duplicate value!
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Tiebreaker Details & Submission CTA */}
      {games.length > 0 && !isWeekLocked && (
        <div className="bg-card border border-line rounded-xl p-6 shadow-card space-y-6">
          {showTiebreaker && (
            <div className="max-w-md mx-auto space-y-3">
              <label className="block text-sm font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-center">
                Tiebreaker: Predicted Monday Night Football Combined Score
              </label>
              <input
                type="number"
                value={tiebreakerPrediction}
                onChange={e => { dirtyRef.current = true; setTiebreakerPrediction(Math.max(1, parseInt(e.target.value) || 0)); }}
                className="w-full bg-page border border-line rounded-xl px-4 py-3 text-[color:var(--text)] text-center num font-bold focus:outline-none focus:ring-2 focus:ring-navy-600 dark:focus:ring-gold-500"
              />
              <p className="text-[10px] font-body text-muted leading-normal text-center">
                Close counts: Predict the combined final score of the MNF games. If there are 2 MNF games, we count the combined score of <strong>both</strong> games.
              </p>
            </div>
          )}

          <div className="flex justify-center">
            <Button
              variant="primary"
              size="lg"
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? 'Saving picks...' : (
                <>
                  <Save size={18} /> Submit Weekly Picks
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
