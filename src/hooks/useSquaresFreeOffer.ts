import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useFeatureFlags } from './useFeatureFlags';
import { squaresHostingIsFree } from '../utils/squaresFreeOffer';

/**
 * The LIVE half of the homepage free-squares promo (qodo on #792).
 *
 * True only when both live signals agree, and false until both have loaded:
 *   1. `system/config.poolTypeFlags.SQUARES` is not switched off — the
 *      no-deploy off switch; with it off the CTA would land on the
 *      "temporarily unavailable" screen.
 *   2. `settings/billing_config` prices every squares tier at $0 — so the
 *      "$0 to host" claim follows the real price, not a build.
 *
 * Both documents are world-readable (firestore.rules: `system/{docId}` and
 * `settings/{settingId}`), so a signed-out visitor gets an answer too.
 */
export function useSquaresFreeOffer(): boolean {
    const { poolTypeFlags, loading: flagsLoading } = useFeatureFlags();
    const [free, setFree] = useState<boolean | null>(null);

    useEffect(() => {
        const unsub = onSnapshot(
            doc(db, 'settings', 'billing_config'),
            (snap) => setFree(snap.exists() ? squaresHostingIsFree(snap.data()) : false),
            () => setFree(false),
        );
        return unsub;
    }, []);

    return !flagsLoading && poolTypeFlags.SQUARES !== false && free === true;
}
