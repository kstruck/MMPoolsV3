
import { db } from '../firebase';
import { doc, onSnapshot, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { SystemSettings } from '../types';

const SETTINGS_DOC_REF = doc(db, 'system', 'config');

const DEFAULT_SETTINGS: SystemSettings = {
    enableBracketPools: false, // Default to OFF
    maintenanceMode: false,
    currentSeason: 2025,
    propCategories: ['Game', 'Player', 'Offense', 'Defense', 'Yards', 'TD', 'FG', 'Fun']
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
