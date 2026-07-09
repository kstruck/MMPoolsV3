
import { db } from '../firebase';
import { doc, onSnapshot, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { SystemSettings } from '../types';

const SETTINGS_DOC_REF = doc(db, 'system', 'config');

const DEFAULT_SETTINGS: SystemSettings = {
    enableBracketPools: false, // Legacy dead flag; superseded by poolTypeFlags (T5)
    maintenanceMode: false,
    // Fail open: all pool types enabled by default (mirrors prior live posture).
    poolTypeFlags: {
        SQUARES: true, BRACKET: true, NFL_PLAYOFFS: true, PROPS: true,
        NFL_PICKEM: true, NFL_SURVIVOR: true, NFL_MARGIN: true,
    },
    currentSeason: 2026,
    propCategories: ['Game', 'Player', 'Offense', 'Defense', 'Yards', 'TD', 'FG', 'Fun'],
    loyaltyTiers: [
        { id: 'tier_contender', name: 'Contender', minPools: 0, description: 'Accrued based on lifetime pool entries' },
        { id: 'tier_vanguard', name: 'Vanguard Hall', minPools: 6, description: 'Accrued based on lifetime pool entries' }
    ],
    // Auto-close sweep OFF by default; safe posture (the daily job no-ops).
    autoClose: { enabled: false, dryRun: true },
    // Live-score ticker scroll duration (seconds; higher = slower).
    tickerDurationSec: 60,
};

export const settingsService = {
    /**
     * Subscribes to global settings changes.
     * Usage: useEffect(() => settingsService.subscribe(setSettings), []);
     */
    subscribe: (callback: (settings: SystemSettings) => void) => {
        return onSnapshot(SETTINGS_DOC_REF, (snap) => {
            if (snap.exists()) {
                callback(snap.data() as SystemSettings);
            } else {
                // If doc doesn't exist, use defaults (and maybe create it?)
                callback(DEFAULT_SETTINGS);
            }
        });
    },

    /**
     * Fetches settings once.
     */
    get: async (): Promise<SystemSettings> => {
        const snap = await getDoc(SETTINGS_DOC_REF);
        if (snap.exists()) {
            return snap.data() as SystemSettings;
        }
        return DEFAULT_SETTINGS;
    },

    /**
     * Updates settings (SuperAdmin only - secured by Firestore rules).
     */
    update: async (updates: Partial<SystemSettings>) => {
        // Check if exists first, if not create with defaults
        const snap = await getDoc(SETTINGS_DOC_REF);
        if (!snap.exists()) {
            await setDoc(SETTINGS_DOC_REF, { ...DEFAULT_SETTINGS, ...updates });
        } else {
            await updateDoc(SETTINGS_DOC_REF, updates);
        }
    },

    /**
     * Initialize settings doc if missing
     */
    initDefaults: async () => {
        const snap = await getDoc(SETTINGS_DOC_REF);
        if (!snap.exists()) {
            await setDoc(SETTINGS_DOC_REF, DEFAULT_SETTINGS);
        }
    }
};
