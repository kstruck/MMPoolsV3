import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Heart, ShieldAlert } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { RankChip } from '../ui';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, gamesForPoolWeek } from '../../utils/nflPending';
import { effectiveWeeklyTiebreaker, tiebreakerAsksForPrediction } from '@shared/nflTiebreaker';

interface NFLStandingsProps {
  pool: Pool;
  entries: any[];
  games: NFLGame[];
  week: number;
  /** Signed-in viewer, so their own row can show their own picks and be badged. */
  viewerUid?: string;
  /**
   * uid → games picked this week, from `getPoolPicks`. Commissioner surfaces
   * only, and it carries NO pick content — it is what the Pick'em column needs
   * to say "4 of 16 Picks Set" before anything is revealed
   * (PLAN-COMMISSIONER-BLIND-PICKS D1). Absent for ordinary members, whose
   * column falls back to the Hidden / No selection marker.
   */
  pickCounts?: Record<string, number>;
}

export const NFLStandings: React.FC<NFLStandingsProps> = ({
  pool,
  entries,
  games,
  week,
  viewerUid,
  pickCounts
}) => {
  const navigate = useNavigate();
  const type = pool.type;

  // SEASON vs WEEK view (Kevin, 2026-08-13: a pool paying weekly needs the
  // week's own ranking on screen, not just the season's). WEEK ranks by this
  // week's points alone. Survivor is excluded — a survivor week has no score
  // to rank, only survived/eliminated, which the season view already shows.
  //
  // Pure display: `weeklyPoints` (Pick'em) and `weeklyScores` (Margin) are
  // already published into the member-readable standings rows by
  // buildStandingsRows on every scoring pass — including provisional mid-day
  // passes, so this view moves DURING Sunday. No new data is read.
  const [standingsView, setStandingsView] = useState<'SEASON' | 'WEEK'>('SEASON');
  const weekRanked = standingsView === 'WEEK' && type !== 'NFL_SURVIVOR';
  // This week's number for one entry, or null before the scorer first writes
  // it. Null is "not scored yet", NOT zero — a real 0 (every pick wrong, or a
  // Margin net of 0) must rank above nothing-yet, not tie with it.
  const weekValue = (entry: any): number | null => {
    const v = type === 'NFL_MARGIN' ? entry.weeklyScores?.[week] : entry.weeklyPoints?.[week];
    return typeof v === 'number' ? v : null;
  };

  // The MNF Score column is the tiebreaker PREDICTION, so it has no meaning on a
  // pool whose rule is NONE. Hiding it is not cosmetic: a prediction stored
  // before the commissioner switched to NONE keeps rendering, and the standings
  // would print a tiebreaker figure for a pool whose rules page says it has
  // none — the display contradicting the rules. Nothing is deleted, so a switch
  // back before anyone submits loses no data. (codex R8.1.)
  const showTiebreakerColumn = tiebreakerAsksForPrediction(
    effectiveWeeklyTiebreaker((pool as { settings?: { weeklyTiebreaker?: unknown } }).settings),
  );

  // This week's slate — the denominator for the Pick'em completeness column, and
  // the key set a pick'em entry's picks are stored under.
  const weekGameIds = useMemo(
    () => gamesForPoolWeek(games || [], pool as any, week).map(g => g.id),
    [games, pool, week],
  );
  const ownWeekPickCount = (entry: any): number =>
    weekGameIds.filter(id => !!entry?.picks?.[id]).length;

  // Rank and sort entries based on pool type rulesets
  const sortedEntries = useMemo(() => {
    if (!entries || entries.length === 0) return [];

    // Members with no scored row sort LAST, whatever the pool type, and never
    // mix into the ranked field. Their score fields are absent, and every
    // comparator below coalesces absent to 0 — so a member who joined after the
    // last scoring pass would outrank every Margin player on a negative season
    // total, and would make the Pick'em comparator return NaN. They are not
    // losing to those players; they simply have not been scored yet. (codex.)
    const rank = (list: any[]) => {
      const scored = list.filter(e => !e.unscored);
      const unscored = list.filter(e => e.unscored)
        .sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
      return [...sortByType(scored), ...unscored];
    };

    // WEEK view: this week's value desc; not-yet-scored (null) last, NOT as 0 —
    // on Margin a real week can be negative, so coalescing null to 0 would rank
    // "hasn't played yet" above "played and lost by 3". Name breaks ties for a
    // stable order; the tie itself is real (the MNF prediction that settles it
    // is judged by the scorer, and the recap's winner line reports the result).
    const rankByWeek = (list: any[]) => {
      const played = list.filter(e => !e.unscored && weekValue(e) !== null);
      const rest = list.filter(e => e.unscored || weekValue(e) === null)
        .sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
      played.sort((a, b) => {
        const d = (weekValue(b) as number) - (weekValue(a) as number);
        if (d !== 0) return d;
        return (a.userName || '').localeCompare(b.userName || '');
      });
      return [...played, ...rest];
    };
    if (weekRanked) return rankByWeek([...entries]);

    const sortByType = (copy: any[]) => {

    if (type === 'NFL_PICKEM') {
      // Sort Pick'em: totalScore desc, then correctCount desc (fallback), then name
      return copy.sort((a, b) => {
        if (b.totalScore !== a.totalScore) {
          return b.totalScore - a.totalScore;
        }
        return (a.userName || '').localeCompare(b.userName || '');
      });
    }

    if (type === 'NFL_SURVIVOR') {
      // Sort Survivor: ALIVE first, then lowest strikes, then lowest rebuys, then eliminated week desc
      return copy.sort((a, b) => {
        const aAlive = a.status === 'ALIVE' ? 1 : 0;
        const bAlive = b.status === 'ALIVE' ? 1 : 0;

        if (bAlive !== aAlive) {
          return bAlive - aAlive; // ALIVE first
        }

        // If both ALIVE, sort by strikes used (lower strikes is better)
        if (a.status === 'ALIVE') {
          if (a.strikesUsed !== b.strikesUsed) {
            return a.strikesUsed - b.strikesUsed;
          }
          if (a.rebuysUsed !== b.rebuysUsed) {
            return a.rebuysUsed - b.rebuysUsed;
          }
        } else {
          // If both ELIMINATED, sort by who lasted longest
          const aElimWeek = a.eliminatedWeek ?? 0;
          const bElimWeek = b.eliminatedWeek ?? 0;
          if (bElimWeek !== aElimWeek) {
            return bElimWeek - aElimWeek; // Lasted longer is better
          }
        }

        return (a.userName || '').localeCompare(b.userName || '');
      });
    }

    if (type === 'NFL_MARGIN') {
      // Sort Margin: 5-level tiebreaker cascade
      return copy.sort((a, b) => {
        // 1. Season Total (higher is better)
        const aTotal = a.seasonTotal ?? 0;
        const bTotal = b.seasonTotal ?? 0;
        if (bTotal !== aTotal) {
          return bTotal - aTotal;
        }

        // 2. Lowest Negative Burden (lower is better)
        const aBurden = a.negativeBurden ?? 0;
        const bBurden = b.negativeBurden ?? 0;
        if (aBurden !== bBurden) {
          return aBurden - bBurden;
        }

        // 3. Most Positive Weeks (higher is better)
        const aPos = a.positiveWeeks ?? 0;
        const bPos = b.positiveWeeks ?? 0;
        if (bPos !== aPos) {
          return bPos - aPos;
        }

        // 4. Highest Single Week (higher is better)
        const aBest = a.bestWeek ?? 0;
        const bBest = b.bestWeek ?? 0;
        if (bBest !== aBest) {
          return bBest - aBest;
        }

        // 5. Deterministic fallback
        return (a.userName || '').localeCompare(b.userName || '');
      });
    }

      return copy;
    };

    return rank([...entries]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, type, weekRanked, week]);

  // An unscored member has no rank to show. They sort last (see `rank` above), so
  // the scored rows still read 1..N by index; giving the unscored row the next
  // number would assert a placing its own score cells say is unknown. (codex.)
  const renderRankBadge = (index: number, entry: any) => {
    if (entry?.unscored) return <span className="text-faint">—</span>;
    // WEEK view: a member the scorer has not reached this week has no weekly
    // rank — same honesty rule as `unscored`, one week narrower.
    if (weekRanked && weekValue(entry) === null) return <span className="text-faint">—</span>;
    return <RankChip rank={index + 1} />;
  };

  const TH = 'py-4 px-6 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted';

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
      <div className="p-6 border-b border-line flex justify-between items-center bg-surface">
        <h3 className="font-display font-bold uppercase text-base tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
          <Trophy size={18} className="text-gold-600 dark:text-gold-400" /> Standings Leaderboard
        </h3>
        <div className="flex items-center gap-3">
          {/* Hidden for Survivor rather than disabled: N/A is not "off". */}
          {type !== 'NFL_SURVIVOR' && (
            <div role="group" aria-label="Standings view" className="flex rounded-full border border-line overflow-hidden">
              {(['SEASON', 'WEEK'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={standingsView === v}
                  onClick={() => setStandingsView(v)}
                  className={`px-3 py-1 font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-colors ${
                    standingsView === v
                      ? 'bg-navy-700 text-white dark:bg-gold-500 dark:text-navy-900'
                      : 'bg-page text-muted hover:text-[color:var(--text)]'
                  }`}
                >
                  {v === 'SEASON' ? 'Season' : nflWeekLabel(poolSeasonType(pool), week)}
                </button>
              ))}
            </div>
          )}
          <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted bg-page border border-line px-3 py-1 rounded-full num">
            {entries.length} Entries
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        {sortedEntries.length === 0 ? (
          <div className="text-center py-12 text-muted font-body font-bold">
            No entries have registered in this pool yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse font-body text-[15px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className={`sticky left-0 z-10 bg-card py-4 px-3 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted w-16`}>Rank</th>
                <th className={`sticky left-16 z-10 bg-card ${TH}`}>Player</th>

                {/* Custom Pool Columns */}
                {type === 'NFL_PICKEM' && (
                  <>
                    <th className={`${TH} text-center`}>{nflWeekLabel(poolSeasonType(pool), week)} Pick</th>
                    {showTiebreakerColumn && <th className={`${TH} text-center`}>MNF Score</th>}
                    {weekRanked && <th className={`${TH} text-right w-24`}>{nflWeekLabel(poolSeasonType(pool), week)} Points</th>}
                    <th className={`${TH} text-right w-24`}>Total Points</th>
                  </>
                )}

                {type === 'NFL_SURVIVOR' && (
                  <>
                    <th className={`${TH} text-center`}>Status</th>
                    <th className={`${TH} text-center`}>Strikes</th>
                    <th className={`${TH} text-center`}>Rebuys</th>
                    <th className={`${TH} text-center`}>{nflWeekLabel(poolSeasonType(pool), week)} Pick</th>
                  </>
                )}

                {type === 'NFL_MARGIN' && (
                  <>
                    <th className={`${TH} text-center`}>{nflWeekLabel(poolSeasonType(pool), week)} Pick</th>
                    {weekRanked && <th className={`${TH} text-right`}>{nflWeekLabel(poolSeasonType(pool), week)} Margin</th>}
                    <th className={`${TH} text-center`}>Negative Burden</th>
                    <th className={`${TH} text-center`}>Win Wks</th>
                    <th className={`${TH} text-center`}>Best Wk</th>
                    <th className={`${TH} text-right w-28`}>Season Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {sortedEntries.map((entry, index) => {
                const isMyEntry = !!viewerUid && (entry.ownerUid ?? entry.id) === viewerUid;
                const dash = <span className="text-faint">—</span>;
                // THE THREE-STATE PICK CELL (PLAN-COMMISSIONER-BLIND-PICKS §4).
                //
                // A pick appears in `entry.picks` only when the viewer is entitled
                // to it: their own row always, and another member's row only for
                // the games the SERVER revealed (`getPoolPicks`, grafted on by
                // buildMemberStandings). Nobody — commissioner included — holds
                // raw entries any more, so this component never has to decide the
                // boundary; it renders what it was handed.
                //
                // When there is no pick to show, the Member Record's `pickedWeeks`
                // marker says which of two different things happened:
                //   week present  -> they picked, you may not see it  -> "Hidden"
                //   week absent   -> they have not picked            -> "No selection"
                //   field absent  -> record predates the marker      -> "—"
                // The third case is the honest one and must NOT collapse into the
                // second: saying "No selection" about a member whose pick simply
                // is not knowable is the exact lie #413 removed from this cell.
                const marker = (): string => {
                  if (isMyEntry) return 'No selection';   // their own absence is a fact
                  const picked = entry.pickedWeeks;
                  if (!Array.isArray(picked)) return '—';
                  return picked.includes(week) ? 'Hidden' : 'No selection';
                };
                const faint = (text: string) => (
                  <span className="text-faint italic text-[11px] normal-case font-body">{text}</span>
                );
                const pickCell = entry.picks?.[week] || faint(marker());

                return (
                  <tr
                    key={entry.id}
                    className={`transition-colors hover:bg-[color:var(--page)] ${
                      isMyEntry ? 'bg-brandred-600/[0.07] hover:bg-brandred-600/10' : ''
                    }`}
                  >
                    {/* Rank */}
                    <td className="sticky left-0 z-10 bg-card py-4 px-3 font-bold">{renderRankBadge(index, entry)}</td>

                    {/* Username */}
                    <td className="sticky left-16 z-10 bg-card py-4 px-6 font-display font-bold text-[color:var(--text)] text-sm">
                      {/* Player Profile entry point (ADR 0005): every member name links to their public profile */}
                      <button
                        onClick={() => entry.ownerUid && navigate(`/profile/${entry.ownerUid}`)}
                        className="hover:text-gold-700 dark:hover:text-gold-400 hover:underline underline-offset-2 transition-colors text-left"
                        title="View player profile"
                      >
                        {entry.userName}
                      </button>
                      {isMyEntry && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-brandred-600 px-2 py-0.5 leading-none font-display font-bold uppercase text-[11px] tracking-[0.08em] text-white">
                          Me
                        </span>
                      )}
                    </td>

                    {/* Pick'em Columns */}
                    {type === 'NFL_PICKEM' && (
                      <>
                        <td className="py-4 px-6 text-center text-[13px] font-bold text-muted num">
                          {/* Counted over THIS week's slate. It used to be
                              `Object.keys(entry.picks).length`, which counts every
                              pick of the season — a pick'em entry keys picks by
                              gameId, not by week — so week 2 read "32 Picks Set".
                              The commissioner's count comes from getPoolPicks and
                              is a count only: no pick content rides with it. */}
                          {isMyEntry
                            ? `${ownWeekPickCount(entry)} of ${weekGameIds.length} Picks Set`
                            : pickCounts?.[entry.ownerUid ?? entry.id] !== undefined
                              ? `${pickCounts[entry.ownerUid ?? entry.id]} of ${weekGameIds.length} Picks Set`
                              : faint(marker())}
                        </td>
                        {showTiebreakerColumn && (
                          <td className="py-4 px-6 text-center text-[13px] num font-bold text-muted">
                            {entry.weeklyTiebreakers?.[week] ? `${entry.weeklyTiebreakers[week]} pts` : '—'}
                          </td>
                        )}
                        {/* This week's points. `weekValue` distinguishes "not
                            scored yet" (—) from a genuine 0 — a member whose
                            every pick lost still played the week. */}
                        {weekRanked && (
                          <td className="py-4 px-6 text-right font-display font-bold text-navy-700 dark:text-gold-400 text-sm num">
                            {weekValue(entry) === null ? dash : weekValue(entry)}
                          </td>
                        )}
                        <td className="py-4 px-6 text-right font-display font-bold text-[color:var(--text)] text-sm num">
                          {entry.unscored ? dash : entry.totalScore ?? 0}
                        </td>
                      </>
                    )}

                    {/* Survivor Columns */}
                    {type === 'NFL_SURVIVOR' && (
                      <>
                        <td className="py-4 px-6 text-center">
                          {entry.unscored ? dash : entry.status === 'ALIVE' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E4F5EC] border border-[#BEE7D0] font-display font-bold text-[10px] text-[#0F7B4A] uppercase tracking-[0.08em]">
                              <Heart size={8} className="fill-[#0F7B4A]/20" /> Alive
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brandred-600/10 border border-brandred-600/30 font-display font-bold text-[10px] text-brandred-600 uppercase tracking-[0.08em]">
                              <ShieldAlert size={8} /> Eliminated
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-muted">
                          {entry.unscored ? dash : entry.strikesUsed ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-muted">
                          {entry.unscored ? dash : entry.rebuysUsed ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-display font-bold text-navy-700 dark:text-gold-400 uppercase tracking-[0.08em]">
                          {pickCell}
                        </td>
                      </>
                    )}

                    {/* Margin Columns */}
                    {type === 'NFL_MARGIN' && (
                      <>
                        <td className="py-4 px-6 text-center text-[13px] font-display font-bold text-navy-700 dark:text-gold-400 uppercase tracking-[0.08em]">
                          {pickCell}
                        </td>
                        {weekRanked && (
                          <td className="py-4 px-6 text-right font-display font-bold text-navy-700 dark:text-gold-400 text-sm num">
                            {weekValue(entry) === null ? dash : (weekValue(entry) as number) > 0 ? `+${weekValue(entry)}` : weekValue(entry)}
                          </td>
                        )}
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-brandred-600">
                          {entry.unscored ? dash : `-${entry.negativeBurden ?? 0}`}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-muted">
                          {entry.unscored ? dash : entry.positiveWeeks ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-gold-600 dark:text-gold-400">
                          {entry.unscored ? dash : `+${entry.bestWeek ?? 0}`}
                        </td>
                        <td className="py-4 px-6 text-right font-display font-bold text-[color:var(--text)] text-sm num">
                          {entry.unscored ? dash : entry.seasonTotal ?? 0}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
