import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, CalendarRange, Trophy } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { RankChip } from '../ui';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, gamesForPoolWeek, poolSeasonWeeks } from '../../utils/nflPending';
import {
  rankByWeek,
  rankBySeason,
  weeklyMaxPoints,
  weekValueFor,
  scoredWeekCount,
  type ResultsRow,
} from '../../utils/nflResults';

/**
 * The league Results pages (Kevin, 2026-08-13, from an office-pool reference
 * site): Weekly Results, Season Summary, Margin Summary, Margin Standings.
 *
 * 🛑 EVERY NUMBER ON THIS SCREEN IS ALREADY-PUBLISHED, ALREADY-SCORED DATA.
 * The source is the member-readable standings projection the dashboard already
 * subscribes to — `weeklyPoints`, `weeklyResults` summaries, `weeklyScores`,
 * `seasonTotal`, written by `scoreNFLWeek` alone. This component adds no read,
 * no callable, and no write; it re-presents rows the Standings tab is rendering
 * one tab over. Nothing here can move a score.
 *
 * ⚠️ NO PICK CONTENT APPEARS ON THIS SCREEN, deliberately. A results table is
 * outcomes, not selections, so the reveal boundary is not this component's to
 * reason about — it never holds a pick to leak. The one page in Kevin's set
 * that DOES show picks (the Current Picks grid) is not here: `getPoolPicks`
 * admits only a commissioner or SUPER_ADMIN today, so a member-facing pick grid
 * needs an authorization decision, which is plan-gated. See the PR body.
 *
 * Survivor is excluded — a survivor week has no score to tabulate, only
 * survived/eliminated, which the Standings tab already reports.
 */

interface NFLResultsProps {
  pool: Pool;
  /** Rows from `buildMemberStandings` — the same array the Standings tab gets. */
  entries: any[];
  games: NFLGame[];
  /** The pool-wide selected week (the header's `?week=` selector). */
  week: number;
  viewerUid?: string;
}

type PickemView = 'WEEKLY' | 'SEASON';
type MarginView = 'WEEKLY' | 'SUMMARY' | 'STANDINGS';

const TH = 'py-3 px-4 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted';
const TD = 'py-3 px-4 text-[13px] num';

export const NFLResults: React.FC<NFLResultsProps> = ({ pool, entries, games, week, viewerUid }) => {
  const navigate = useNavigate();
  const type = pool.type;
  const isMargin = type === 'NFL_MARGIN';
  const seasonType = poolSeasonType(pool);
  const settings = (pool as { settings?: { confidenceMode?: boolean } }).settings || {};

  // Sub-view, reset per pool for the same reason the Standings toggle resets:
  // PoolRoute reuses this component across pool navigation, so a view chosen in
  // one pool would otherwise leak into the next one.
  const [view, setView] = useState<PickemView | MarginView>('WEEKLY');
  useEffect(() => { setView('WEEKLY'); }, [pool.id]);

  const weeks = useMemo(() => poolSeasonWeeks(games, pool), [games, pool]);
  const weekGameCount = useMemo(
    () => gamesForPoolWeek(games || [], pool as any, week).length,
    [games, pool, week],
  );
  const maxPoints = weeklyMaxPoints(weekGameCount, !!settings.confidenceMode);

  const rows = entries as ResultsRow[];
  const weekly = useMemo(() => rankByWeek(rows, week, isMargin), [rows, week, isMargin]);
  const season = useMemo(() => rankBySeason(rows, isMargin), [rows, isMargin]);

  const dash = <span className="text-faint">—</span>;
  const placeCell = (place: number | null) =>
    place === null ? dash : <RankChip rank={place} />;

  const playerCell = (row: ResultsRow) => (
    <span className="font-display font-bold text-[color:var(--text)] text-sm">
      <button
        onClick={() => row.ownerUid && navigate(`/profile/${row.ownerUid}`)}
        className="hover:text-gold-700 dark:hover:text-gold-400 hover:underline underline-offset-2 transition-colors text-left"
        title="View player profile"
      >
        {row.userName}
      </button>
      {!!viewerUid && (row.ownerUid ?? row.id) === viewerUid && (
        <span className="ml-1.5 inline-flex items-center rounded-full bg-brandred-600 px-2 py-0.5 leading-none font-display font-bold uppercase text-[11px] tracking-[0.08em] text-white">
          Me
        </span>
      )}
    </span>
  );

  const rowClass = (row: ResultsRow) =>
    `transition-colors hover:bg-[color:var(--page)] ${
      !!viewerUid && (row.ownerUid ?? row.id) === viewerUid ? 'bg-brandred-600/[0.07]' : ''
    }`;

  const views: Array<{ key: PickemView | MarginView; label: string; icon: React.ReactNode }> = isMargin
    ? [
        { key: 'WEEKLY', label: nflWeekLabel(seasonType, week), icon: <CalendarRange size={13} /> },
        { key: 'SUMMARY', label: 'Margin Summary', icon: <BarChart3 size={13} /> },
        { key: 'STANDINGS', label: 'Margin Standings', icon: <Trophy size={13} /> },
      ]
    : [
        { key: 'WEEKLY', label: `${nflWeekLabel(seasonType, week)} Results`, icon: <CalendarRange size={13} /> },
        { key: 'SEASON', label: 'Season Summary', icon: <BarChart3 size={13} /> },
      ];

  const empty = (text: string) => (
    <div className="text-center py-12 text-muted font-body font-bold">{text}</div>
  );

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
      <div className="p-5 border-b border-line flex flex-wrap justify-between items-center gap-3 bg-surface">
        <div role="group" aria-label="Results view" className="flex rounded-full border border-line overflow-hidden">
          {views.map(v => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1.5 font-display font-bold uppercase text-[11px] tracking-[0.08em] transition-colors flex items-center gap-1.5 ${
                view === v.key
                  ? 'bg-navy-700 text-white dark:bg-gold-500 dark:text-navy-900'
                  : 'bg-page text-muted hover:text-[color:var(--text)]'
              }`}
            >
              {v.icon}{v.label}
            </button>
          ))}
        </div>
        <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted bg-page border border-line px-3 py-1 rounded-full num">
          {entries.length} Entries
        </span>
      </div>

      <div className="overflow-x-auto">
        {entries.length === 0 ? (
          empty('No entries have registered in this pool yet.')
        ) : view === 'WEEKLY' ? (
          /* ── Weekly Results (Kevin A3) ─────────────────────────────────────
             Place / Player / Points / Max / Correct / Incorrect for one week.
             Pick'em reads the week's `weeklyResults` summary; Margin has no
             correct/incorrect to report, so its weekly view is the net margin
             the Standings Week toggle used to show — relocated here, per
             Kevin's ruling that Standings goes back to season-only. */
          <table className="w-full text-left border-collapse font-body">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className={`${TH} w-16`}>Place</th>
                <th className={TH}>Player</th>
                {isMargin ? (
                  <th className={`${TH} text-right w-28`}>Margin</th>
                ) : (
                  <>
                    <th className={`${TH} text-right w-24`}>Points</th>
                    <th className={`${TH} text-right w-24`}>Max</th>
                    <th className={`${TH} text-right w-24`}>Correct</th>
                    <th className={`${TH} text-right w-28`}>Incorrect</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {weekly.map(({ row, place, value }) => {
                const wr = row.weeklyResults?.[week];
                // `total` is the count of the player's picks the scorer could
                // GRADE this week, not the slate size (nflPools.ts) — so
                // incorrect is "wrong so far", and it is unknowable rather than
                // zero until the scorer has published the week.
                const correct = wr?.correct;
                const total = wr?.total;
                const incorrect =
                  typeof correct === 'number' && typeof total === 'number' ? total - correct : null;
                return (
                  <tr key={row.id} className={rowClass(row)}>
                    <td className={`${TD} font-bold`}>{placeCell(place)}</td>
                    <td className="py-3 px-4">{playerCell(row)}</td>
                    {isMargin ? (
                      <td className={`${TD} text-right font-display font-bold text-navy-700 dark:text-gold-400`}>
                        {value === null ? dash : value > 0 ? `+${value}` : value}
                      </td>
                    ) : (
                      <>
                        <td className={`${TD} text-right font-display font-bold text-[color:var(--text)]`}>
                          {value === null ? dash : value}
                        </td>
                        <td className={`${TD} text-right text-muted`}>{maxPoints || dash}</td>
                        <td className={`${TD} text-right text-muted font-bold`}>
                          {typeof correct === 'number' ? correct : dash}
                        </td>
                        <td className={`${TD} text-right text-muted font-bold`}>
                          {incorrect === null ? dash : incorrect}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : view === 'STANDINGS' ? (
          /* ── Margin Standings (Kevin A5) ───────────────────────────────────
             Rank / Player / Total Margin Points / Weeks.
             ⚠️ The reference site's fifth column, "Tiebreaker Total", has NO
             counterpart here: a Margin pool asks for no tiebreaker prediction
             at all (`weeklyTiebreakers` is a Pick'em field). The column is
             omitted rather than filled with a plausible-looking number — see
             the PR body, this is a named gap for Kevin, not an oversight. */
          <table className="w-full text-left border-collapse font-body">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className={`${TH} w-16`}>Rank</th>
                <th className={TH}>Player</th>
                <th className={`${TH} text-right w-40`}>Total Margin Points</th>
                <th className={`${TH} text-right w-24`}>Weeks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {season.map(({ row, place, value }) => (
                <tr key={row.id} className={rowClass(row)}>
                  <td className={`${TD} font-bold`}>{placeCell(place)}</td>
                  <td className="py-3 px-4">{playerCell(row)}</td>
                  <td className={`${TD} text-right font-display font-bold text-[color:var(--text)]`}>
                    {value === null ? dash : value > 0 ? `+${value}` : value}
                  </td>
                  <td className={`${TD} text-right text-muted`}>
                    {row.unscored ? dash : scoredWeekCount(row, weeks, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : weeks.length === 0 ? (
          empty('The season schedule has not loaded yet.')
        ) : (
          /* ── Season Summary (A6) / Margin Summary (A4) ─────────────────────
             Players × weeks, plus a Total column. Same grid for both pool
             types; only the cell source differs (`weeklyPoints` vs
             `weeklyScores`) and Margin signs its positives. Ordered by the
             season total so the grid and the standings agree on who leads.
             Week columns come from the SCHEDULE (`poolSeasonWeeks`), never a
             hardcoded 18 — a preseason pool has four. */
          <table className="w-full text-left border-collapse font-body">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className={`sticky left-0 z-10 bg-card ${TH}`}>Player</th>
                {weeks.map(w => (
                  <th key={w} className={`${TH} text-right w-14`}>{w}</th>
                ))}
                <th className={`${TH} text-right w-24`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {season.map(({ row, value }) => (
                <tr key={row.id} className={rowClass(row)}>
                  <td className="sticky left-0 z-10 bg-card py-3 px-4">{playerCell(row)}</td>
                  {weeks.map(w => {
                    const v = weekValueFor(row, w, isMargin);
                    return (
                      <td key={w} className={`${TD} text-right text-muted`}>
                        {v === null ? dash : isMargin && v > 0 ? `+${v}` : v}
                      </td>
                    );
                  })}
                  <td className={`${TD} text-right font-display font-bold text-[color:var(--text)]`}>
                    {value === null ? dash : isMargin && value > 0 ? `+${value}` : value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-5 py-3 border-t border-line bg-surface text-[11px] font-body text-muted">
        {isMargin
          ? 'Scored weeks only. A week with no number has not been scored yet — it is not a zero.'
          : `Max is the most points anyone could score in ${nflWeekLabel(seasonType, week)} (${
              settings.confidenceMode ? 'every confidence weight correct' : 'every pick correct'
            }). Correct and Incorrect count picks the scorer has graded so far.`}
      </div>
    </div>
  );
};
