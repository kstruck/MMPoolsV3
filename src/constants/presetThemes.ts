import type { PoolTheme } from '../types';

/**
 * Default preset themes that can be seeded into Firestore
 * SuperAdmin can activate/deactivate these for pool managers to use
 */
export const PRESET_THEMES: Omit<PoolTheme, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[] = [
    {
        name: 'Classic Dark',
        description: 'The original March Melee look - sleek and modern',
        category: 'classic',
        isActive: true,
        isDefault: true,
        colors: {
            primary: '#6366f1',      // Indigo
            secondary: '#8b5cf6',    // Purple
            background: '#0f172a',   // Slate-900
            surface: '#1e293b',      // Slate-800
            surfaceAlt: '#334155',   // Slate-700
            text: '#f1f5f9',         // Slate-100
            textMuted: '#94a3b8',    // Slate-400
            border: '#334155',       // Slate-700
            success: '#10b981',      // Emerald-500
            warning: '#f59e0b',      // Amber-500
            error: '#ef4444',        // Red-500
        },
        grid: {
            cellBackground: '#1e293b',
            cellBackgroundAlt: '#0f172a',
            cellBorder: '#334155',
            headerBackground: '#0f172a',
            winnerGlow: true,
            winnerGlowColor: '#10b981',
        },
    },
    {
        name: 'Super Bowl Party',
        description: 'Red and gold celebration vibes',
        category: 'sports',
        isActive: true,
        isDefault: false,
        colors: {
            primary: '#dc2626',      // Red-600
            secondary: '#eab308',    // Yellow-500
            background: '#1c1917',   // Stone-900
            surface: '#292524',      // Stone-800
            surfaceAlt: '#44403c',   // Stone-700
            text: '#fafaf9',         // Stone-50
            textMuted: '#a8a29e',    // Stone-400
            border: '#44403c',       // Stone-700
            success: '#22c55e',      // Green-500
            warning: '#eab308',      // Yellow-500
            error: '#ef4444',        // Red-500
        },
        grid: {
            cellBackground: '#292524',
            cellBackgroundAlt: '#1c1917',
            cellBorder: '#57534e',
            headerBackground: '#dc2626',
            winnerGlow: true,
            winnerGlowColor: '#eab308',
        },
    },
    {
        name: 'Tailgate',
        description: 'Orange autumn feel for game day',
        category: 'sports',
        isActive: true,
        isDefault: false,
        colors: {
            primary: '#f97316',      // Orange-500
            secondary: '#f59e0b',    // Amber-500
            background: '#1c1917',   // Stone-900
            surface: '#292524',      // Stone-800
            surfaceAlt: '#44403c',   // Stone-700
            text: '#fafaf9',         // Stone-50
            textMuted: '#a8a29e',    // Stone-400
            border: '#57534e',       // Stone-600
            success: '#22c55e',      // Green-500
            warning: '#f59e0b',      // Amber-500
            error: '#ef4444',        // Red-500
        },
        grid: {
            cellBackground: '#292524',
            cellBackgroundAlt: '#1c1917',
            cellBorder: '#57534e',
            headerBackground: '#f97316',
            winnerGlow: true,
            winnerGlowColor: '#f97316',
        },
    },
    {
        name: 'Sports Bar',
        description: 'Green and wood tones for that pub atmosphere',
        category: 'sports',
        isActive: true,
        isDefault: false,
        colors: {
            primary: '#16a34a',      // Green-600
            secondary: '#22c55e',    // Green-500
            background: '#14532d',   // Green-900
            surface: '#166534',      // Green-800
            surfaceAlt: '#15803d',   // Green-700
            text: '#f0fdf4',         // Green-50
            textMuted: '#86efac',    // Green-300
            border: '#22c55e',       // Green-500
            success: '#22c55e',      // Green-500
            warning: '#fbbf24',      // Amber-400
            error: '#f87171',        // Red-400
        },
        grid: {
            cellBackground: '#166534',
            cellBackgroundAlt: '#14532d',
            cellBorder: '#22c55e',
            headerBackground: '#14532d',
            winnerGlow: true,
            winnerGlowColor: '#86efac',
        },
    },
    {
        name: 'Neon Night',
        description: 'Vibrant pink and purple for night owls',
        category: 'custom',
        isActive: true,
        isDefault: false,
        colors: {
            primary: '#ec4899',      // Pink-500
            secondary: '#a855f7',    // Purple-500
            background: '#0c0a09',   // Stone-950
            surface: '#1c1917',      // Stone-900
            surfaceAlt: '#292524',   // Stone-800
            text: '#fdf4ff',         // Fuchsia-50
            textMuted: '#d946ef',    // Fuchsia-500
            border: '#a855f7',       // Purple-500
            success: '#22d3ee',      // Cyan-400
            warning: '#fbbf24',      // Amber-400
            error: '#f43f5e',        // Rose-500
        },
        grid: {
            cellBackground: '#1c1917',
            cellBackgroundAlt: '#0c0a09',
            cellBorder: '#a855f7',
            headerBackground: '#ec4899',
            winnerGlow: true,
            winnerGlowColor: '#ec4899',
        },
    },
    {
        name: 'Championship Gold',
        description: 'Gold trophy vibes for champions',
        category: 'sports',
        isActive: true,
        isDefault: false,
        colors: {
            primary: '#eab308',      // Yellow-500
            secondary: '#ca8a04',    // Yellow-600
            background: '#1c1917',   // Stone-900
            surface: '#292524',      // Stone-800
            surfaceAlt: '#44403c',   // Stone-700
            text: '#fefce8',         // Yellow-50
            textMuted: '#fde047',    // Yellow-300
            border: '#ca8a04',       // Yellow-600
            success: '#22c55e',      // Green-500
            warning: '#eab308',      // Yellow-500
            error: '#ef4444',        // Red-500
        },
        grid: {
            cellBackground: '#292524',
            cellBackgroundAlt: '#1c1917',
            cellBorder: '#ca8a04',
            headerBackground: '#eab308',
            winnerGlow: true,
            winnerGlowColor: '#eab308',
        },
    },
];

/**
 * Get the default theme (Classic Dark)
 */
export const getDefaultTheme = (): Omit<PoolTheme, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> => {
    return PRESET_THEMES.find(t => t.isDefault) || PRESET_THEMES[0];
};

/**
 * Create a new empty theme template for the builder
 */
export const createEmptyTheme = (): Omit<PoolTheme, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> => ({
    name: 'New Theme',
    description: '',
    category: 'custom',
    isActive: false,
    isDefault: false,
    colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        background: '#0f172a',
        surface: '#1e293b',
        surfaceAlt: '#334155',
        text: '#f1f5f9',
        textMuted: '#94a3b8',
        border: '#334155',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
    },
    grid: {
        cellBackground: '#1e293b',
        cellBackgroundAlt: '#0f172a',
        cellBorder: '#334155',
        headerBackground: '#0f172a',
        winnerGlow: true,
        winnerGlowColor: '#10b981',
    },
});
