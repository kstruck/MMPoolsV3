// Member-facing survivor rules copy, derived from the pool's settings.
//
// It lives here rather than inline in the components because it was WRONG in
// production: `SurvivorPickEntry` told members that a tie survives in BOTH
// modes while the engine has always struck it, and `NFLPoolRules` stated flatly
// that a team can never be picked twice. One derivation, two surfaces, and a
// test per combination — copy that describes the rules is part of the rules.

import { effectiveMaxTeamUses, effectiveTieCountsAs, UNLIMITED_TEAM_USES } from '@shared/survivorReuse';
import type { TieCountsAs } from '@shared/survivorReuse';

/** The pick-entry mode header: what to pick, and what a tie does. */
export function survivorModeRulesCopy(pickLosersMode: boolean, tieCountsAs: TieCountsAs): string {
  if (pickLosersMode) {
    return tieCountsAs === 'WIN'
      ? 'Select a team you expect to LOSE their game this week. If they lose, you survive — a tie counts as a win for them, so it is a strike.'
      : 'Select a team you expect to LOSE their game this week. If they lose, you survive. A tie is a strike.';
  }
  return tieCountsAs === 'WIN'
    ? 'Select a team you expect to WIN their game this week. If they win, you survive — and a tie counts as a win, so you survive that too.'
    : 'Select a team you expect to WIN their game this week. If they win, you survive. A loss or tie is a strike.';
}

/** One line for the rules page: what a tied game does to the picked team. */
export function tieOutcomeRuleCopy(pickLosersMode: boolean, tieCountsAs: TieCountsAs): string {
  if (tieCountsAs === 'WIN') {
    return pickLosersMode
      ? 'A tie counts as a WIN for your team — which is a strike in this pool.'
      : 'A tie counts as a WIN for your team — you survive.';
  }
  return 'A tied game is a strike.';
}

/** One line for the rules page: how many times a team may be picked. */
export function teamReuseRuleCopy(maxTeamUses: number): string {
  if (maxTeamUses === UNLIMITED_TEAM_USES) return 'You can pick the same team as many times as you like.';
  if (maxTeamUses === 1) return 'You cannot select the same team twice in a season.';
  return `You can pick the same team up to ${maxTeamUses} times in a season.`;
}

/**
 * Is the auto-survive exemption on for this pool?
 *
 * THE READ SITE IS THE SCORER, AND IT DEFAULTS TO ON.
 * `functions/src/nflScoringEngine.ts:704` reads
 * `pool.settings.autoSurviveExemptionEnabled ?? true`, and the create wizard
 * writes `true` (`CreateNFLSurvivorPool.tsx:73`). Every survivor pool created
 * before the field existed therefore PLAYS with the exemption on. Reading the
 * absent value as `false` — which `NFLPoolRules.tsx` did — showed those members
 * the opposite of the rule their pool was actually being scored under.
 */
export function autoSurviveExemptionOn(settings: { autoSurviveExemptionEnabled?: unknown } | undefined): boolean {
  return (settings?.autoSurviveExemptionEnabled as boolean | undefined) ?? true;
}

/** One line for the rules page: whether the exemption is on, and what it does. */
export function autoSurviveRuleCopy(settings: { autoSurviveExemptionEnabled?: unknown } | undefined): string {
  return autoSurviveExemptionOn(settings)
    ? 'Enabled (Exempt when 0 eligible teams left)'
    : 'Disabled';
}

/**
 * The buy-back window, in the members' words.
 *
 * THROUGH, NEVER BEFORE. `executeSurvivorRebuyInternal`
 * (`functions/src/nflPools.ts:1074`) refuses only
 * `week > settings.rebuyDeadlineWeek`, so the cutoff week ITSELF still accepts
 * a buy-back. The pick sheet already says "Available through …"
 * (`SurvivorPickEntry.tsx:272`); the rules page said "before", which is one
 * week narrower than the callable, and the join page said "up to season start"
 * on a cutoff below week 1 — a window that reads open and is not.
 *
 * A cutoff below week 1 is past every real week, so no buy-back can ever be
 * taken however many the pool allows. The create wizard's floor is 0
 * (`CreateNFLSurvivorPool.tsx:38`) so it is reachable; the manager form clamps
 * to 1, so it is a create-time value.
 *
 * AN ABSENT CUTOFF IS A THIRD STATE, AND IT IS THE OPPOSITE OF ZERO (codex r1
 * P2). `rebuyDeadlineWeek` is `.optional()` (`shared/schemas/nfl.ts:82`), and
 * `week > undefined` is `false` for every week — so a pool with nothing stored
 * has NO cutoff and buy-backs run all season. Saying "none can be taken" there
 * would be as wrong as the "before" it replaced, in the other direction.
 *
 * `Number()` is used because it reproduces the server's own coercion: the
 * relational operator applies ToNumber to both sides, so `null` and `''`
 * become 0 (a closed window, same as a stored 0) while `undefined` and any
 * non-numeric value become NaN, which no comparison can be true against (an
 * open one).
 */
type RebuyWindow =
  | { kind: 'THROUGH'; week: number }
  /** Nothing stored — the callable's comparison never refuses. */
  | { kind: 'NO_CUTOFF' }
  /** Stored below week 1 — every real week is already past it. */
  | { kind: 'CLOSED' };

function rebuyWindow(rebuyDeadlineWeek: unknown): RebuyWindow {
  const week = Number(rebuyDeadlineWeek);
  if (!Number.isFinite(week)) return { kind: 'NO_CUTOFF' };
  if (week < 1) return { kind: 'CLOSED' };
  return { kind: 'THROUGH', week };
}

/**
 * The callable's own refusal, mirrored — `functions/src/nflPools.ts:1074`.
 *
 * `SurvivorPickEntry` used to read the cutoff as `settings.rebuyDeadlineWeek ?? 4`,
 * a FOURTH meaning for the absent value: it hid the buy-back button from week 5
 * on a pool the server would have accepted all season (codex r2). The gate is
 * the server's; this is the same comparison, and `Number()` reproduces the
 * ToNumber the relational operator applies on both sides.
 */
export function rebuyDeadlinePassed(
  week: number,
  settings: { rebuyDeadlineWeek?: unknown } | undefined,
): boolean {
  return week > Number(settings?.rebuyDeadlineWeek);
}

/** The pick-sheet line: how long buy-backs stay available. */
export function rebuyAvailabilityCopy(
  settings: { rebuyDeadlineWeek?: unknown } | undefined,
  labelForWeek: (week: number) => string,
): string {
  const window = rebuyWindow(settings?.rebuyDeadlineWeek);
  if (window.kind === 'NO_CUTOFF') return 'Available all season — no cutoff week is set.';
  if (window.kind === 'CLOSED') return 'The cutoff week is set before week 1, so none can be taken.';
  return `Available through ${labelForWeek(window.week)}.`;
}

type RebuySettings = {
  maxRebuys?: unknown;
  rebuyDeadlineWeek?: unknown;
  rebuyCost?: unknown;
  entryFee?: unknown;
};

/**
 * What a buy-back actually costs.
 *
 * THE ENTRY FEE IS THE FALLBACK, NOT ZERO (codex r1 P1). `rebuyCost` is
 * `.optional()` (`shared/schemas/nfl.ts:83`) and the callable charges
 * `settings.rebuyCost ?? settings.entryFee ?? 0`
 * (`functions/src/nflPools.ts:1079`). `SurvivorPickEntry.tsx:80` already reads
 * it that way; copy that read `rebuyCost` alone would tell a member with a
 * legacy pool that a charged buy-back is free.
 */
function rebuyCostOf(settings: RebuySettings | undefined): number {
  const cost = Number(settings?.rebuyCost ?? settings?.entryFee ?? 0);
  return Number.isFinite(cost) ? cost : 0;
}

/** The rules-page bullet: how many buy-backs, until when, at what price. */
export function survivorRebuyRuleCopy(
  settings: RebuySettings | undefined,
  labelForWeek: (week: number) => string,
): string {
  const maxRebuys = Number(settings?.maxRebuys ?? 0);
  if (!Number.isFinite(maxRebuys) || maxRebuys <= 0) return 'Disabled in this pool.';
  const cost = rebuyCostOf(settings);
  const window = rebuyWindow(settings?.rebuyDeadlineWeek);
  if (window.kind === 'CLOSED') {
    return `Up to ${maxRebuys} allowed on paper, but the cutoff week is set before week 1, so none can actually be taken.`;
  }
  const when = window.kind === 'NO_CUTOFF'
    ? 'with no cutoff week set, so all season'
    : `through ${labelForWeek(window.week)}`;
  return `Allowed up to ${maxRebuys} rebuys ${when} at a cost of $${cost} per rebuy.`;
}

/** The join-page bullet: the same window, said shorter. */
export function survivorRebuyJoinCopy(
  settings: RebuySettings | undefined,
  labelForWeek: (week: number) => string,
): string {
  const maxRebuys = Number(settings?.maxRebuys ?? 0);
  if (!Number.isFinite(maxRebuys) || maxRebuys <= 0) return 'No rebuys/buy-backs allowed';
  const window = rebuyWindow(settings?.rebuyDeadlineWeek);
  if (window.kind === 'CLOSED') {
    return `${maxRebuys} rebuys on paper, but the cutoff week is before week 1, so none can be taken`;
  }
  return window.kind === 'NO_CUTOFF'
    ? `${maxRebuys} rebuys permitted, with no cutoff week set`
    : `${maxRebuys} rebuys permitted through ${labelForWeek(window.week)}`;
}

/** Convenience for components holding a raw settings blob. */
export function survivorRuleCopy(settings: { pickLosersMode?: boolean; tieCountsAs?: unknown; maxTeamUses?: unknown; autoSurviveExemptionEnabled?: unknown } | undefined) {
  const pickLosersMode = settings?.pickLosersMode ?? false;
  const tieCountsAs = effectiveTieCountsAs(settings);
  const maxTeamUses = effectiveMaxTeamUses(settings);
  return {
    mode: survivorModeRulesCopy(pickLosersMode, tieCountsAs),
    tie: tieOutcomeRuleCopy(pickLosersMode, tieCountsAs),
    reuse: teamReuseRuleCopy(maxTeamUses),
    autoSurvive: autoSurviveRuleCopy(settings),
  };
}
