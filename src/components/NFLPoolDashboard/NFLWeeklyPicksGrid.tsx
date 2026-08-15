import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Grid3X3 } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import type { PoolPicksReveal } from '../../services/dbService';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, poolSeasonWeeks } from '../../utils/nflPending';
import { weeklyPickCell } from '../../utils/picksGrid';

/**
 * CURRENT PICKS for Survivor and Margin — players down, WEEKS across.
 *
 * Pick'em stores a pick per GAME, so its grid (`NFLPicksGrid`) lays the week's
 * slate across. **Survivor and Margin store exactly one pick per week, keyed by
 * the week number** — a single week is one cell, so a per-game axis would be a
 * column of one. Weeks across is also the view those formats actually want:
 * Survivor's whole strategy is which teams you have already burned, and this is
 * the only surface in the app that shows it.
 *
 * 🛑 EVERY COLUMN READS ITS OWN WEEK'S RESPONSE, AND THAT IS A SECURITY
 * PROPERTY, NOT A CACHING DETAIL.
 *
 * For these pool types the pick key is the week number, so the field that
 * admits a cell is **`weekRevealed`** — not `revealedGameIds`, which is the
 * pick'em allowlist. A grid that read one selected week's `weekRevealed` while
 * drawing every column would render week 2's pick on a week where only week 1
 * had locked. Concrete, reproducible, and the reason the dashboard caches whole
 * responses per week rather than a merged allowlist. (codex r2 on the plan.)
 *
 * ⚠️ NO RESULT COLOUR, deliberately (plan D3/K4). A Survivor outcome depends on
 * strikes, exemptions and `tieCountsAs`; a Margin cell on the -14 missed-pick
 * penalty. Neither is derivable from the game alone the way a pick'em win is, so
 * colouring a cell here would state a verdict the scorer never reached. The
 * scored outcome lives one tab over, in Standings and Results.
 */

interface NFLWeeklyPicksGridProps {
  pool: Pool;
  /** Rows from `buildMemberStandings` — the same array Standings and Results get. */
  entries: any[];
  games: NFLGame[];
  /** The pool-wide selected week; the grid shows every week up to it. */
  week: number;
  viewerUid?: string;
  /** `getPoolPicks` per week, for THIS pool. A week absent means "not fetched". */
  revealsByWeek: Record<number, PoolPicksReveal>;
  /** Whether the viewer's own entry document has arrived — see `NFLPicksGrid`. */
  ownEntryLoaded: boolean;
}

const TH = 'py-3 px-3 font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted';

export const NFLWeeklyPicksGrid: React.FC<NFLWeeklyPicksGridProps> = ({
  pool, entries, games, week, viewerUid, revealsByWeek, ownEntryLoaded,
}) => {
  const navigate = useNavigate();
  const seasonType = poolSeasonType(pool);

  // Columns come from the pool's own loaded SLATE, never a hardcoded count — a
  // preseason pool has four weeks and the callable accepts up to 23 (plan K7).
  // Capped at the selected week: a future week has nothing to show and fetching
  // it would be a call per week for guaranteed "?".
  const weeks = useMemo(
    () => poolSeasonWeeks(games, pool).filter(w => w <= week),
    [games, pool, week],
  );

  const rows = useMemo(
    () => [...entries].sort((a, b) => (a.userName || '').localeCompare(b.userName || '')),
    [entries],
  );

  // Row identity is the ENTRY (`row.id`); `ownerUid` only decides "is this me"
  // (PLAN-MULTI-ENTRY §0b — the invariant test forbids a uid-keyed lookup).
  // `?? row.id` = legacy-row fallback for "is this me", not a key (see NFLPicksGrid).
  const isMe = (row: any): boolean => !!viewerUid && (row?.ownerUid ?? row?.id) === viewerUid;
  const ownPicksKnown = (row: any): boolean => isMe(row) && ownEntryLoaded;

  const dash = <span className="text-faint">—</span>;

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
      <div className="p-5 border-b border-line flex flex-wrap justify-between items-center gap-3 bg-surface">
        <h3 className="font-display font-bold uppercase text-base tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
          <Grid3X3 size={18} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
          Current Picks
        </h3>
        <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted bg-page border border-line px-3 py-1 rounded-full num">
          {entries.length} Entries
        </span>
      </div>

      <div className="overflow-x-auto">
        {weeks.length === 0 ? (
          <div className="text-center py-12 text-muted font-body font-bold">
            The season schedule has not loaded yet.
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted font-body font-bold">
            No entries have registered in this pool yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse font-body">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className={`sticky left-0 z-10 bg-card ${TH}`}>Player</th>
                {weeks.map(w => (
                  <th key={w} className={`${TH} text-center whitespace-nowrap`}>
                    {nflWeekLabel(seasonType, w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {rows.map(row => {
                const mine = isMe(row);
                const known = ownPicksKnown(row);
                return (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-[color:var(--page)] ${
                      mine ? 'bg-brandred-600/[0.07]' : ''
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-card py-3 px-3 whitespace-nowrap">
                      <span className="font-display font-bold text-[color:var(--text)] text-sm">
                        <button
                          onClick={() => row.ownerUid && navigate(`/profile/${row.ownerUid}`)}
                          className="hover:text-gold-700 dark:hover:text-gold-400 hover:underline underline-offset-2 transition-colors text-left"
                          title="View player profile"
                        >
                          {row.userName}
                        </button>
                        {mine && (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-brandred-600 px-2 py-0.5 leading-none font-display font-bold uppercase text-[11px] tracking-[0.08em] text-white">
                            Me
                          </span>
                        )}
                      </span>
                    </td>
                    {weeks.map(w => {
                      // 🛑 `revealsByWeek[w]` — THIS column's own response, never
                      // the selected week's. See the header.
                      const cell = weeklyPickCell({
                        week: w,
                        entry: row,
                        isOwnRow: known,
                        reveal: revealsByWeek[w],
                      });
                      return (
                        <td
                          key={w}
                          className={`py-3 px-3 text-center text-[12px] font-display font-bold uppercase tracking-[0.08em] num ${
                            cell.kind === 'PICK' ? 'text-navy-700 dark:text-gold-400' : 'text-faint'
                          }`}
                          title={cell.kind === 'HIDDEN' ? 'Not revealed yet' : undefined}
                        >
                          {cell.kind === 'HIDDEN' ? '?' : cell.kind === 'NO_PICK' ? dash : cell.team}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-5 py-3 border-t border-line bg-surface text-[11px] font-body text-muted">
        Each cell is that player's pick for that week. <strong>?</strong> means the week has not reached
        its deadline yet, so nobody's pick for it is shown — these pools lock a whole week at once, not
        game by game. <strong>—</strong> means the week IS open to view and that player made no pick.
        Your own row is always your own picks. Weeks after the one selected above are not shown, and
        results are not coloured here — a week's outcome depends on strikes, exemptions and penalties
        the scorer applies, so it is reported in Standings and Results rather than guessed at here.
      </div>
    </div>
  );
};
