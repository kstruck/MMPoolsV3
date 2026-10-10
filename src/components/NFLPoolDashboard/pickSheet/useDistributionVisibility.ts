import { useEffect, useMemo, useState } from 'react';
import { now as serverNow } from '../../../utils/serverClock';
import {
  distributionGameVisible,
  effectivePickDistribution,
  type PickDistributionVisibility,
} from '@shared/pickDistribution';
import type { NFLLockGame, NFLLockPool } from '@shared/nflLockMode';

/**
 * Which games' CROWD SPLIT may be shown under the commissioner's Pick
 * Distribution setting (PLAN-SPLIT-POT-SETTLEMENT Part C), shared by the
 * pool-home card and the Current Picks "Majority" row.
 *
 * ⚠️ THIS CAN ONLY HIDE AN AGGREGATE. It never decides whether an individual's
 * pick is revealed — that stays the server's (`getPoolPicks`), and the grid's
 * source invariant (tests/nfl-surface-invariants.test.ts) keeps any lock clock
 * out of the grid for exactly that reason. The clock lives here instead, and
 * the grid receives only the resulting set of game ids.
 *
 * A one-minute tick, only on AFTER_LOCK, lets a split appear on its own when a
 * lock passes.
 */
export function useDistributionVisibility<G extends NFLLockGame & { id: string }>(
  pool: unknown,
  week: number,
  games: readonly G[],
): { mode: PickDistributionVisibility; visibleIds: ReadonlySet<string> } {
  const lockPool = pool as NFLLockPool & { settings?: { pickDistribution?: unknown } };
  const mode = effectivePickDistribution(lockPool?.settings);
  const [clock, setClock] = useState(() => serverNow());
  useEffect(() => {
    if (mode !== 'AFTER_LOCK') return;
    const id = setInterval(() => setClock(serverNow()), 60_000);
    return () => clearInterval(id);
  }, [mode]);
  const visibleIds = useMemo(
    () => new Set(games.filter(g => distributionGameVisible(lockPool, week, g, games, clock)).map(g => g.id)),
    [games, lockPool, week, clock],
  );
  return { mode, visibleIds };
}
