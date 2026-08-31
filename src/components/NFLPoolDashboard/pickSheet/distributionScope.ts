/**
 * Which aggregate the Pick Distribution card is showing, and where that choice
 * is remembered.
 *
 * 🔨 KEVIN 2026-08-27, the "My Pool | Site" toggle. This lives beside the card
 * rather than inside it because a component file that also exports a type and two
 * helpers loses React Fast Refresh (`react-refresh/only-export-components`) —
 * every edit to the card would then reload the whole page instead of hot-swapping
 * the component.
 *
 * The choice is per BROWSER, not per pool and not per account: it is a viewing
 * preference, it carries nothing about the member, and it is not worth a
 * Firestore write. Every access is wrapped — `localStorage` throws outright in
 * private mode and with site data blocked, and a display preference must never be
 * the thing that white-screens the dashboard.
 */
export type DistributionScope = 'pool' | 'site';

const SCOPE_KEY = 'mmp:pickDistributionScope';

/** The stored scope, defaulting to the pool's own split. Never throws. */
export function readStoredScope(): DistributionScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'site' ? 'site' : 'pool';
  } catch {
    // Storage unavailable. Falling back to the default is not a failure state,
    // so this is silent rather than logged.
    return 'pool';
  }
}

/** Remember the scope for next time. Never throws; a failure just means it is not remembered. */
export function writeStoredScope(scope: DistributionScope): void {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* storage unavailable — the toggle still works for this session */
  }
}
