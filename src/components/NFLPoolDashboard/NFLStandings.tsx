import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Heart, ShieldAlert } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { RankChip } from '../ui';

interface NFLStandingsProps {
  pool: Pool;
  entries: any[];
  games: NFLGame[];
  week: number;
}

export const NFLStandings: React.FC<NFLStandingsProps> = ({
  pool,
  entries,
  week
}) => {
  const navigate = useNavigate();
  const type = pool.type;

  // Rank and sort entries based on pool type rulesets
  const sortedEntries = useMemo(() => {
    if (!entries || entries.length === 0) return [];

    const copy = [...entries];

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
  }, [entries, type]);

  const renderRankBadge = (index: number) => {
    return <RankChip rank={index + 1} />;
  };

  const TH = 'py-4 px-6 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted';

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
      <div className="p-6 border-b border-line flex justify-between items-center bg-surface">
        <h3 className="font-display font-bold uppercase text-base tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
          <Trophy size={18} className="text-gold-600 dark:text-gold-400" /> Standings Leaderboard
        </h3>
        <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted bg-page border border-line px-3 py-1 rounded-full num">
          {entries.length} Entries
        </span>
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
                    <th className={`${TH} text-center`}>Week {week} Pick</th>
                    <th className={`${TH} text-center`}>MNF Score</th>
                    <th className={`${TH} text-right w-24`}>Total Points</th>
                  </>
                )}

                {type === 'NFL_SURVIVOR' && (
                  <>
                    <th className={`${TH} text-center`}>Status</th>
                    <th className={`${TH} text-center`}>Strikes</th>
                    <th className={`${TH} text-center`}>Rebuys</th>
                    <th className={`${TH} text-center`}>Week {week} Pick</th>
                  </>
                )}

                {type === 'NFL_MARGIN' && (
                  <>
                    <th className={`${TH} text-center`}>Week {week} Pick</th>
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
                const isMyEntry = false; // user profile checking is bypassed/not needed for row highlight

                return (
                  <tr
                    key={entry.id}
                    className={`transition-colors hover:bg-[color:var(--page)] ${
                      isMyEntry ? 'bg-brandred-600/[0.07] hover:bg-brandred-600/10' : ''
                    }`}
                  >
                    {/* Rank */}
                    <td className="sticky left-0 z-10 bg-card py-4 px-3 font-bold">{renderRankBadge(index)}</td>

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
                          {Object.keys(entry.picks || {}).length} Picks Set
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] num font-bold text-muted">
                          {entry.weeklyTiebreakers?.[week] ? `${entry.weeklyTiebreakers[week]} pts` : '—'}
                        </td>
                        <td className="py-4 px-6 text-right font-display font-bold text-[color:var(--text)] text-sm num">
                          {entry.totalScore ?? 0}
                        </td>
                      </>
                    )}

                    {/* Survivor Columns */}
                    {type === 'NFL_SURVIVOR' && (
                      <>
                        <td className="py-4 px-6 text-center">
                          {entry.status === 'ALIVE' ? (
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
                          {entry.strikesUsed ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-muted">
                          {entry.rebuysUsed ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-display font-bold text-navy-700 dark:text-gold-400 uppercase tracking-[0.08em]">
                          {entry.picks?.[week] || (
                            <span className="text-faint italic text-[11px] normal-case font-body">No selection</span>
                          )}
                        </td>
                      </>
                    )}

                    {/* Margin Columns */}
                    {type === 'NFL_MARGIN' && (
                      <>
                        <td className="py-4 px-6 text-center text-[13px] font-display font-bold text-navy-700 dark:text-gold-400 uppercase tracking-[0.08em]">
                          {entry.picks?.[week] || (
                            <span className="text-faint italic text-[11px] normal-case font-body">No selection</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-brandred-600">
                          -{entry.negativeBurden ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-muted">
                          {entry.positiveWeeks ?? 0}
                        </td>
                        <td className="py-4 px-6 text-center text-[13px] font-bold num text-gold-600 dark:text-gold-400">
                          +{entry.bestWeek ?? 0}
                        </td>
                        <td className="py-4 px-6 text-right font-display font-bold text-[color:var(--text)] text-sm num">
                          {entry.seasonTotal ?? 0}
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
