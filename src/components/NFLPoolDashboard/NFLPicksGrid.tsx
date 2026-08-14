import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Grid3X3 } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import type { PoolPicksReveal } from '../../services/dbService';
import { dbService } from '../../services/dbService';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, gamesForPoolWeek } from '../../utils/nflPending';
import { picksGridCell, majorityFor, type ConsensusSplit } from '../../utils/picksGrid';

/**
 * CURRENT PICKS (Kevin's A2) — the page that did not exist.
 *
 * Kevin hit this in production: a Pick'em pool with the week locked and games
 * played, and NO surface anywhere showed a per-pick ✓/✗ for another player. The
 * Standings tab renders a COUNT ("16 of 16 Picks Set") for Pick'em, and its
 * `pickCell` — the one place a pick is printed — is wired only into the Survivor
 * and Margin columns. This is that missing grid: players down, the week's games
 * across, each cell that player's pick.
 *
 * 🛑 COMMISSIONER-FACING ONLY TODAY, and that is an AUTHORIZATION fact, not a UI
 * choice. `getPoolPicks` (`functions/src/nflPickReveal.ts`) throws
 * permission-denied for anyone who is not the pool's `ownerId`, `managerUid` or
 * SUPER_ADMIN — a boundary drawn deliberately in #414
 * (PLAN-COMMISSIONER-BLIND-PICKS, Q5). Admitting participants means changing
 * `assertPickReader`, which is a plan-gated functions change deploying into a
 * live scorer. The tab gate lives in `NFLPoolDashboard.tsx`; this component
 * renders whatever reveal it is handed and would work unchanged for a member.
 *
 * ⚠️ ADDS NO READ. `reveal` is the poll the dashboard already runs for the
 * standings completeness column, and the Majority row reads the same pool
 * consensus aggregate `PickDistribution` subscribes to. Nothing here can widen
 * what the server discloses — see `utils/picksGrid.ts` for the cell rule.
 *
 * Pick'em only. Survivor and Margin store ONE pick per week keyed by the week
 * number, so they have no games-across axis to lay out, and their single weekly
 * pick is already on the Standings row.
 */

interface NFLPicksGridProps {
  pool: Pool;
  /** Rows from `buildMemberStandings` — the same array Standings and Results get. */
  entries: any[];
  games: NFLGame[];
  /** The pool-wide selected week (the header's `?week=` selector). */
  week: number;
  viewerUid?: string;
  /** `getPoolPicks` for the week ON SCREEN, or null when it has not arrived. */
  reveal: PoolPicksReveal | null;
}

const TH = 'py-3 px-3 font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted';

export const NFLPicksGrid: React.FC<NFLPicksGridProps> = ({ pool, entries, games, week, viewerUid, reveal }) => {
  const navigate = useNavigate();
  const seasonType = poolSeasonType(pool);
  const settings = (pool as { settings?: { confidenceMode?: boolean; pickMode?: string } }).settings || {};

  const [consensus, setConsensus] = useState<Record<string, ConsensusSplit>>({});
  useEffect(() => {
    // Cleared FIRST: `PoolRoute` reuses this component across pool navigation,
    // so without it the previous pool's splits sit under the new pool's Majority
    // row until its first snapshot lands.
    setConsensus({});
    return dbService.subscribeToPoolConsensus(pool.id, setConsensus);
  }, [pool.id]);

  // Columns are the week's slate in kickoff order, so the grid reads left to
  // right in the order the games (and therefore the reveals) happen.
  const weekGames = useMemo(
    () => [...gamesForPoolWeek(games || [], pool as any, week)].sort((a, b) => a.startTime - b.startTime),
    [games, pool, week],
  );

  // Alphabetical, not by rank. A commissioner uses this grid to find one
  // person's row, and a leaderboard order moves that row every time a week is
  // scored. The ranked view is one tab over.
  const rows = useMemo(
    () => [...entries].sort((a, b) => (a.userName || '').localeCompare(b.userName || '')),
    [entries],
  );

  // ⚠️ Only the reveal that matches the week on screen. The dashboard already
  // drops a stale one, and this is the second guard on the same rule: last
  // week's allowlist applied to this week's slate would reveal by coincidence.
  const revealedGameIds = useMemo(
    () => (reveal && reveal.week === week ? new Set(reveal.revealedGameIds) : undefined),
    [reveal, week],
  );
  // The caption explains WHEN "?" clears, and it takes the answer from the
  // server's own `mode` rather than re-deriving it from `settings`. The rule is
  // `confidenceMode || lockMode === 'WEEKLY'` and it is easy to get wrong — a
  // confidence pool reveals weekly while its `lockMode` still reads PER_GAME
  // (functions/src/lib/pickReveal.ts). Unknown until the reveal lands, and the
  // caption then says nothing about timing rather than guessing.
  const revealMode = reveal && reveal.week === week ? reveal.mode : undefined;

  const uidOf = (row: any): string => row?.ownerUid ?? row?.id;
  const countFor = (row: any): number | undefined => {
    const uid = uidOf(row);
    if (uid && uid === viewerUid) return weekGames.filter(g => !!row?.picks?.[g.id]).length;
    return reveal && reveal.week === week ? reveal.counts?.[uid] : undefined;
  };

  const dash = <span className="text-faint">—</span>;

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
      <div className="p-5 border-b border-line flex flex-wrap justify-between items-center gap-3 bg-surface">
        <h3 className="font-display font-bold uppercase text-base tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
          <Grid3X3 size={18} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
          {nflWeekLabel(seasonType, week)} Current Picks
        </h3>
        <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted bg-page border border-line px-3 py-1 rounded-full num">
          {entries.length} Entries
        </span>
      </div>

      <div className="overflow-x-auto">
        {weekGames.length === 0 ? (
          <div className="text-center py-12 text-muted font-body font-bold">
            No NFL matchups scheduled for {nflWeekLabel(seasonType, week)}.
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
                <th className={`${TH} text-center w-20`}>Set</th>
                {weekGames.map(g => (
                  <th key={g.id} className={`${TH} text-center whitespace-nowrap`}>
                    {g.awayTeam.abbreviation}/{g.homeTeam.abbreviation}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {rows.map(row => {
                const uid = uidOf(row);
                const isOwnRow = !!viewerUid && uid === viewerUid;
                const set = countFor(row);
                return (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-[color:var(--page)] ${
                      isOwnRow ? 'bg-brandred-600/[0.07]' : ''
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
                        {isOwnRow && (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-brandred-600 px-2 py-0.5 leading-none font-display font-bold uppercase text-[11px] tracking-[0.08em] text-white">
                            Me
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center text-[12px] num font-bold text-muted">
                      {set === undefined ? dash : `${set}/${weekGames.length}`}
                    </td>
                    {weekGames.map(g => {
                      const cell = picksGridCell({
                        game: g,
                        entry: row,
                        isOwnRow,
                        revealedGameIds,
                        pickMode: settings.pickMode,
                        confidenceMode: !!settings.confidenceMode,
                      });
                      // A PUSH or a VOID earns nothing and is nobody's mistake,
                      // so it stays neutral — colouring it red would call a
                      // refunded pick wrong (`utils/pickemResult.ts`).
                      const tone =
                        cell.kind !== 'PICK' ? 'text-faint'
                        : cell.result === 'W' ? 'text-[#0F7B4A] dark:text-[#5FD6A0]'
                        : cell.result === 'L' ? 'text-brandred-600'
                        : 'text-[color:var(--text)]';
                      return (
                        <td
                          key={g.id}
                          className={`py-3 px-3 text-center text-[12px] font-display font-bold uppercase tracking-[0.08em] num ${tone}`}
                          title={cell.kind === 'HIDDEN' ? 'Not revealed yet' : undefined}
                        >
                          {cell.kind === 'HIDDEN' ? '?' : cell.kind === 'NO_PICK' ? '—' : (
                            <>
                              {cell.team}
                              {cell.confidence !== undefined && (
                                <span className="ml-1 text-muted font-body text-[10px] normal-case">
                                  {cell.confidence}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* MAJORITY — the pool's live split, from the server aggregate.
                  It is a count and never a name, so it is shown at all times
                  (Kevin's Q4 ruling) and does not wait on the reveal. */}
              <tr className="bg-surface border-t-2 border-line">
                <td className="sticky left-0 z-10 bg-surface py-3 px-3 font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">
                  Majority
                </td>
                <td className="py-3 px-3 text-center">{dash}</td>
                {weekGames.map(g => {
                  const m = majorityFor(consensus[g.id], g);
                  return (
                    <td key={g.id} className="py-3 px-3 text-center text-[12px] font-display font-bold uppercase tracking-[0.08em] num text-navy-700 dark:text-gold-400">
                      {m === null ? dash : `${m.team} ${m.pct}%`}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Describes the columns actually on screen — #429's lesson. */}
      <div className="px-5 py-3 border-t border-line bg-surface text-[11px] font-body text-muted">
        Each cell is that player's pick for {nflWeekLabel(seasonType, week)}, green once it won and red
        once it lost — a tie, an exact spread cover or a cancelled game earns nothing and stays neutral.
        <strong> ?</strong> means that pick is not revealed yet
        {revealMode === 'WEEK' ? ' — this pool reveals the whole week at its one deadline'
          : revealMode === 'PER_GAME' ? ' — picks reveal game by game, each at its own lock'
          : ''}
        ; your own row is always your own picks. <strong>—</strong> means the pick IS revealed and that
        player made none. <strong>Set</strong> counts the picks they have saved out of {weekGames.length}{' '}
        this week and is available before anything is revealed. <strong>Majority</strong> is the share of
        this pool on the leading side, from the live pool consensus — an aggregate that never names anyone.
        {settings.confidenceMode && ' The small number beside a pick is its confidence weight.'}
      </div>
    </div>
  );
};
