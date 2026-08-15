import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Heart, ShieldAlert } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { RankChip } from '../ui';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, gamesForPoolWeek } from '../../utils/nflPending';
import { effectiveWeeklyTiebreaker, tiebreakerAsksForPrediction, tiebreakerCopy } from '@shared/nflTiebreaker';
import type { PoolPicksReveal } from '../../services/dbService';
import { EntryWeekPicks } from './EntryWeekPicks';

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
  /**
   * The week's `getPoolPicks` response (item 9). Clicking a row opens that
   * entry's picks for the selected week, rendered by `EntryWeekPicks` through
   * the SAME cell rules the Current Picks grid uses — nothing here decides what
   * is revealed; the server did. Optional so callers without a reveal (or a
   * pool that never fetched one) still render the table.
   */
  reveal?: PoolPicksReveal | null;
  /** The viewer's own entry has loaded — the own-row reveal bypass. */
  ownEntryLoaded?: boolean;
}

export const NFLStandings: React.FC<NFLStandingsProps> = ({
  pool,
  entries,
  games,
  week,
  viewerUid,
  pickCounts,
  reveal,
  ownEntryLoaded = false,
}) => {
  const navigate = useNavigate();
  const type = pool.type;
  // Item 9: which ROW (entry id, never uid — PLAN-MULTI-ENTRY §0b) is expanded.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // PoolRoute reuses this component across pools and entry ids repeat across
  // pools (today they ARE uids), so an open row would follow the viewer to the
  // next pool and show stale picks until the new snapshot lands (codex r3).
  useEffect(() => { setOpenRowId(null); }, [pool.id, week]);

  // SEASON ONLY. #422 put a Season/Week toggle here; Kevin's 2026-08-13 ruling
  // moves the weekly view to its own Results page, so this table is the season
  // standings again and nothing else.
  //
  // ⚠️ The week-ranking machinery was NOT deleted, it was RELOCATED — the
  // competition-ranking rule (ties share a place), the null-is-not-zero rule,
  // and the unscored-sorts-last rule all now live in `utils/nflResults.ts`,
  // unit-tested, and drive the Results tab's Weekly view. Everything #422
  // learned is still on screen; it is one tab over.

  // The MNF Score column is the tiebreaker PREDICTION, so it has no meaning on a
  // pool whose rule is NONE. Hiding it is not cosmetic: a prediction stored
  // before the commissioner switched to NONE keeps rendering, and the standings
  // would print a tiebreaker figure for a pool whose rules page says it has
  // none — the display contradicting the rules. Nothing is deleted, so a switch
  // back before anyone submits loses no data. (codex R8.1.)
  const tiebreakerRule = effectiveWeeklyTiebreaker((pool as { settings?: { weeklyTiebreaker?: unknown } }).settings);
  const showTiebreakerColumn = tiebreakerAsksForPrediction(tiebreakerRule);
  // Item 10 (Kevin, 2026-08-14): "MNF Score" was opaque to a passive
  // participant — it is the member's tiebreaker PREDICTION, not a score. The
  // header now says what it is and the hover carries the pool's own rule
  // sentence (tiebreakerCopy — one definition shared with the sheet and the
  // rules page, so the column cannot describe a rule the pool is not playing).
  const tiebreakerHint = tiebreakerCopy(tiebreakerRule)?.hint;

  // This week's slate — the denominator for the Pick'em completeness column, and
  // the key set a pick'em entry's picks are stored under.
  const weekGames = useMemo(() => gamesForPoolWeek(games || [], pool as any, week), [games, pool, week]);
  const weekGameIds = useMemo(() => weekGames.map(g => g.id), [weekGames]);
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
  }, [entries, type]);

  // An unscored member has no rank to show. They sort last (see `rank` above), so
  // the scored rows still read 1..N by index; giving the unscored row the next
  // number would assert a placing its own score cells say is unknown. (codex.)
  const renderRankBadge = (index: number, entry: any) => {
    if (entry?.unscored) return <span className="text-faint">—</span>;
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
                    {showTiebreakerColumn && <th className={`${TH} text-center`} title={tiebreakerHint}>Tiebreaker Guess<span className="sr-only"> — {tiebreakerHint}</span></th>}
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

                const isOpen = openRowId === entry.id;
                return (
                  <React.Fragment key={entry.id}>
                  <tr
                    onClick={e => { if ((e.target as HTMLElement).closest('button,a')) return; setOpenRowId(prev => (prev === entry.id ? null : entry.id)); }}
                    tabIndex={0}
                    role="button"
                    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenRowId(prev => (prev === entry.id ? null : entry.id)); } }}
                    aria-expanded={isOpen}
                    title={isOpen ? 'Hide picks' : `Show ${nflWeekLabel(poolSeasonType(pool), week)} picks`}
                    className={`cursor-pointer transition-colors hover:bg-[color:var(--page)] ${
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
                            : pickCounts?.[entry.id] !== undefined
                              ? `${pickCounts[entry.id]} of ${weekGameIds.length} Picks Set`
                              : faint(marker())}
                        </td>
                        {showTiebreakerColumn && (
                          <td className="py-4 px-6 text-center text-[13px] num font-bold text-muted">
                            {entry.weeklyTiebreakers?.[week] ? `${entry.weeklyTiebreakers[week]} pts` : '—'}
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
                  {isOpen && (
                    <tr className="bg-surface">
                      <td colSpan={99} className="py-3 px-6">
                        <EntryWeekPicks
                          pool={pool}
                          row={entry}
                          weekGames={weekGames}
                          week={week}
                          reveal={reveal}
                          isOwnRow={isMyEntry && ownEntryLoaded}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
