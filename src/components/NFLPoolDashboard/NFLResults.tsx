import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, CalendarRange, Trophy } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import { RankChip } from '../ui';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, gamesForPoolWeek, poolSeasonWeeks } from '../../utils/nflPending';
import type { PoolPicksReveal } from '../../services/dbService';
import { EntryWeekPicks } from './EntryWeekPicks';
import {
  rankByWeek,
  rankBySeason,
  weeklyMaxPoints,
  weekValueFor,
  scoredWeekCount,
  unwinnableGameIds,
  resultsFootnote,
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
  /**
   * The week's `getPoolPicks` response (item 9): clicking a row on the WEEKLY
   * table opens that entry's picks for the week via `EntryWeekPicks` — the same
   * cell rules as the Current Picks grid, nothing re-derived here. Optional so
   * the tables render without one.
   */
  reveal?: PoolPicksReveal | null;
  ownEntryLoaded?: boolean;
}

type PickemView = 'WEEKLY' | 'SEASON';
type MarginView = 'WEEKLY' | 'SUMMARY' | 'STANDINGS';

const TH = 'py-3 px-4 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted';
const TD = 'py-3 px-4 text-[13px] num';

export const NFLResults: React.FC<NFLResultsProps> = ({ pool, entries, games, week, viewerUid, reveal, ownEntryLoaded = false }) => {
  const navigate = useNavigate();
  const type = pool.type;
  const isMargin = type === 'NFL_MARGIN';
  const seasonType = poolSeasonType(pool);
  const settings = (pool as { settings?: { confidenceMode?: boolean; pickMode?: string } }).settings || {};

  // Sub-view, reset per pool for the same reason the Standings toggle resets:
  // PoolRoute reuses this component across pool navigation, so a view chosen in
  // one pool would otherwise leak into the next one.
  const [view, setView] = useState<PickemView | MarginView>('WEEKLY');
  // Item 9: the expanded row on the WEEKLY table (entry id — PLAN-MULTI-ENTRY §0b).
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // Reset with the pool (PoolRoute reuses this component; ids repeat across
  // pools) and with the week — the strip is per week (codex r3).
  useEffect(() => { setOpenRowId(null); }, [pool.id, week]);
  const weekGames = useMemo(() => gamesForPoolWeek(games || [], pool as any, week), [games, pool, week]);
  useEffect(() => { setView('WEEKLY'); }, [pool.id]);

  const weeks = useMemo(() => poolSeasonWeeks(games, pool), [games, pool]);
  // Max counts only the games that can still be WON. A cancelled game grades
  // VOID and a tie (or an exact spread cover) grades PUSH — all three earn
  // nothing, so counting them would print a total the scorer can never award.
  // (codex r1.)
  const { weekSlateCount, weekScoreableCount } = useMemo(() => {
    const slate = gamesForPoolWeek(games || [], pool as any, week);
    const unwinnable = unwinnableGameIds(slate, settings.pickMode === 'ATS');
    return {
      weekSlateCount: slate.length,
      weekScoreableCount: slate.length - unwinnable.size,
    };
  }, [games, pool, week, settings.pickMode]);
  const maxPoints = weeklyMaxPoints(weekScoreableCount, !!settings.confidenceMode);
  // ⚠️ A Max of 0 is a FACT on a week whose every game was cancelled or tied —
  // the scorer still publishes that week, and everyone genuinely scored out of
  // nothing. Only an unloaded slate is unknown. `maxPoints || dash` conflated
  // the two and rendered the real zero as "—". (codex r2, on r1's own fix.)
  const maxKnown = weekSlateCount > 0;

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
                    <th className={`${TH} text-right w-28`}>No Points</th>
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
                // 🛑 THIS COLUMN IS "No Points", NOT "Incorrect" — the rename is
                // the fix, not a cosmetic choice.
                //
                // `total - correct` is graded picks that did not WIN. That is
                // the same set as "incorrect" only on a week with no push and
                // no void: a tie, an exact spread cover and a cancelled game all
                // grade to neither W nor L, earn nothing, and land in this
                // subtraction. A player with one correct pick and one push would
                // have been printed as having 1 incorrect.
                //
                // The exact loss count is NOT derivable here. It needs the
                // per-game grade map, and `buildStandingsRows` strips that from
                // the member-readable projection by allowlist — this page is not
                // the place to reintroduce it. An asterisk and a footnote were
                // tried first and rejected: annotating a wrong number leaves it
                // wrong. So the header states what the figure IS, which is true
                // on every week without exception. (codex r1 raised it, r3
                // refused the footnote; Kevin's reference site labels this
                // column "Incorrect" — named in the PR for his ruling.)
                const noPoints =
                  typeof correct === 'number' && typeof total === 'number' ? total - correct : null;
                const isOpen = openRowId === row.id;
                const isMine = !!viewerUid && (row.ownerUid ?? row.id) === viewerUid;
                return (
                  <React.Fragment key={row.id}>
                  <tr
                    className={`cursor-pointer ${rowClass(row)}`}
                    onClick={e => { if ((e.target as HTMLElement).closest('button,a')) return; setOpenRowId(prev => (prev === row.id ? null : row.id)); }}
                    tabIndex={0}
                    role="button"
                    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenRowId(prev => (prev === row.id ? null : row.id)); } }}
                    aria-expanded={isOpen}
                    title={isOpen ? 'Hide picks' : `Show ${nflWeekLabel(seasonType, week)} picks`}
                  >
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
                        <td className={`${TD} text-right text-muted`}>{maxKnown ? maxPoints : dash}</td>
                        <td className={`${TD} text-right text-muted font-bold`}>
                          {typeof correct === 'number' ? correct : dash}
                        </td>
                        <td className={`${TD} text-right text-muted font-bold`}>
                          {noPoints === null ? dash : noPoints}
                        </td>
                      </>
                    )}
                  </tr>
                  {isOpen && (
                    <tr className="bg-surface">
                      <td colSpan={99} className="py-3 px-4">
                        <EntryWeekPicks
                          pool={pool}
                          row={row}
                          weekGames={weekGames}
                          week={week}
                          reveal={reveal}
                          isOwnRow={isMine && ownEntryLoaded}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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
        {/* No `as ResultsView` here, deliberately. The cast was redundant —
            PickemView | MarginView already IS ResultsView — and worse than
            redundant: it would silence the error if a view were added to the
            local union and not to ResultsView, and the new value would fall
            through the switch to the grid caption. That is this PR's own defect
            class for the third time, so the compiler catches it instead.
            Verified by mutation: adding a value to MarginView alone now fails
            with TS2322. (qodo, re-review of this PR.) */}
        {resultsFootnote({
          view,
          isMargin,
          weekLabel: nflWeekLabel(seasonType, week),
          confidenceMode: !!settings.confidenceMode,
        })}
      </div>
    </div>
  );
};
