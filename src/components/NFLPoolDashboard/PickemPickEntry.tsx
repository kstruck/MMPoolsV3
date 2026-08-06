import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Lock, AlertCircle, AlertTriangle, Check, Save, CheckCircle2 } from 'lucide-react';
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
import { pickHighlightClass, pickHighlightLabel } from '../../utils/pickHighlight';
import { poolUsesSpreads } from '../../utils/poolUsesSpreads';
import { gradePick } from '../../utils/pickemResult';
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
}

export const PickemPickEntry: React.FC<PickemPickEntryProps> = ({
  pool,
  week,
  games,
  entry,
  isWeekLocked
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
  // The session receipt describes ONE week's submit. Carrying it across a week
  // switch relabels it as the new week's submission AND suppresses the
  // entry-derived saved banner for that week (codex r1 on the banner change).
  // Its own effect, keyed on `week` ONLY: the load effect below also fires when
  // the ENTRY snapshot refreshes — which happens moments after every successful
  // submit — and resetting there would wipe the receipt it just earned.
  useEffect(() => {
    setSubmittedAt(null);
    // Week-scoped like the receipt: a week-N submit error carried into week M
    // both displays against the wrong week and suppresses the saved banner
    // (gated on !validationError). Margin/Survivor clear theirs in the load
    // effect; Pick'em never did (qodo, on this PR).
    setValidationError(null);
  }, [week]);

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

  // How much of THIS week's slate the server already holds, and whether the
  // sheet on screen still matches it. Drives the submit button's three states.
  // The button used to read "Submit Weekly Picks" forever — even on a sheet
  // that was fully saved and untouched — while Survivor and Margin both said
  // "Pick Saved: CAR" (#378). Kevin's live test flagged Pick'em as the odd one
  // out for the second time; the saved BANNER was the first half (#379).
  const savedCount = useMemo(
    () => (entry?.picks ? games.filter(g => !!entry.picks[g.id]).length : 0),
    [entry, games]
  );

  // "Edited" is draft-vs-entry, not a dirty flag: `dirtyRef` latches on the
  // first tap and never clears, so it cannot tell "changed my mind back" from
  // a real edit. Compared per-field against the same base the load effect
  // hydrates from, so the two can never disagree about what "unchanged" means.
  const matchesSaved = useMemo(() => {
    if (!entry?.picks) return false;
    if (!games.every(g => picks[g.id] === entry.picks[g.id])) return false;
    if (confidenceMode && !games.every(g => (confidence[g.id] ?? null) === (entry.confidence?.[g.id] ?? null))) return false;
    // Unconditional, including on a week with no MNF game: the tiebreaker's
    // base value is loaded FROM the entry either way, so an untouched sheet
    // matches whether or not the input is on screen.
    return tiebreakerPrediction === (entry.weeklyTiebreakers?.[week] ?? 40);
  }, [entry, games, picks, confidence, confidenceMode, tiebreakerPrediction, week]);

  // Green "saved" only when the WHOLE slate is in and untouched — a half-saved
  // sheet must not claim to be complete, which is the same overclaiming trap
  // the saved banner avoids by printing "(N of M)".
  const sheetFullySaved = games.length > 0 && savedCount === games.length && matchesSaved;
  const hasUnsavedEdits = savedCount > 0 && !matchesSaved;

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
      toast.success(`${nflWeekLabel(poolSeasonType(pool), week)} picks submitted!`);
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

  // Spreads block the sheet ONLY on a pool whose scoring reads them — i.e. an
  // ATS pick'em. Mirrors the server's own precondition, which was scoped the
  // same way in #214 and has been deployed that way since; this client copy is
  // what has been blocking straight-up pick'em on a spread-less week.
  const spreadsBlock = useMemo(() => {
    if (!poolUsesSpreads(castPool)) return false;
    // EVERY game of the week, cancelled ones included — because that is what
    // the server checks (`nflPools.ts`: `games.every(g => g.spread?.locked ===
    // true)` over the whole week query). The client used to exempt CANCELLED,
    // so a cancelled game with no locked line rendered an editable sheet whose
    // every submission failed with SPREADS_NOT_LOCKED. Unreachable until the
    // wizard could create an ATS pool; exposing the mode made it live.
    // (codex, on that PR.)
    return !games.every(g => g.spread?.locked);
  }, [games, castPool]);

  if (spreadsBlock) {
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

      {/* Persistent receipt — survives the toast so the user can always verify.
          The "Pick <next week> →" CTA that used to sit here is REMOVED (Kevin,
          2026-08-05): next week's spreads are not locked yet, so it landed the
          member on "Spreads Not Yet Finalized" with nothing to do — a dead end
          served as a next step. It is not gated on lock state instead because
          the WeekChecklist strip already advances on its own once a week opens,
          so a second, worse advance control has no job. */}
      {submittedAt && !validationError && (
        <div role="status" className="bg-gold-400/10 border border-gold-500/40 text-gold-700 dark:text-gold-400 p-4 rounded-lg text-xs font-body font-bold num flex gap-2 items-center">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{nflWeekLabel(poolSeasonType(pool), week)} picks submitted at {formatTimeWithZone(submittedAt)}. You can change unlocked picks and resubmit until kickoff.</span>
        </div>
      )}

      {/* Saved-state banner from the SERVER's entry, not session state — the
          receipt above only exists after a submit in this browser session, so
          a member who saved yesterday and reloads saw nothing saying their
          picks are in. Margin and Survivor gained the same banner in #378;
          Kevin's live test flagged Pick'em as the odd one out. Counting is per
          THIS week's games against the saved entry, so a partially-saved sheet
          says so rather than overclaiming. */}
      {!submittedAt && !validationError && entry?.picks && (() => {
        const savedCount = games.filter(g => !!entry.picks[g.id]).length;
        if (savedCount === 0) return null;
        return (
          <div role="status" className="bg-gold-400/10 border border-gold-500/40 text-gold-700 dark:text-gold-400 p-4 rounded-lg text-xs font-body font-bold num flex gap-2 items-center">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>
              Your {nflWeekLabel(poolSeasonType(pool), week)} picks are saved ({savedCount} of {games.length}).
              {isWeekLocked ? ' Picks are locked for this week.' : ' You can change unlocked picks and resubmit until kickoff.'}
            </span>
          </div>
        );
      })()}

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

            // Per-GAME saved state, not per-sheet: on a partially-edited sheet
            // the untouched games are genuinely saved and should stay green.
            const savedForGame: string | undefined = entry?.picks?.[game.id];
            const homeSaved = savedForGame === game.homeTeam.abbreviation;
            const awaySaved = savedForGame === game.awayTeam.abbreviation;

            // Graded the way the SCORER grades it. This used to compare raw
            // scores, which is right for straight-up and wrong for ATS: a pick
            // that covered but lost outright rendered RED while the server
            // recorded a WIN. Unreachable until the wizard gained an ATS
            // control; exposing the mode is what made it live.
            const result = gradePick(game, savedForGame ?? myPick, castPool.settings?.pickMode);
            const isCorrect = result === 'W';
            // A PUSH is neither a win nor a loss — colouring it red would call
            // a refunded pick wrong.
            const isGraded = result === 'W' || result === 'L';

            return (
              <div
                key={game.id}
                className={`bg-card border rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all duration-150 relative overflow-hidden shadow-card ${
                  isGraded
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
                    title={pickHighlightLabel(awayPicked, awaySaved) || undefined}
                    aria-label={`${game.awayTeam.name}${pickHighlightLabel(awayPicked, awaySaved) ? ` — ${pickHighlightLabel(awayPicked, awaySaved)}` : ''}`}
                    className={`flex-1 max-w-[200px] flex flex-col items-center p-3 rounded-lg border transition-all duration-150 text-center ${
                      pickHighlightClass(awayPicked, awaySaved)
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
                    title={pickHighlightLabel(homePicked, homeSaved) || undefined}
                    aria-label={`${game.homeTeam.name}${pickHighlightLabel(homePicked, homeSaved) ? ` — ${pickHighlightLabel(homePicked, homeSaved)}` : ''}`}
                    className={`flex-1 max-w-[200px] flex flex-col items-center p-3 rounded-lg border transition-all duration-150 text-center ${
                      pickHighlightClass(homePicked, homeSaved)
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
              {isSubmitting ? 'Saving picks...' : sheetFullySaved ? (
                // Fact, not action — the sheet on screen IS what the server holds.
                <>
                  <Check size={18} /> Picks Saved ({savedCount} of {games.length})
                </>
              ) : (
                <>
                  <Save size={18} /> {hasUnsavedEdits ? 'Save Edited Picks' : 'Submit Weekly Picks'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
