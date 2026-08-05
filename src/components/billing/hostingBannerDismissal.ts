/**
 * Where the "Hosting Fees Paid" banner's dismissal is remembered.
 *
 * The banner (`BillingGate`'s `status === 'active'` branch) is a cosmetic
 * confirmation for the commissioner, not a fact about the pool — so the
 * dismissal is stored per BROWSER in `localStorage`, keyed by pool id, and not
 * in Firestore. A Firestore field would survive across devices, but it would
 * cost a client write path plus a `firestore.rules` edit, and a rules deploy
 * on the eve of the first live NFL event is a worse trade than a preference
 * that does not follow the commissioner to their phone.
 *
 * Extracted into its own module rather than inlined for the same reason
 * `checkoutButtonState.ts` was: `src/__tests__/billingGate.test.tsx` renders
 * with `renderToStaticMarkup` in plain node — there is no DOM and no click — so
 * the only way to assert this logic is to call it directly.
 *
 * That same absence of a DOM is why every function here tolerates `localStorage`
 * simply not existing. `BillingGate` reads the dismissal in a `useState`
 * initializer, which DOES run under `renderToStaticMarkup`; a bare
 * `localStorage.getItem` there would throw and take all 25 of those tests with
 * it. Storage access is also wrapped in `try`/`catch` because a browser can have
 * `localStorage` present and throwing — Safari private mode on `setItem` when
 * the quota is zero is the usual one.
 */

const KEY_PREFIX = 'mmp:hostingBannerDismissed:';

/** The storage key for one pool. Exported so the test asserts the real string. */
export const hostingBannerDismissKey = (poolId: string): string => `${KEY_PREFIX}${poolId}`;

/**
 * The storage the helpers below use, or `null` when there is none.
 *
 * Read through a function rather than captured once at module load: the module
 * is imported by a suite that has no `window` at all, and a captured `undefined`
 * would then be permanent even in a browser.
 */
const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Accessing `localStorage` itself throws when cookies/site data are blocked.
    return null;
  }
};

/**
 * Has this browser dismissed the banner for this pool?
 *
 * An absent `poolId` answers `false` — the banner keeps showing. The opposite
 * default would hide a money-surface confirmation on a pool we cannot identify,
 * which is a worse failure than showing it one extra time.
 */
export const isHostingBannerDismissed = (poolId?: string): boolean => {
  if (!poolId) return false;
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(hostingBannerDismissKey(poolId)) === '1';
  } catch {
    return false;
  }
};

/**
 * Remember the dismissal. Returns nothing and throws nothing: the caller hides
 * the banner from React state regardless, so a storage failure costs the user
 * the persistence, not the click.
 */
export const dismissHostingBanner = (poolId?: string): void => {
  if (!poolId) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(hostingBannerDismissKey(poolId), '1');
  } catch {
    // Quota or private-mode failure. Nothing useful to do or say here.
  }
};
