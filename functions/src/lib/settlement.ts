import { HttpsError } from "firebase-functions/v2/https";
import { isVoidedPool } from "./autoScoreDecisions";
import { SETTLED, FOLLOW_UP_CLAIM_MS, type PoolSettlement } from "../shared/settlement";

/**
 * Pure decisions for `settlePool` (PLAN-SPLIT-POT-SETTLEMENT §2.2) and the
 * terminal-pool guard every NFL play path shares (§2.3). No Firestore here, so
 * every branch is unit-tested in `__tests__/settlement.test.ts`.
 */

export interface SettleablePool {
  status?: unknown;
  closedVia?: unknown;
  finalizedAt?: unknown;
  finalizedVia?: unknown;
  settlement?: Partial<PoolSettlement> | null;
}

export type SettlementPhase =
  | { kind: 'FULL' }
  | { kind: 'FOLLOW_UP'; adminAudit: boolean; email: boolean }
  | { kind: 'REFUSE'; code: 'ALREADY_SETTLED' | 'ALREADY_CLOSED' | 'ALREADY_FINALIZED' };

const present = (v: unknown): boolean => v !== undefined && v !== null;

/**
 * Which part of a settlement may run on this pool, from the pool as read.
 * Precedence matters and is the plan's table, top to bottom (the sim refusal is
 * the callable's, since it needs the doc id): a SETTLED pool is examined before
 * the void test, because a settled pool IS voided (COMPLETED) and still owes its
 * follow-up on a retry.
 */
export function settlementPhase(pool: SettleablePool): SettlementPhase {
  if (pool.closedVia === SETTLED) {
    const s = pool.settlement ?? {};
    const adminAudit = !present(s.adminAuditedAt);
    const email = s.notifyMembers === true && !present(s.emailedAt);
    return adminAudit || email
      ? { kind: 'FOLLOW_UP', adminAudit, email }
      : { kind: 'REFUSE', code: 'ALREADY_SETTLED' };
  }
  if (isVoidedPool(pool) || present(pool.closedVia)) return { kind: 'REFUSE', code: 'ALREADY_CLOSED' };
  if (present(pool.finalizedAt) && pool.finalizedVia !== SETTLED) {
    return { kind: 'REFUSE', code: 'ALREADY_FINALIZED' };
  }
  return { kind: 'FULL' };
}

/**
 * The winners must be EXACTLY the ALIVE entries (D3): no subset, no extras, no
 * duplicates. Returns a refusal code, or null when the sets match.
 */
export function aliveSetMismatch(
  requested: readonly string[],
  aliveIds: readonly string[],
): 'NO_SURVIVORS' | 'WINNERS_MUST_BE_ALIVE_SET' | null {
  if (aliveIds.length === 0) return 'NO_SURVIVORS';
  const req = new Set(requested);
  if (req.size !== requested.length) return 'WINNERS_MUST_BE_ALIVE_SET';
  if (req.size !== aliveIds.length) return 'WINNERS_MUST_BE_ALIVE_SET';
  for (const id of aliveIds) if (!req.has(id)) return 'WINNERS_MUST_BE_ALIVE_SET';
  return null;
}

/** Is this pool over for play purposes? Voided, closed by any route, or finalized. */
export function poolIsOver(pool: SettleablePool | undefined | null): boolean {
  if (!pool) return true;
  return isVoidedPool(pool) || present(pool.closedVia) || present(pool.finalizedAt);
}

/**
 * The guard every NFL play path runs on the pool AS READ INSIDE ITS
 * TRANSACTION: pick submit, proxy pick, rebuy, join. Before this, none of them
 * read `status`, so a cancelled or closed pool with an open week still took a
 * pick (PLAN-SPLIT-POT-SETTLEMENT §1.1).
 */
export function assertPoolAcceptsPlay(pool: SettleablePool | undefined | null): void {
  if (poolIsOver(pool)) {
    throw new HttpsError('failed-precondition', 'POOL_OVER: This pool is over — no more picks, rebuys or new members.');
  }
}

/**
 * May this attempt run a follow-up step? Not once it is done, and not while
 * another attempt holds a live claim on it. Decided INSIDE a transaction by the
 * caller, which then writes the claim.
 */
export function followUpClaimable(
  settlement: Partial<PoolSettlement> | null | undefined,
  step: 'adminAudit' | 'email',
  now: number,
): boolean {
  const s = settlement ?? {};
  const done = step === 'email' ? s.emailedAt : s.adminAuditedAt;
  if (present(done)) return false;
  const claimed = step === 'email' ? s.emailClaimedAt : s.adminAuditClaimedAt;
  return !(typeof claimed === 'number' && now - claimed < FOLLOW_UP_CLAIM_MS);
}

/** Highest key of `scoredWeeks` that is true, or null. */
export function throughWeekOf(scoredWeeks: unknown): number | null {
  if (!scoredWeeks || typeof scoredWeeks !== 'object') return null;
  let max: number | null = null;
  for (const [k, v] of Object.entries(scoredWeeks as Record<string, unknown>)) {
    const n = Number(k);
    if (v && Number.isInteger(n) && (max === null || n > max)) max = n;
  }
  return max;
}

/**
 * The settlement's money fields, copied from what the finalizer just published
 * — never recomputed, so the record cannot disagree with Season Places. Every
 * winner is rank 1, so they share one prize figure; if the published rows
 * disagree (they cannot today) or are missing, the figure is null rather than a
 * guess.
 */
export function settlementMoney(
  pool: { seasonPlaces?: unknown; seasonPrize?: unknown },
  winnerEntryIds: readonly string[],
): { prizePerEntry: number | null; pot: number | null } {
  const snap = pool.seasonPrize as { pot?: unknown } | null | undefined;
  const pot = snap && typeof snap.pot === 'number' ? snap.pot : null;
  const rows = Array.isArray(pool.seasonPlaces) ? pool.seasonPlaces as Array<{ entryId?: unknown; prize?: unknown }> : [];
  const prizes = winnerEntryIds.map(id => rows.find(r => r.entryId === id)?.prize);
  const first = prizes[0];
  const prizePerEntry = pot !== null && typeof first === 'number' && prizes.every(p => p === first) ? first : null;
  return { prizePerEntry, pot };
}

/** Σ `rebuyOwed` over the pool's Member Records — dues the pot does not include. */
export function rebuyDuesOf(members: ReadonlyArray<{ rebuyOwed?: unknown }>): number {
  return members.reduce((n, m) => n + (typeof m.rebuyOwed === 'number' && m.rebuyOwed > 0 ? m.rebuyOwed : 0), 0);
}

/**
 * The once-only mail document id for one member of one settlement.
 *
 * Each part is percent-encoded and the parts are joined with `|`. `encodeURIComponent`
 * ALWAYS escapes `|` (to `%7C`), so a `|` in the output can only be a separator —
 * two different (pool, settlement, member) triples can never produce the same id
 * the way a plain `-` join could when an id itself contains hyphens (sim pools
 * do). qodo #3 on #720. (`~` would NOT do: `encodeURIComponent` leaves it as is —
 * codex caught that in the first version of this comment.) `|` is a legal
 * Firestore document-id character; `/` cannot appear, having been escaped.
 */
export function settlementMailKey(poolId: string, settledAt: unknown, memberUid: string): string {
  return ['pool-settled', poolId, String(settledAt), memberUid].map(encodeURIComponent).join('|');
}
