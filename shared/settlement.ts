// Pool SETTLEMENT — a Survivor pool ended early because its remaining players
// agreed to split the pot (PLAN-SPLIT-POT-SETTLEMENT, Kevin 2026-10-08).
//
// Pure and dependency-free so both roots import the SAME shape: the server
// writes `pool.settlement` (functions/src/poolSettlement.ts), the dashboard
// banner and the standings read it. `pool.settlement` is server-owned in
// firestore.rules, and it is the ONLY thing the member-facing "the pot was
// split" claim is rendered from — never `closedVia`.
//
// The platform moves no money. `prizePerEntry` / `pot` are copied from the
// Season Places the finalizer published in the same settlement, so they are a
// printed record of what the commissioner settles, not an instruction.

/** `closedVia` value a settlement writes. Distinct from `ADMIN_CLOSE`. */
export const SETTLED = 'SETTLED' as const;

export interface PoolSettlement {
  kind: 'SPLIT';
  /** The ALIVE entries at settlement — the co-champions, all rank 1. */
  entryIds: string[];
  /** Display names, aligned with `entryIds` (entry name when set, else owner name). */
  winnerNames: string[];
  settledAt: number;
  settledBy: string;
  note: string | null;
  /** Highest scored week at settlement; null when no week was ever scored. */
  throughWeek: number | null;
  notifyMembers: boolean;
  /** Each winner's prize from the published Season Places; null when unpriced. */
  prizePerEntry: number | null;
  /** The frozen season pot; null when unpriced. */
  pot: number | null;
  /** Rebuy dues owed across the pool — NOT included in `pot` (review r1 #1). */
  rebuyDuesExcluded: number;
  /** Follow-up completion stamps (crash recovery). */
  adminAuditedAt?: number;
  emailedAt?: number;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
