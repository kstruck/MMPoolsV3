import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';
import { logger } from '../utils/logger';

/**
 * Ensures the signed-in user's SUPER_ADMIN Firestore role is mirrored as a
 * custom auth claim — which is what the Firestore rules actually check
 * (`request.auth.token.role == 'SUPER_ADMIN'`), NOT the users/{uid}.role field.
 *
 * The two drift apart when an admin is promoted by editing the role field
 * directly (rather than via setSuperAdminClaim). The app's client-side gate
 * reads the Firestore role, so such a user reaches the dashboard — but every
 * claim-gated read (admin_audit, admin_stats, billingCharges) then fails with
 * "Missing or insufficient permissions".
 *
 * `syncMyClaims` (already deployed) copies role -> claim; a forced token refresh
 * makes the current session pick it up before any gated subscription runs. Gate
 * the admin UI on the returned `ready` flag so those subscriptions don't start
 * against a stale token (onSnapshot does not retry a permission-denied listen).
 */
export function useEnsureAdminClaims(shouldEnsure: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!shouldEnsure) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const user = auth.currentUser;
        if (user) {
          const token = await user.getIdTokenResult();
          if (token.claims.role !== 'SUPER_ADMIN') {
            await httpsCallable(functions, 'syncMyClaims')();
            await user.getIdToken(true); // refresh so rules see the new claim
          }
        }
      } catch (e) {
        // Don't hard-block the page — let Firestore rules enforce access. A
        // genuine non-admin just keeps seeing permission errors on gated reads.
        logger.error('useEnsureAdminClaims: failed to sync admin claim', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldEnsure]);

  return ready;
}
