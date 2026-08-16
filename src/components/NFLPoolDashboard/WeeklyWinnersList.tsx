import React from 'react';
import type { WeeklyRecap } from '../../types';
import { formatSharpScore } from '../../utils/recapHighlight';

/**
 * The Weekly Winners List (PLAN-WEEKLY-PRIZES B2 §3, D6–D8, K10): Place /
 * Player / Score / Tie Break Difference / Prize, straight off the recap the
 * scorer published — the client never re-ranks and never re-prices, because
 * breaking a tie needs the target and pricing needs the frozen pot, and both
 * are the server's (§3a).
 *
 * `weeklyPlaces` ABSENT = not published for this week (an older recap, a void
 * week, a Survivor pool) → render "not published", never a fabricated list.
 * `weeklyPrize` null/absent = no Prize column (SEASON mode, or no pot — D7).
 * `weeklyPlacesError` = the scorer failed CLOSED; say so.
 */
export const WeeklyWinnersList: React.FC<{ recap: WeeklyRecap; poolType: string; poolId?: string }> = ({ recap, poolType }) => {
  const places = recap.weeklyPlaces;
  if (recap.weeklyPlacesError) {
    return (
      <p className="text-[12px] font-body text-brandred-600 dark:text-brandred-500 leading-relaxed">
        The weekly places could not be published for this week ({recap.weeklyPlacesError}). Scores are unaffected; the commissioner can fix the payout places in settings and rescore.
      </p>
    );
  }
  if (!places || places.length === 0) {
    // ABSENT ≠ "nobody placed": an older recap, a void week, or a pool type
    // with no weekly ranking. Say so; never fabricate a list (§3a).
    if (poolType === 'NFL_SURVIVOR') return null;
    return (
      <p className="text-[11px] font-body text-faint leading-relaxed">
        Weekly places were not published for this week (it was scored before the Weekly Winners List existed, or every game was cancelled).
      </p>
    );
  }
  const prize = recap.weeklyPrize ?? null;
  const showPrize = prize !== null;
  const showDiff = places.some(p => typeof p.tiebreakDiff === 'number');
  const awarded = showPrize ? places.reduce((s, p) => s + (p.prize ?? 0), 0) : 0;
  const remainder = showPrize ? Math.max(0, prize.pot - awarded) : 0;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-body">
          <thead>
            <tr className="text-muted uppercase tracking-[0.06em] text-[10px] font-display">
              <th className="text-left py-1 pr-2">Place</th>
              <th className="text-left py-1 pr-2">Player</th>
              <th className="text-right py-1 pr-2">Score</th>
              {showDiff && <th className="text-right py-1 pr-2" title="How far the tiebreaker prediction was from the target">Tie&nbsp;Break&nbsp;Diff</th>}
              {showPrize && <th className="text-right py-1">Prize&nbsp;(est.)</th>}
            </tr>
          </thead>
          <tbody>
            {places.map(p => (
              <tr key={p.entryId} className="border-t border-line">
                <td className="py-1 pr-2 num font-bold">{p.rank}</td>
                <td className="py-1 pr-2 text-[color:var(--text)]">
                  {p.entryName ?? p.userName}
                  {p.entryName && <span className="text-faint"> · {p.userName}</span>}
                </td>
                <td className="py-1 pr-2 text-right num">{formatSharpScore(poolType, p.points)}</td>
                {showDiff && <td className="py-1 pr-2 text-right num text-muted">{typeof p.tiebreakDiff === 'number' ? p.tiebreakDiff : '—'}</td>}
                {showPrize && <td className="py-1 text-right num font-bold text-gold-700 dark:text-gold-400">{p.prize ? `$${p.prize}` : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPrize && (
        <p className="text-[10px] font-body text-faint leading-relaxed">
          Weekly pot ${prize.pot} — {prize.payoutMode === 'HYBRID' ? 'the weekly share of the entry fee' : 'the entry fee'} × {prize.entryCount} {prize.entryCount === 1 ? 'entry' : 'entries'} (every entry, paid or not), after any charity donation, ÷ {prize.weeksInSeason} weeks, whole dollars, frozen when this week was first published.
          Tied places split the prizes for the places they cover evenly.
          {remainder > 0 ? ` $${remainder} rounding remainder is unallocated — commissioner's call.` : ''}
          {' '}Amounts are approximate; your commissioner settles the exact figures — March Melee Pools moves no money. This list is visible to anyone with the pool link.
        </p>
      )}
      {!showPrize && (
        <p className="text-[10px] font-body text-faint leading-relaxed">
          Places and scores only — this pool has no weekly prize pot. This list is visible to anyone with the pool link.
        </p>
      )}
    </div>
  );
};
