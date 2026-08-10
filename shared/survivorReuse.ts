// Survivor team-reuse contract (PLAN-SURVIVOR-PARITY-SCORING Phase 1).
//
// ONE definition of "how many times has this entry used this team", shared by
// every decision point that has an opinion about it: the `submitNFLPicks`
// guard, the `proxyPick` guard, the auto-survive exemption, the client's pick
// grid, and the settings-reduction invariant. Sweep S1 found THREE independent
// reuse guards in the codebase; PR #384 was a bug caused by two of them
// disagreeing about what "used" means. One definition, computed once.
//
// It counts the `picks` MAP rather than the `usedTeams` array because a Set
// cannot represent "picked twice". `usedTeams` stays correct as "the set of
// teams ever picked" and keeps its display role — see the tri-mode note below.
//
// ⚠️ TRI-MODE. This helper is consulted ONLY when `maxTeamUses !== 1`. At the
// default (absent or 1) every guard keeps `usedTeams` as its authority,
// byte-for-byte, so a legacy entry whose seeded `usedTeams` diverges from its
// `picks` behaves exactly as it does today. That guarantee is why the callers
// branch instead of always counting.

/** Tie outcome for the picked team. Absent ⇒ today's rule (see below). */
export type TieCountsAs = 'WIN' | 'LOSS';

/** No setting ⇒ a tie is a strike in BOTH modes, which is what the engine has
 *  always done. See `evaluateSurvivorWeek` for why 'LOSS' is not folded. */
export const DEFAULT_TIE_COUNTS_AS: TieCountsAs = 'LOSS';

/** No setting ⇒ one use per team per season. */
export const DEFAULT_MAX_TEAM_USES = 1;

/** `maxTeamUses: 0` means unlimited — one field instead of a second boolean. */
export const UNLIMITED_TEAM_USES = 0;

/**
 * Highest storable `maxTeamUses`: the NFL week range the submit schema accepts.
 * Above it the limit is indistinguishable from unlimited, which `0` expresses.
 *
 * ⚠️ The CREATE schema and the UPDATE validator must share this. They did not,
 * and codex round 2 found the consequence: create accepted 24, update rejected
 * it, so a pool created at 24 could never save its settings again — the manager
 * UI resends the whole settings object, persisted value included.
 */
export const MAX_TEAM_USES = 23;

// The week range `submitNFLPicksSchema` accepts. A key outside it is not a week
// this pool could ever hold a pick for, so it is skipped rather than counted.
const MIN_WEEK = 1;
const MAX_WEEK = 23;

/** Effective tie outcome for a pool. Anything unrecognised reads as the
 *  default — an Admin-SDK write of garbage must not silently flip semantics. */
export function effectiveTieCountsAs(settings: { tieCountsAs?: unknown } | undefined): TieCountsAs {
  return settings?.tieCountsAs === 'WIN' ? 'WIN' : DEFAULT_TIE_COUNTS_AS;
}

/**
 * Effective reuse limit for a pool: a non-negative integer, `0` = unlimited.
 *
 * Falls back to the default for anything else — absent, negative, fractional,
 * a string. The callable validates on the way in, but rules cannot bind the
 * Admin SDK or the console, and a negative value sliding through as "unlimited"
 * under a `> 0` test is exactly the failure this direction avoids.
 */
export function effectiveMaxTeamUses(settings: { maxTeamUses?: unknown } | undefined): number {
  const n = settings?.maxTeamUses;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_TEAM_USES;
}

/**
 * The picks map keyed by LOGICAL week number.
 *
 * Firestore map keys are strings while `SurvivorEntry.picks` is typed
 * `Record<number, string>`, so both spellings reach this code and `"01"` and
 * `"1"` are the same week. Collapsing to one entry per logical week here is
 * what makes a use count a count of WEEKS rather than of key spellings — two
 * spellings of week 1 must not consume two uses, and `"01"` must be EXCLUDED
 * when the caller excludes week 1 (otherwise re-submitting your own pick eats
 * a use).
 *
 * Grammar, deliberately strict: the key must match `/^\d+$/` and land in the
 * submit schema's 1–23 range. `"1.5"`, `"2junk"`, `" 1"`, `"1e0"` and `"-1"`
 * are skipped rather than coerced. On a collision the canonical `String(week)`
 * spelling wins; otherwise first seen.
 */
export function normalizePickWeeks(
  picks: Record<number | string, unknown> | undefined | null,
): Map<number, string> {
  const byWeek = new Map<number, string>();
  if (!picks || typeof picks !== 'object') return byWeek;

  for (const [key, team] of Object.entries(picks)) {
    if (typeof team !== 'string' || team === '') continue;
    if (!/^\d+$/.test(key)) continue;
    const week = Number(key);
    if (!Number.isInteger(week) || week < MIN_WEEK || week > MAX_WEEK) continue;
    // Canonical spelling wins a collision; otherwise the first one seen holds.
    if (byWeek.has(week) && key !== String(week)) continue;
    byWeek.set(week, team);
  }
  return byWeek;
}

/**
 * How many DISTINCT WEEKS each team appears in, excluding `excludeWeek`.
 *
 * Callers exclude the week being submitted: re-submitting the team you already
 * have saved for this week is a member double-checking their pick, not a reuse
 * (PR #384). Omit `excludeWeek` to count every week — that form is what the
 * `maxTeamUses` reduction invariant validates against.
 */
export function countTeamUses(
  picks: Record<number | string, unknown> | undefined | null,
  excludeWeek?: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [week, team] of normalizePickWeeks(picks)) {
    if (excludeWeek !== undefined && week === excludeWeek) continue;
    counts[team] = (counts[team] ?? 0) + 1;
  }
  return counts;
}

/**
 * Teams this entry may NOT pick in `week` — the whole tri-mode decision in one
 * place, so the client grid and the callable cannot drift apart.
 *
 *  - `maxTeamUses` 1 (or absent, which resolves to 1): today's rule, and
 *    `usedTeams` is the authority. The current week's own saved pick is removed
 *    so it stays re-submittable (PR #384). A legacy entry whose ledger diverges
 *    from its `picks` gates exactly as it does now.
 *  - `0`: unlimited, nothing is ever blocked.
 *  - `N >= 2`: a team is blocked once it holds N uses in weeks OTHER than this
 *    one — same exclusion as the callable, so an already-selected team sitting
 *    at its limit is still re-submittable.
 *
 * Client use is advisory; the callable is the enforcement point (standing
 * invariant: server checks are authoritative, UI checks are UX only).
 */
export function blockedTeamsFor(
  picks: Record<number | string, unknown> | undefined | null,
  usedTeams: readonly string[] | undefined | null,
  week: number,
  maxTeamUses: number,
): Set<string> {
  if (maxTeamUses === DEFAULT_MAX_TEAM_USES) {
    const blocked = new Set<string>(usedTeams ?? []);
    const currentWeekPick = picks?.[week] ?? picks?.[String(week)];
    if (typeof currentWeekPick === 'string') blocked.delete(currentWeekPick);
    return blocked;
  }
  if (maxTeamUses === UNLIMITED_TEAM_USES) return new Set<string>();
  const counts = countTeamUses(picks, week);
  return new Set<string>(
    Object.entries(counts).filter(([, n]) => n >= maxTeamUses).map(([team]) => team),
  );
}
