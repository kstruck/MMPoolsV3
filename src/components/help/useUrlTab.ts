// A tab that lives in the URL — PLAN-HELP-SYSTEM.md §6 K13 (T2).
//
// NFL and Bracket already put their tab in `?tab=`; Props, Playoff and the
// Squares manager panel held theirs in `useState`, so a search result or an
// "All pages" entry had nothing to link to and the browser Back button skipped
// the whole surface. K13 adopts the existing convention for those pool
// surfaces (the super-admin sub-tabs stay unlinked — an admin can click the
// tab).
//
// This is a drop-in for `useState<Tab>(fallback)`: same tuple shape, so the
// call sites keep reading `activeTab` and calling `setActiveTab`. No state
// semantics change — the tab was already free to be anything in the list.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * @param param  the query key — `tab` for a surface's own tabs, and `sub` for
 *               the sub-tabs of a tab. The NFL dashboard already deep-links its
 *               commissioner sections as `section=`, so that name stays; the
 *               panel reads either (`useHelpPanel.ts`).
 * @param valid  the values this surface accepts. An unknown or stale value in
 *               the URL falls back rather than rendering an empty screen —
 *               shared links outlive tab renames.
 */
export function useUrlTab<T extends string>(
  param: string,
  valid: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(param) as T | null;
  const active = raw && valid.includes(raw) ? raw : fallback;

  const setActive = useCallback(
    (next: T) => {
      // Built from the CURRENT params, so `?tab=manager&sub=members` and the
      // bracket dashboard's `?action=create` survive a tab click.
      const params = new URLSearchParams(searchParams);
      params.set(param, next);
      // A push, not a replace: making Back work on these tabs is half of why
      // K13 chose the URL (CONTEXT.md "Pool Homepage" — the same reason NFL
      // did it).
      setSearchParams(params);
    },
    [param, searchParams, setSearchParams],
  );

  return [active, setActive];
}
