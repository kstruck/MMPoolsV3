import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, RotateCcw, Shield, ShieldAlert, Heart, CheckCircle2 } from 'lucide-react';
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
import { pickHighlightLabel } from '../../utils/pickHighlight';
import { computeTeamRecords, formatTeamRecord } from '../../utils/nflTeamRecords';
import { GameMeta } from './pickSheet/GameMeta';
import { TeamPickButton } from './pickSheet/TeamPickButton';
import { survivorOutcome, pickOutcomeCardClass, pickOutcomeLabel } from './pickSheet/pickOutcome';
import { StickySaveBar } from './pickSheet/StickySaveBar';
import { useSiteConsensus } from './pickSheet/useSiteConsensus';
import { survivorModeRulesCopy } from '../../utils/survivorRules';
import {
  blockedTeamsFor,
  countTeamUses,
  effectiveMaxTeamUses,
  effectiveTieCountsAs,
  UNLIMITED_TEAM_USES,
} from '@shared/survivorReuse';

interface SurvivorPickEntryProps {
  pool: Pool;
  user: User;
  week: number;
  games: NFLGame[];
  /**
   * The WHOLE season's games, not this week's slate.
   *
   * ⚠️ `games` above is already filtered to the selected week, so computing team
   * records from it yields 0-0 for every team all season long — a plausible
   * value rather than the real record, which is worse than showing nothing.
   * (codex on the pick-sheet overhaul PR.) `computeTeamRecords` folds only FINAL
   * games and scopes to the pool's seasonType, so passing the season is safe.
   */
  seasonGames?: NFLGame[];
  /**
   * WHICH of the viewer's entries this sheet is for (PLAN-MULTI-ENTRY T5/D7).
   * Absent ⇒ 1, which is what every single-entry pool sends and what the
   * server defaults to — so nothing changes for a pool with one entry each.
   */
  entryIndex?: number;
  /**
   * The name to give a NEW entry on its first submit. Ignored by the server for
   * an entry that already exists, so it is only ever the draft's name.
   */
  entryName?: string;
  entry: any; // SurvivorEntry or null
  isWeekLocked: boolean;
}

export const SurvivorPickEntry: React.FC<SurvivorPickEntryProps> = ({
  pool,
  week,
  games,
  seasonGames,
  entryIndex,
  entryName,
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
  const maxTeamUses = effectiveMaxTeamUses(settings);
  const tieCountsAs = effectiveTieCountsAs(settings);

  // The session receipt describes ONE week's submit — reset on week change
  // only, not in the load effect below (which also fires on the post-submit
  // entry refresh and would wipe the fresh receipt). Twin of MarginPickEntry.
  useEffect(() => {
    // ⚠️ THE ENTRY IS PART OF THE RECEIPT'S SCOPE (PLAN-MULTI-ENTRY T5). The
    // receipt says "saved just now" about ONE entry's sheet; carrying it across
    // an entry switch would tell a member their brand-new entry #2 is saved.
    setSubmittedAt(null);
  }, [week, entryIndex]);

  // Load existing pick for this week when entry or week changes
  useEffect(() => {
    if (entry && entry.picks && entry.picks[week]) {
      setSelectedTeam(entry.picks[week]);
    } else {
      setSelectedTeam(null);
    }
    setError(null);
  }, [entry, week]);

  // Teams this member can no longer pick. Advisory only — the callable is the
  // enforcement point — but it must AGREE with it, or the grid disables a pick
  // the server would accept (or offers one it would reject).
  //
  // TRI-MODE, identical to the server guards: at `maxTeamUses` absent or 1 this
  // is today's `usedTeams` Set with the current week excluded, unchanged, so a
  // legacy entry whose ledger diverges from its picks gates exactly as it does
  // now. Only a configured limit counts the picks map, and `0` (unlimited)
  // never disables anything.
  const blockedTeams = useMemo(
    () => (entry ? blockedTeamsFor(entry.picks, entry.usedTeams, week, maxTeamUses) : new Set<string>()),
    [entry, week, maxTeamUses],
  );

  // Records and the crowd split — the two things Kevin's testers asked to see
  // WHILE picking rather than on another screen. Both are derived from data the
  // dashboard already holds or already subscribes to; neither adds a read path.
  const seasonType = poolSeasonType(pool);
  // RECORDS AS OF THE SELECTED WEEK, not as of today.
  //
  // The dashboard lets a member scrub back to a completed week, and folding the
  // whole season in would print each team's WEEK 10 record beside a WEEK 1
  // matchup — the row would describe a game with information nobody had when it
  // was played. A pick sheet's record is the one a team carried INTO the game.
  // (codex round 4 on this PR.)
  //
  // Strictly earlier weeks: a Thursday result does not count toward the record
  // shown on that same week's Sunday rows, which is how a sheet reads.
  const teamRecords = useMemo(
    () => computeTeamRecords((seasonGames ?? games).filter(g => Number(g.week) < week), seasonType),
    [seasonGames, games, seasonType, week],
  );
  const consensus = useSiteConsensus(pool, week);
  // ⚠️ NO RECORD AT ALL until the season's slate has arrived. `formatTeamRecord`
  // turns an absent entry into "0-0", which is the CORRECT answer for a team
  // with no FINAL games — but not while the subscription is still in flight,
  // where it is a plausible value standing in for one we do not have yet.
  // (qodo #6 on this PR.) Once the slate is loaded, 0-0 is a real reading.
  const recordsLoaded = (seasonGames ?? games).length > 0;
  const recordFor = (abbr: string): string | undefined =>
    recordsLoaded ? formatTeamRecord(teamRecords.get(abbr)) : undefined;

  // Inclusive count — the "N/N used" badge, deliberately NOT the eligibility
  // source. Excluding the current week there would under-report the pick the
  // member is looking at.
  const useCounts = useMemo(
    () => (maxTeamUses === 1 ? {} : countTeamUses(entry?.picks)),
    [entry, maxTeamUses],
  );

  // Badge copy for a team. "Used" is the one-use pool's word; once a limit is
  // configured the member needs the count, including for a team they can still
  // pick again.
  const usedBadgeLabel = (team: string): string | null => {
    if (maxTeamUses === 1) return blockedTeams.has(team) ? 'Used' : null;
    const n = useCounts[team] ?? 0;
    if (n === 0) return null;
    return maxTeamUses === UNLIMITED_TEAM_USES ? `Used ${n}×` : `${n}/${maxTeamUses} used`;
  };

  // ⚠️ This copy was WRONG in production before this change: it told members
  // that ties survive in BOTH modes, while the engine has always struck them.
  // Derived from the two settings now — see utils/survivorRules for the four
  // combinations and their test.
  const modeRulesCopy = survivorModeRulesCopy(pickLosersMode, tieCountsAs);

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
    if (blockedTeams.has(teamAbbreviation)) return;

    setSelectedTeam(teamAbbreviation);
  };

  // The pick the SERVER already holds for this week — see MarginPickEntry for
  // the twin of this pattern and the reasoning.
  const savedPick: string | null = entry?.picks?.[week] ?? null;

  const handleSubmit = async () => {
    if (!selectedTeam || isSelectionLocked) return;

    // Re-submitting the already-saved pick is a member double-checking, not an
    // error. The server's usedTeams guard does not exempt the current week's
    // own pick, so the call would come back TEAM_ALREADY_USED and render as a
    // failed save — about a pick that is safely in. Answer locally instead.
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
        // Sent only for an extra entry: `undefined` keeps the payload — and the
        // server's own default — byte-for-byte what a single-entry pool sends.
        ...(entryIndex && entryIndex > 1 ? { entryIndex } : {}),
        ...(entryIndex && entryIndex > 1 && entryName ? { entryName } : {}),
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
          <p className="mt-2 text-muted num">Rebuys used: {(entry?.rebuysUsed ?? 0)} of {maxRebuys}. Available through {rebuyDeadlineWeek >= 1 ? nflWeekLabel(poolSeasonType(pool), rebuyDeadlineWeek) : 'season start'}.</p>
        </>
      ),
      confirmLabel: `Rebuy — $${rebuyCost}`,
    });
    if (!ok) return;

    setIsRebuying(true);
    setError(null);

    try {
      await dbService.executeSurvivorRebuy(pool.id, week, entryIndex);
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

  // ⛔ REMOVED: the "Spreads Not Yet Finalized" gate.
  //
  // Survivor is pick-a-winner. Its scoring never reads `game.spread` under any
  // setting, so this sheet was refusing to render over data it does not use —
  // on every preseason week, because the 2026 preseason feed carries a line on
  // 1 of 49 games. The SERVER stopped doing this in #214 (`8c8e9c5`, an
  // ancestor of the deployed functions build), which scoped SPREADS_NOT_LOCKED
  // to `poolUsesSpreads`; this client copy was the only thing left blocking.
  //
  // Deleted rather than wrapped in `poolUsesSpreads(pool)`: that predicate is
  // `type === 'NFL_PICKEM' && pickMode === 'ATS'`, so on a Survivor pool the
  // branch could never fire, and an unreachable guard reads as a live one.
  // `tests/spread-gate-parity.test.ts` pins that Survivor never uses spreads,
  // so a future spread-consuming Survivor mode fails that test rather than
  // silently inheriting a missing gate.

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
          {nflWeekLabel(poolSeasonType(pool), week)} pick ({selectedTeam}) submitted at {formatTimeWithZone(submittedAt)}. You can change it until the game locks.
        </div>
      )}

      {/* Saved-state banner from the SERVER's entry — the receipt above only
          exists after a submit in this session, so a reload showed nothing and
          left members unsure whether their pick was in. Twin of MarginPickEntry. */}
      {savedPick && !submittedAt && !error && (
        <div role="status" className="bg-gold-400/10 border border-gold-500/40 text-gold-700 dark:text-gold-400 p-4 rounded-lg text-xs font-body font-bold num flex gap-2 items-center">
          <CheckCircle2 size={18} aria-hidden="true" />
          Your {nflWeekLabel(poolSeasonType(pool), week)} pick is saved: {savedPick}.
          {isSelectionLocked ? ' Picks are locked for this week.' : ' You can change it until lock.'}
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
            {modeRulesCopy}
          </p>
        </div>
      </div>

      {/* 3. The week's slate — one screen, CBS-style rows.
          Records, the betting line, kickoff day/time, the TV listing and the
          site-wide split all live ON the row now, because Kevin's testers asked
          to see them while picking rather than on another screen. Every one of
          them is optional and renders only when present. */}
      <div className="space-y-3">
        {games.length === 0 ? (
          <div className="bg-card p-8 border border-line rounded-xl text-center">
            <p className="text-muted font-body font-bold num">No NFL matchups scheduled for {nflWeekLabel(poolSeasonType(pool), week)}.</p>
          </div>
        ) : (
          games.map(game => {
            const locked = isGameLocked(game);
            const isEliminated = entry?.status === 'ELIMINATED';

            const homeAbbrev = game.homeTeam.abbreviation;
            const awayAbbrev = game.awayTeam.abbreviation;
            const split = consensus[game.id];

            // How the SAVED pick turned out, graded the way the scorer grades
            // it. Deliberately the saved pick and not `selectedTeam`: the mark
            // is a statement about what was submitted, and the local selection
            // is only a proposal until it is.
            const outcome = survivorOutcome(game, savedPick ?? undefined, {
              pickLosersMode,
              tieCountsAs,
              // An exempt week could not strike, so it cannot be "wrong".
              exempt: Array.isArray(entry?.exemptWeeks) && entry.exemptWeeks.includes(week),
            });

            return (
              <div
                key={game.id}
                className={`bg-card border rounded-xl p-4 shadow-card space-y-2 transition-all duration-150 ${pickOutcomeCardClass(outcome)}`}
              >
                {/* Text half of the card highlight — see PickemPickEntry. */}
                {outcome && (
                  <span className="sr-only">
                    {`${awayAbbrev} at ${homeAbbrev}: ${pickOutcomeLabel(outcome)}`}
                  </span>
                )}
                <GameMeta game={game} locked={locked && game.status === 'SCHEDULED'} />

                <div className="flex items-stretch gap-3">
                  <TeamPickButton
                    team={game.awayTeam}
                    subtitle={awayAbbrev}
                    record={recordFor(awayAbbrev)}
                    consensusPct={split?.awayPct}
                    selected={selectedTeam === awayAbbrev}
                    saved={savedPick === awayAbbrev}
                    outcome={savedPick === awayAbbrev ? outcome : null}
                    disabled={locked || blockedTeams.has(awayAbbrev) || isEliminated}
                    badge={usedBadgeLabel(awayAbbrev)}
                    title={pickHighlightLabel(selectedTeam === awayAbbrev, savedPick === awayAbbrev) || undefined}
                    onSelect={() => handleTeamSelect(awayAbbrev, game)}
                  />

                  {/* Live score, or plain "AT". The slate is the picking surface
                      now, so this column stays narrow. */}
                  <div className="flex flex-col items-center justify-center min-w-[52px] shrink-0">
                    {game.status === 'FINAL' ? (
                      <>
                        <span className="text-muted text-[9px] font-display font-bold uppercase tracking-[0.08em]">Final</span>
                        <span className="text-sm font-display font-bold text-[color:var(--text)] num">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                      </>
                    ) : game.status === 'IN_PROGRESS' ? (
                      <>
                        <span className="relative flex h-1.5 w-1.5 mb-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brandred-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brandred-600"></span>
                        </span>
                        <span className="text-sm font-display font-bold text-brandred-600 num">
                          {game.scores?.away} - {game.scores?.home}
                        </span>
                        <span className="text-[9px] text-muted num leading-none">{game.clock}</span>
                      </>
                    ) : (
                      <span className="text-faint text-[10px] font-display font-bold tracking-[0.16em]">AT</span>
                    )}
                  </div>

                  <TeamPickButton
                    team={game.homeTeam}
                    subtitle={homeAbbrev}
                    record={recordFor(homeAbbrev)}
                    consensusPct={split?.homePct}
                    selected={selectedTeam === homeAbbrev}
                    saved={savedPick === homeAbbrev}
                    outcome={savedPick === homeAbbrev ? outcome : null}
                    disabled={locked || blockedTeams.has(homeAbbrev) || isEliminated}
                    badge={usedBadgeLabel(homeAbbrev)}
                    title={pickHighlightLabel(selectedTeam === homeAbbrev, savedPick === homeAbbrev) || undefined}
                    onSelect={() => handleTeamSelect(homeAbbrev, game)}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. The save bar, pinned. It used to sit below the whole slate, so
          saving meant scrolling past sixteen matchups — the tester complaint
          this replaces. Greyed until the selection differs from the saved pick. */}
      {games.length > 0 && (
        <StickySaveBar
          dirty={!!selectedTeam && selectedTeam !== savedPick}
          submitting={isSubmitting}
          summary={selectedTeam ? `${nflWeekLabel(poolSeasonType(pool), week)}: ${selectedTeam}` : undefined}
          saveLabel={savedPick ? 'Change Pick' : 'Lock In Pick'}
          savedLabel={savedPick ? `Pick saved: ${savedPick}` : 'No pick yet'}
          blockedReason={
            entry?.status === 'ELIMINATED' ? 'Eliminated — picks are closed'
              : isSelectionLocked ? 'Picks are locked for this week'
                : !selectedTeam ? 'Tap a team to pick'
                  : null
          }
          onSave={handleSubmit}
        />
      )}
    </div>
  );
};
