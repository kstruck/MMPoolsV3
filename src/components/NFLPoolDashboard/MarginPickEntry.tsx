import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Percent, ArrowUpRight, ArrowDownRight, CheckCircle2 } from 'lucide-react';
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
import { marginOutcome, pickOutcomeCardClass, pickOutcomeLabel } from './pickSheet/pickOutcome';
import { StickySaveBar } from './pickSheet/StickySaveBar';
import { useSiteConsensus } from './pickSheet/useSiteConsensus';

interface MarginPickEntryProps {
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
  entry: any; // MarginEntry or null
  isWeekLocked: boolean;
}

export const MarginPickEntry: React.FC<MarginPickEntryProps> = ({
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
  const [error, setError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const toast = useToast();

  const settings = (pool as any).settings || {};

  // The session receipt describes ONE week's submit — reset on week change
  // only. NOT in the load effect below: that also fires when the entry
  // snapshot refreshes right after a successful submit, and would wipe the
  // receipt it just earned. Same shape as PickemPickEntry (codex r1).
  useEffect(() => {
    // ⚠️ THE ENTRY IS PART OF THE RECEIPT'S SCOPE (PLAN-MULTI-ENTRY T5). The
    // receipt says "saved just now" about ONE entry's sheet; carrying it across
    // an entry switch would tell a member their brand-new entry #2 is saved.
    setSubmittedAt(null);
  }, [week, entryIndex]);

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

  // Records and the crowd split — shown ON the row, not on another screen
  // (Kevin's testers, 2026-08-11). Both derive from data already in hand or
  // already subscribed to; neither adds a read path. Twin of SurvivorPickEntry.
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
        ...(entryIndex && entryIndex > 1 ? { entryIndex } : {}),
        // ⚠️ A BLANK NAME IS NOT A NAME, AND `''` AND `'   '` MUST MEAN THE SAME
        // THING (codex r3 on the T5 PR). A whitespace-only string is truthy, so
        // it used to reach the server and come back ENTRY_NAME_EMPTY, while an
        // empty one was dropped and silently took the generated default — two
        // answers to one act. Both now take the default: the switcher PRE-FILLS
        // a name, so clearing it reads as "whatever you suggested", not as a
        // request to be refused.
        // EVERY entry may be named, INCLUDING #1 (Kevin, 2026-08-25). The server
        // never gated this — `nflPools.ts:562` applies a requested name with no
        // index condition — so the `> 1` here was the whole restriction.
        // Still omitted when blank: the switcher pre-fills a name for an extra
        // entry, and for entry #1 an empty field means "use my player name".
        ...(entryName?.trim() ? { entryName: entryName.trim() } : {}),
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

  // ⛔ REMOVED: the "Spreads Not Yet Finalized" gate. Twin of the Survivor
  // sheet's — see the comment there for the full reasoning. Margin scores on
  // the raw margin of victory and never reads `game.spread`, so this gate
  // blocked a pool over data it does not use. The server's equivalent was
  // scoped to `poolUsesSpreads` in #214 and has been deployed that way since.

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

      {/* 3. The week's slate — one screen, CBS-style rows. Twin of
          SurvivorPickEntry; see that file for the tester complaint this answers. */}
      <div className="space-y-3">
        {games.length === 0 ? (
          <div className="bg-card p-8 border border-line rounded-xl text-center">
            <p className="text-muted font-body font-bold num">No NFL matchups scheduled for {nflWeekLabel(poolSeasonType(pool), week)}.</p>
          </div>
        ) : (
          games.map(game => {
            const locked = isGameLocked(game);
            const homeAbbrev = game.homeTeam.abbreviation;
            const awayAbbrev = game.awayTeam.abbreviation;
            const split = consensus[game.id];

            // A Margin week scores as a NUMBER, so "correct" is the sign of the
            // margin `scoreMarginWeek` would record: a win adds to the season
            // total, a loss subtracts. A tie or a cancelled game nets 0 and gets
            // neither mark nor highlight.
            const outcome = marginOutcome(game, savedPick ?? undefined);

            return (
              <div
                key={game.id}
                className={`bg-card border rounded-xl p-4 shadow-card space-y-2 transition duration-150 ${pickOutcomeCardClass(outcome)}`}
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
                    disabled={locked || usedTeams.has(awayAbbrev)}
                    badge={usedTeams.has(awayAbbrev) ? 'Used' : null}
                    title={pickHighlightLabel(selectedTeam === awayAbbrev, savedPick === awayAbbrev) || undefined}
                    onSelect={() => handleTeamSelect(awayAbbrev, game)}
                  />

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
                    disabled={locked || usedTeams.has(homeAbbrev)}
                    badge={usedTeams.has(homeAbbrev) ? 'Used' : null}
                    title={pickHighlightLabel(selectedTeam === homeAbbrev, savedPick === homeAbbrev) || undefined}
                    onSelect={() => handleTeamSelect(homeAbbrev, game)}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. The save bar, pinned — see SurvivorPickEntry for the reasoning. */}
      {games.length > 0 && (
        <StickySaveBar
          dirty={!!selectedTeam && selectedTeam !== savedPick}
          submitting={isSubmitting}
          summary={selectedTeam ? `${nflWeekLabel(poolSeasonType(pool), week)}: ${selectedTeam}` : undefined}
          saveLabel={savedPick ? 'Change Pick' : 'Lock In Pick'}
          savedLabel={savedPick ? `Pick saved: ${savedPick}` : 'No pick yet'}
          blockedReason={
            isSelectionLocked ? 'Picks are locked for this week'
              : !selectedTeam ? 'Tap a team to pick'
                : null
          }
          onSave={handleSubmit}
        />
      )}
    </div>
  );
};
