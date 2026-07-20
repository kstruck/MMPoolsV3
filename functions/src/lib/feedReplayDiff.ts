import type { NFLGame } from "../types";

/**
 * Replay diffing (A5 part 2) — what WOULD change if a stored feed snapshot were
 * re-applied to nfl_games. Pure, so the dry-run report and the live write are
 * derived from the same function and cannot disagree.
 */

export interface ReplayChange {
    gameId: string;
    field: "status" | "score" | "startTime" | "new";
    from: string;
    to: string;
}

export interface ReplayPlan {
    /** Games the snapshot would write. */
    writes: NFLGame[];
    /** Human-readable changes, for the dry-run report and the audit entry. */
    changes: ReplayChange[];
    /** Games present in nfl_games for this slate that the snapshot does NOT contain. */
    orphanGameIds: string[];
}

const scoreOf = (g: { scores?: { home?: number; away?: number } } | undefined) =>
    g?.scores === undefined ? "none" : `${g.scores.away ?? "?"}-${g.scores.home ?? "?"}`;

/**
 * Build the replay plan.
 *
 * TWO THINGS ARE DELIBERATELY PRESERVED FROM THE CURRENT DOC, not taken from the
 * snapshot:
 *
 * 1. `spread.locked` — syncNFLScoresJob already preserves a locked spread on
 *    every write (nflSchedule.ts), because unlocking a spread mid-week would
 *    re-open picks that members already made against that line. A replay that
 *    reset it would silently undo a lock, so replay honours the same rule.
 *
 * 2. Orphans are REPORTED, NEVER DELETED. A game in nfl_games that the snapshot
 *    lacks might be a genuinely new fixture added after the snapshot was taken.
 *    Deleting it would destroy real data to satisfy an older payload; the whole
 *    point of replay is recovery, not truncation.
 */
export function buildReplayPlan(
    snapshotGames: NFLGame[],
    currentById: Map<string, NFLGame>,
): ReplayPlan {
    const changes: ReplayChange[] = [];
    const writes: NFLGame[] = [];

    for (const incoming of snapshotGames) {
        const current = currentById.get(incoming.id);

        // Preserve a locked spread — see (1) above.
        const merged: NFLGame = { ...incoming };
        if (current?.spread?.locked === true) {
            merged.spread = { value: current.spread.value, locked: true };
        }
        writes.push(merged);

        if (!current) {
            changes.push({ gameId: incoming.id, field: "new", from: "(absent)", to: String(incoming.status) });
            continue;
        }
        if (current.status !== incoming.status) {
            changes.push({ gameId: incoming.id, field: "status", from: String(current.status), to: String(incoming.status) });
        }
        const before = scoreOf(current);
        const after = scoreOf(incoming);
        if (before !== after) {
            changes.push({ gameId: incoming.id, field: "score", from: before, to: after });
        }
        if (current.startTime !== incoming.startTime) {
            changes.push({
                gameId: incoming.id, field: "startTime",
                from: new Date(current.startTime).toISOString(),
                to: new Date(incoming.startTime).toISOString(),
            });
        }
    }

    const incomingIds = new Set(snapshotGames.map((g) => g.id));
    const orphanGameIds = [...currentById.keys()].filter((id) => !incomingIds.has(id));

    return { writes, changes, orphanGameIds };
}
