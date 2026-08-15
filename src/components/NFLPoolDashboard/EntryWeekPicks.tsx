import React from 'react';
import type { NFLGame } from '../../types';
import type { PoolPicksReveal } from '../../services/dbService';
import { picksGridCell, weeklyPickCell } from '../../utils/picksGrid';
import { nflWeekLabel } from '../../utils/nflWeekLabel';
import { poolSeasonType } from '../../utils/nflPending';

/**
 * One entry's picks for ONE week, as a compact strip — the thing that opens
 * when a row on Standings or Results is clicked (item 9, Kevin 2026-08-14:
 * "clicking Ron Johnson's Points should show his week-2 picks").
 *
 * 🛑 It renders EXACTLY what the Current Picks grid renders for that row and
 * week, through the same two cell rules (`picksGridCell` / `weeklyPickCell`),
 * from the same data (`row.picks` as grafted by `buildMemberStandings` from
 * `getPoolPicks`, and the reveal's own allowlist). Nothing here re-derives a
 * lock: no `startTime <`, no `lockBufferMinutes`, no `serverNow` — the
 * `nfl-surface-invariants` guard is extended to this file. An unrevealed pick
 * is the same honest `?` the grid shows; a revealed no-pick is `—`.
 *
 * Row identity is `row.id`, per PLAN-MULTI-ENTRY §0b; `ownerUid` only decides
 * "is this me".
 */
export const EntryWeekPicks: React.FC<{
  pool: any;
  row: any;
  weekGames: NFLGame[];
  week: number;
  reveal: PoolPicksReveal | null | undefined;
  /** The viewer's own row AND their own entry has loaded — the reveal bypass. */
  isOwnRow: boolean;
}> = ({ pool, row, weekGames, week, reveal, isOwnRow }) => {
  const settings = pool?.settings ?? {};
  const seasonType = poolSeasonType(pool);
  const wk = reveal && reveal.week === week ? reveal : undefined;

  if (pool?.type !== 'NFL_PICKEM') {
    const cell = weeklyPickCell({ week, entry: row, isOwnRow, reveal: wk });
    return (
      <div className="flex items-center gap-3 text-[13px] font-body">
        <span className="font-display font-bold uppercase text-[11px] tracking-[0.08em] text-muted">
          {nflWeekLabel(seasonType, week)} pick
        </span>
        <span className={cell.kind === 'PICK' ? 'font-display font-bold text-[color:var(--text)]' : 'text-faint'}
              title={cell.kind === 'HIDDEN' ? 'Not revealed yet' : undefined}>
          {cell.kind === 'HIDDEN' ? '?' : cell.kind === 'NO_PICK' ? '—' : cell.team}
        </span>
      </div>
    );
  }

  const revealedGameIds = wk ? new Set(wk.revealedGameIds) : undefined;
  const games = [...weekGames].sort((a, b) => a.startTime - b.startTime);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px] font-body">
      {games.length === 0 && <span className="text-faint">No games this week.</span>}
      {games.map(g => {
        const cell = picksGridCell({
          game: g,
          entry: row,
          isOwnRow,
          revealedGameIds,
          pickMode: settings.pickMode,
          confidenceMode: !!settings.confidenceMode,
        });
        const tone =
          cell.kind !== 'PICK' ? 'text-faint'
          : cell.result === 'W' ? 'text-[#0F7B4A] dark:text-[#5FD6A0]'
          : cell.result === 'L' ? 'text-brandred-600'
          : 'text-[color:var(--text)]';
        return (
          <span key={g.id} className="inline-flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-faint num">{g.awayTeam.abbreviation}/{g.homeTeam.abbreviation}</span>
            <span className={`font-display font-bold ${tone}`} title={cell.kind === 'HIDDEN' ? 'Not revealed yet' : undefined}>
              {cell.kind === 'HIDDEN' ? '?' : cell.kind === 'NO_PICK' ? '—' : cell.team}
              {cell.kind === 'PICK' && cell.confidence !== undefined && (
                <span className="ml-0.5 text-[10px] text-muted num">{cell.confidence}</span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
};
