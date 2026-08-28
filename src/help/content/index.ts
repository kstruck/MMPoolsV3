// The hand-authored help content, assembled — PLAN-HELP-SYSTEM.md §3 D1.
//
// One import for `registry.ts` and one for `pages.ts`, so a new content file
// (T3, T9–T14) is added in exactly one place.

import { WIZARD_PLACEMENTS, WIZARD_TOPICS } from './wizard-shared';
import { NFL_SHARED_PLACEMENTS, NFL_SHARED_TOPICS } from './nfl-shared';
import { NFL_PICKEM_PLACEMENTS, NFL_PICKEM_TOPICS } from './nfl-pickem';
import { NFL_SURVIVOR_PLACEMENTS, NFL_SURVIVOR_TOPICS } from './nfl-survivor';
import { BRACKET_PLACEMENTS, BRACKET_TOPICS } from './bracket';
import { SQUARES_PROPS_PLACEMENTS, SQUARES_PROPS_TOPICS } from './squares-props';
import { NFL_MARGIN_PLACEMENTS, NFL_MARGIN_TOPICS } from './nfl-margin';
import { MANAGER_FIELD_PLACEMENTS, MANAGER_FIELD_TOPICS } from './manager-fields';
import type { HelpPlacement, HelpTopic } from '../types';

export { WIZARD_PAGES } from './wizard-pages';

export const TOPICS: readonly HelpTopic[] = [
  ...WIZARD_TOPICS,
  ...NFL_SHARED_TOPICS,
  ...NFL_PICKEM_TOPICS,
  ...NFL_SURVIVOR_TOPICS,
  ...BRACKET_TOPICS,
  ...SQUARES_PROPS_TOPICS,
  ...NFL_MARGIN_TOPICS,
  ...MANAGER_FIELD_TOPICS,
];

export const PLACEMENTS: readonly HelpPlacement[] = [
  ...WIZARD_PLACEMENTS,
  ...NFL_SHARED_PLACEMENTS,
  ...NFL_PICKEM_PLACEMENTS,
  ...NFL_SURVIVOR_PLACEMENTS,
  ...BRACKET_PLACEMENTS,
  ...SQUARES_PROPS_PLACEMENTS,
  ...NFL_MARGIN_PLACEMENTS,
  ...MANAGER_FIELD_PLACEMENTS,
];
