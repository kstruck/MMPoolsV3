// The hand-authored help content, assembled — PLAN-HELP-SYSTEM.md §3 D1.
//
// One import for `registry.ts` and one for `pages.ts`, so a new content file
// (T3, T9–T14) is added in exactly one place.

import { WIZARD_PLACEMENTS, WIZARD_TOPICS } from './wizard-shared';
import type { HelpPlacement, HelpTopic } from '../types';

export { WIZARD_PAGES } from './wizard-pages';

export const TOPICS: readonly HelpTopic[] = [...WIZARD_TOPICS];

export const PLACEMENTS: readonly HelpPlacement[] = [...WIZARD_PLACEMENTS];
