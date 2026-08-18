// Who may see a piece of help — PLAN-HELP-SYSTEM.md §3 D1 (K9).
//
// EXTRACTED IN T2, NOT REWRITTEN. This rule was private to `registry.ts` while
// the tooltip was the only reader. T2 adds three more readers — route→page
// matching, the "All pages" list, and the lazily loaded admin content — and a
// second copy of "may this reader see it" is exactly the drift this feature
// exists to prevent. One function, one place; `registry.ts` imports it too.

import type { Audience, HelpScope, PoolTypeScope } from './types';
import type { PoolType } from '@shared/poolTypes';

/** Just the two fields visibility turns on. */
export type VisibilityScope = Pick<HelpScope, 'poolType' | 'audience'>;

/**
 * What each viewer may read (K9: one registry, `audience[]`).
 *
 * A commissioner IS a member — they submit picks in their own pool — so
 * commissioner-scoped viewing includes member copy. An admin sees everything.
 * Without this widening, a commissioner reading their own pick sheet would get
 * no help on it, and every member-facing setting would need a duplicate
 * commissioner topic, which is the duplication K9 rejected.
 */
export const AUDIENCE_SEES: Readonly<Record<Audience, readonly Audience[]>> = Object.freeze({
  member: ['member'],
  commissioner: ['member', 'commissioner'],
  admin: ['member', 'commissioner', 'admin'],
});

export function audienceSatisfies(entry: readonly Audience[], viewer: Audience): boolean {
  const visible = AUDIENCE_SEES[viewer];
  return entry.some((a) => visible.includes(a));
}

export function scopeIncludesPoolType(scope: PoolTypeScope, poolType: PoolType | undefined): boolean {
  if (scope === 'all') return true;
  // A viewer with no pool in scope (the wizard picker, site pages) sees only
  // type-agnostic entries; a type-scoped one has no pool to be about.
  if (!poolType) return false;
  return scope.includes(poolType);
}

/** Both halves, which is the only combination any caller wants. */
export function isEntryVisible(
  poolTypes: PoolTypeScope,
  audience: readonly Audience[],
  scope: VisibilityScope,
): boolean {
  return scopeIncludesPoolType(poolTypes, scope.poolType) && audienceSatisfies(audience, scope.audience);
}
