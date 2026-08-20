// Firestore IO for the frozen-spread store (PLAN-NFL-SPREAD-FREEZE Revision 1).
//
// The precedence RULE is pure and lives in `shared/frozenSpread.ts`. This file
// is the read side of it for `functions/`: fetch the frozen records for a set of
// games and hand back games whose `spread` is already resolved, so every
// downstream consumer — the SPREADS_NOT_LOCKED gate, `gradePickemGames`,
// `computeWeekFingerprint`, `evaluateSlate` — keeps reading `game.spread` and
// none of them can individually get the precedence wrong.
//
// ⚠️ RESOLVE AT THE LOAD, NOT AT THE READER. There are four load sites and a
// dozen readers. Resolving once where the slate is fetched is what makes "the
// number a member is shown is the number they are graded on" a property of the
// data flow rather than a rule twelve call sites have to remember.
import type { Firestore } from 'firebase-admin/firestore';
import {
  FROZEN_SPREADS_COLLECTION,
  applyFrozenSpreads,
  isUsableFrozenSpread,
  type FrozenSpread,
} from '../shared/frozenSpread';

export { FROZEN_SPREADS_COLLECTION };
export type { FrozenSpread };

/**
 * `getAll` takes the refs as varargs and the whole set round-trips at once.
 * Every server-side load site is slate-scoped (~16 games), so this never binds;
 * it exists so a caller that hands over a whole season cannot build one
 * enormous request.
 */
const GET_ALL_CHUNK = 300;

/**
 * Frozen records for the given game ids, keyed by game id.
 *
 * Reads by DOCUMENT ID rather than by a slate query on purpose: the caller
 * already holds the exact set of games it cares about, and a `getAll` needs no
 * composite index and cannot return a record for a game outside the set.
 * A malformed record is dropped with a warning rather than returned — see
 * `isUsableFrozenSpread` for why falling back beats failing closed here.
 */
export async function readFrozenSpreadsByGameId(
  db: Firestore,
  gameIds: string[],
): Promise<Record<string, FrozenSpread>> {
  const out: Record<string, FrozenSpread> = {};
  const unique = Array.from(new Set(gameIds.filter((id) => typeof id === 'string' && id.length > 0)));
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += GET_ALL_CHUNK) {
    const refs = unique.slice(i, i + GET_ALL_CHUNK).map((id) => db.collection(FROZEN_SPREADS_COLLECTION).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const rec = { ...(snap.data() as FrozenSpread), gameId: snap.id };
      if (!isUsableFrozenSpread(rec)) {
        console.warn(
          `[frozenSpreads] ${FROZEN_SPREADS_COLLECTION}/${snap.id} has no usable value; falling back to the working line.`,
        );
        continue;
      }
      out[snap.id] = rec;
    }
  }
  return out;
}

/**
 * The one call every load site makes: games in, games with `frozen ?? working`
 * out. Returns new objects; the inputs are untouched (they may still be written
 * back to `nfl_games` by something else).
 */
export async function resolveGameSpreads<G extends { id: string; spread?: unknown }>(
  db: Firestore,
  games: G[],
): Promise<G[]> {
  if (games.length === 0) return games;
  const frozen = await readFrozenSpreadsByGameId(db, games.map((g) => g.id));
  return applyFrozenSpreads(games, frozen);
}
