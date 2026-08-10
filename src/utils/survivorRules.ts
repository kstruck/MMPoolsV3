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

/** Convenience for components holding a raw settings blob. */
export function survivorRuleCopy(settings: { pickLosersMode?: boolean; tieCountsAs?: unknown; maxTeamUses?: unknown } | undefined) {
  const pickLosersMode = settings?.pickLosersMode ?? false;
  const tieCountsAs = effectiveTieCountsAs(settings);
  const maxTeamUses = effectiveMaxTeamUses(settings);
  return {
    mode: survivorModeRulesCopy(pickLosersMode, tieCountsAs),
    tie: tieOutcomeRuleCopy(pickLosersMode, tieCountsAs),
    reuse: teamReuseRuleCopy(maxTeamUses),
  };
}
