// Pure sim-namespace helpers — NO firebase imports, so unit tests can import
// them without tripping module-load admin.firestore() calls elsewhere in the
// harness's import graph (billing.ts initializes at module scope; the same
// gotcha the security branch's zodHelpers extraction documents).

export const SIM_PREFIX = 'sim-';

/** Season value for a run's synthetic NFL games. */
export function simSeason(runId: string): string {
    return `${SIM_PREFIX}${runId}`;
}

/** Run-scoped subject uid prefix (`sim-<runId>-`) — cross-run collisions on
 *  publicProfiles/seasonHistory/users state are impossible when every simulated
 *  subject carries the run id (PLAN-NFL-SIM-HARNESS Phase 0.6, Codex R1#6). */
export function simUidPrefix(runId: string): string {
    return `${SIM_PREFIX}${runId}-`;
}
