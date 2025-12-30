import type { PoolTheme } from '../types';

/**
 * Convert a PoolTheme to CSS custom properties object
 * Can be applied as inline style to apply theme colors
 */
export function themeToStyleVars(theme: PoolTheme | null): React.CSSProperties {
    if (!theme) return {};

    return {
        // Color palette as CSS custom properties
        '--theme-primary': theme.colors?.primary || '#6366f1',
        '--theme-secondary': theme.colors?.secondary || '#8b5cf6',
        '--theme-background': theme.colors?.background || '#0f172a',
        '--theme-surface': theme.colors?.surface || '#1e293b',
        '--theme-surface-alt': theme.colors?.surfaceAlt || '#334155',
        '--theme-text': theme.colors?.text || '#f1f5f9',
        '--theme-text-muted': theme.colors?.textMuted || '#94a3b8',
        '--theme-border': theme.colors?.border || '#334155',
        '--theme-success': theme.colors?.success || '#10b981',
        '--theme-warning': theme.colors?.warning || '#f59e0b',
        '--theme-error': theme.colors?.error || '#ef4444',

        // Grid styles
        '--theme-cell-bg': theme.grid?.cellBackground || '#1e293b',
        '--theme-cell-bg-alt': theme.grid?.cellBackgroundAlt || '#0f172a',
        '--theme-cell-border': theme.grid?.cellBorder || '#334155',
        '--theme-header-bg': theme.grid?.headerBackground || '#0f172a',
        '--theme-winner-glow': theme.grid?.winnerGlow ? theme.grid?.winnerGlowColor || '#10b981' : 'transparent',

        // Apply background directly
        backgroundColor: theme.colors?.background || '#0f172a',
        color: theme.colors?.text || '#f1f5f9',
    } as React.CSSProperties;
}

/**
 * Get theme background color, falling back to pool branding or default
 */
export function getPoolBackground(theme: PoolTheme | null, brandingColor?: string): string {
    if (theme?.colors?.background) return theme.colors.background;
    if (brandingColor) return brandingColor;
    return '#020617'; // Default slate-950
}
