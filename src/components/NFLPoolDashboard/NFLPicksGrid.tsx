import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Grid3X3 } from 'lucide-react';
import type { Pool, NFLGame } from '../../types';
import type { PoolPicksReveal } from '../../services/dbService';
import { dbService } from '../../services/dbService';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType, gamesForPoolWeek } from '../../utils/nflPending';
import { picksGridCell, majorityFor, type ConsensusSplit } from '../../utils/picksGrid';
import { sortGridRows, type GridSort } from '../../utils/picksGridSort';
import { weekValueFor } from '../../utils/nflResults';
import { GridSortToggle } from './GridSortToggle';

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
  /**
   * Whether the viewer's OWN entry document has arrived.
   *
   * 🛑 NOT the same question as "is this the viewer's row", and conflating them
   * is a real bug (qodo #9). The own row bypasses the reveal guard because the
   * entry document is its source — so before that document lands the bypass is
   * asserting knowledge nobody has. `buildMemberStandings` still emits a row for
   * the viewer in that window, from their Member Record, carrying no `picks` at
   * all: the grid then printed "0/16" and a "—" (made no pick) in every cell of
   * the commissioner's own week. Both are fabricated. Passed explicitly rather
   * than inferred from `row.picks` being absent, because an entry that genuinely
   * has no picks yet is indistinguishable from one that has not loaded.
   */
  ownEntryLoaded: boolean;
}

const TH = 'py-3 px-3 font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted';

export const NFLPicksGrid: React.FC<NFLPicksGridProps> = ({ pool, entries, games, week, viewerUid, reveal, ownEntryLoaded }) => {
  const navigate = useNavigate();
  const seasonType = poolSeasonType(pool);
  const settings = (pool as { settings?: { confidenceMode?: boolean; pickMode?: string } }).settings || {};

  // Stamped with its pool, and checked at RENDER time — the same rule the
  // dashboard applies to the reveal, for the same reason. `PoolRoute` reuses
  // this component across pool navigation, and clearing the state inside the
  // effect is not enough: effects run AFTER the render that changed the pool,
  // so one frame of the new slate would carry the previous pool's Majority
  // percentages — most misleadingly when the two pools share a slate, which two
  // pools on the same week always do. (codex r2.)
  const [consensus, setConsensus] = useState<{ poolId: string; byGame: Record<string, ConsensusSplit> } | null>(null);
  useEffect(
    () => dbService.subscribeToPoolConsensus(pool.id, byGame => setConsensus({ poolId: pool.id, byGame })),
    [pool.id],
  );
  const splits = consensus?.poolId === pool.id ? consensus.byGame : undefined;

  // Columns are the week's slate in kickoff order, so the grid reads left to
  // right in the order the games (and therefore the reveals) happen.
  const weekGames = useMemo(
    () => [...gamesForPoolWeek(games || [], pool as any, week)].sort((a, b) => a.startTime - b.startTime),
    [games, pool, week],
  );

  // Alphabetical by default — a commissioner uses this grid to find one
  // person's row, and a rank order moves that row every time a week is scored.
  // Item 12: a toggle offers this week's score order too (`sortGridRows`,
  // per ROW, unit-tested). Item 11: the score itself is a column — the same
  // projection field the Results tab ranks by, no new read.
  const [sort, setSort] = useState<GridSort>('name');
  const rows = useMemo(() => sortGridRows(entries, sort, week, false), [entries, sort, week]);

  // ⚠️ Only the reveal that matches the week on screen. The dashboard already
  // drops a stale one, and this is the second guard on the same rule: last
  // week's allowlist applied to this week's slate would reveal by coincidence.
  // Resolved ONCE — three separate copies of this test is how one of them ends
  // up not being updated.
  const wk = reveal && reveal.week === week ? reveal : null;
  const revealedGameIds = useMemo(() => (wk ? new Set(wk.revealedGameIds) : undefined), [wk]);
  // The caption explains WHEN "?" clears, and it takes the answer from the
  // server's own `mode` rather than re-deriving it from `settings`. The rule is
  // `confidenceMode || lockMode === 'WEEKLY'` and it is easy to get wrong — a
  // confidence pool reveals weekly while its `lockMode` still reads PER_GAME
  // (functions/src/lib/pickReveal.ts). Unknown until the reveal lands, and the
  // caption then says nothing about timing rather than guessing.
  const revealMode = wk?.mode;

  // ROW IDENTITY IS THE ENTRY (`row.id`), NOT THE PLAYER. `ownerUid` is for
  // exactly two things — "is this me" and the profile link. Every lookup into
  // the reveal (`counts`, `picks`, …) is keyed by `row.id`. Today an NFL entry
  // id IS the uid so the two agree; under PLAN-MULTI-ENTRY §0b they will not,
  // and a uid-keyed lookup would merge one player's entries into one row.
  // A source invariant in tests/nfl-surface-invariants.test.ts forbids the
  // uid-keyed form here.
  // `?? row.id` here is the legacy-row fallback (an entry written before
  // `ownerUid` was stamped) — NOT a key: under multi-entry an extra entry's id
  // never equals a uid, so the fallback can only ever match entry #1. Same
  // shape NFLStandings uses. (qodo on #438.)
  const isMe = (row: any): boolean => !!viewerUid && (row?.ownerUid ?? row?.id) === viewerUid;
  // Their own entry is the source for their own picks, and it is the only one
  // that is right the instant they save — the same rule the Standings
  // completeness column uses. It is authoritative only ONCE IT HAS LOADED; see
  // `ownEntryLoaded`.
  const ownPicksKnown = (row: any): boolean => isMe(row) && ownEntryLoaded;
  const countFor = (row: any): number | undefined => {
    if (ownPicksKnown(row)) return weekGames.filter(g => !!row?.picks?.[g.id]).length;
    // Everyone else, and the viewer before their entry lands: the server's
    // count, which carries no pick content and is available at any time.
    return wk?.counts?.[row?.id];
  };

  const dash = <span className="text-faint">—</span>;

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden shadow-card">
      <div className="p-5 border-b border-line flex flex-wrap justify-between items-center gap-3 bg-surface">
        <h3 className="font-display font-bold uppercase text-base tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
          <Grid3X3 size={18} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
          {nflWeekLabel(seasonType, week)} Current Picks
        </h3>
        <div className="flex items-center gap-2">
          <GridSortToggle value={sort} onChange={setSort} scoreLabel="Week Pts" />
          <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted bg-page border border-line px-3 py-1 rounded-full num">
            {entries.length} Entries
          </span>
        </div>
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
                <th className={`${TH} text-center w-20`} title="This week's points from the scorer — blank until the week is scored">Week Pts</th>
                {weekGames.map(g => (
                  <th key={g.id} className={`${TH} text-center whitespace-nowrap`}>
                    {g.awayTeam.abbreviation}/{g.homeTeam.abbreviation}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--line)]">
              {rows.map(row => {
                // Two different questions, deliberately separate: WHOSE row this
                // is (the badge and the highlight) and whether their picks are
                // KNOWN to this client (the reveal bypass). qodo #9.
                const mine = isMe(row);
                const isOwnRow = ownPicksKnown(row);
                const set = countFor(row);
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
                    {/* "?" and not "—". Inside ONE table the same glyph must not
                        mean two things, and the pick cells already spend "—" on
                        a positive fact ("revealed, and they picked nothing").
                        An unknown count has the same cause as an unknown pick —
                        the reveal has not arrived — so it gets the same "?".
                        (qodo #8 pointed here. Its stated reason, that a dash is
                        a plausible-looking substitute, is REJECTED: "—" is this
                        repo's unavailable marker throughout `NFLStandings` and
                        `NFLResults`, and the plausible-looking substitute would
                        have been "0/16", which is what this deliberately avoids.
                        The overloading within this table is the real defect.) */}
                    <td
                      className="py-3 px-3 text-center text-[12px] num font-bold text-muted"
                      title={set === undefined ? 'Not known yet' : undefined}
                    >
                      {set === undefined ? '?' : `${set}/${weekGames.length}`}
                    </td>
                    {/* Item 11: this week's score, per row. `—` = not scored yet
                        (the repo's unavailable marker), never a 0. */}
                    <td className="py-3 px-3 text-center text-[12px] num font-bold text-[color:var(--text)]">
                      {weekValueFor(row, week, false) ?? <span className="text-faint">—</span>}
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
                  const m = majorityFor(splits?.[g.id], g);
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
        . <strong>—</strong> means the pick IS revealed and that player made none. <strong>Set</strong>{' '}
        counts the picks they have saved out of {weekGames.length} this week and is available before
        anything is revealed; it reads <strong>?</strong> for the same reason a cell does, when the count
        is not known yet. <strong>Majority</strong> is the share of
        this pool on the leading side, from the live pool consensus — an aggregate that never names anyone.
        {settings.confidenceMode && ' The small number beside a pick is its confidence weight.'}
      </div>
    </div>
  );
};
