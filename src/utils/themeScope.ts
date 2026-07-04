import type { PoolTheme, PoolType } from '../types';

/**
 * Whether a theme should be offered for a given pool type (T13). A theme with
 * no `appliesTo` (or an empty one) is universal — this keeps existing
 * March-Madness-era themes visible everywhere they show today, while new
 * themes can scope themselves to specific pool types.
 */
export function themeAppliesTo(theme: Pick<PoolTheme, 'appliesTo'>, poolType: PoolType): boolean {
  const scope = theme.appliesTo;
  if (!scope || scope.length === 0) return true;
  return scope.includes(poolType);
}

/** Filter a theme list to those offered for `poolType`. */
export function themesForPoolType<T extends Pick<PoolTheme, 'appliesTo'>>(
  themes: T[],
  poolType: PoolType
): T[] {
  return themes.filter((t) => themeAppliesTo(t, poolType));
}
