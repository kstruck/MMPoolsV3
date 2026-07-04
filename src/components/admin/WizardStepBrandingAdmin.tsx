import React from 'react';
import { Sparkles, Trash2, Settings } from 'lucide-react';
import type { GameState, PoolTheme } from '../../types';

interface WizardStepBrandingAdminProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
    availableThemes: PoolTheme[];
    handleThemeSelect: (theme: PoolTheme) => void;
    handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const WizardStepBrandingAdmin: React.FC<WizardStepBrandingAdminProps> = ({
    gameState,
    updateConfig,
    availableThemes,
    handleThemeSelect,
    handleLogoUpload
}) => {
    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            {/* Theme Selector */}
            {availableThemes.length > 0 && (
                <div className="bg-surface border border-line rounded-xl p-6">
                    <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2 flex items-center gap-2">
                        <Sparkles size={20} className="text-gold-700 dark:text-gold-400" /> Pool Theme
                    </h3>
                    <p className="text-muted text-sm mb-6">Select a color theme for your pool. This changes the overall look and feel.</p>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* No Theme Option */}
                        <button
                            onClick={() => updateConfig({ themeId: undefined })}
                            className={`p-4 rounded-xl border transition-all text-left relative z-10 cursor-pointer ${!gameState.themeId ? 'border-navy-600 ring-2 ring-navy-600 bg-navy-600/10' : 'border-line hover:border-navy-600 bg-card'}`}
                        >
                            <div className="h-12 rounded-lg bg-card mb-3 flex items-center justify-center">
                                <span className="text-faint text-xs">Default</span>
                            </div>
                            <span className="font-display font-bold uppercase text-[color:var(--text)] text-sm">Classic Dark</span>
                            <span className="text-xs text-muted block">Original theme</span>
                        </button>

                        {availableThemes.map((theme) => (
                            <button
                                key={theme.id || theme.name}
                                onClick={() => handleThemeSelect(theme)}
                                className={`p-4 rounded-xl border transition-all text-left relative z-10 cursor-pointer ${gameState.themeId === theme.id ? 'border-navy-600 ring-2 ring-navy-600' : 'border-line hover:border-navy-600'}`}
                            >
                                {/* Theme Preview */}
                                <div
                                    className="h-12 rounded-lg mb-3 flex items-center justify-center"
                                    style={{ background: theme.colors?.background }}
                                >
                                    {/* Mini grid preview */}
                                    <div className="flex gap-0.5">
                                        {[0, 1, 2, 3].map(i => (
                                            <div
                                                key={i}
                                                className="w-2 h-2 rounded-sm"
                                                style={{
                                                    background: i % 2 === 0 ? theme.grid?.cellBackground : theme.grid?.cellBackgroundAlt,
                                                    border: `1px solid ${theme.grid?.cellBorder}`
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <span className="font-display font-bold uppercase text-[color:var(--text)] text-sm">{theme.name}</span>
                                <span className="text-xs text-muted block truncate">{theme.description}</span>
                                {/* Color dots */}
                                <div className="flex gap-1 mt-2">
                                    {['primary', 'secondary', 'success'].map(key => (
                                        <div
                                            key={key}
                                            className="w-3 h-3 rounded-full border border-line"
                                            style={{ background: (theme.colors as any)?.[key] }}
                                        />
                                    ))}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Customization</h3>
                <p className="text-muted text-sm mb-6">Make the pool your own with a custom logo and background.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Logo Upload */}
                    <div className="bg-card p-6 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Sparkles size={16} className="text-gold-700 dark:text-gold-400" /> Pool Logo
                        </h4>

                        <div className="flex flex-col items-center gap-4">
                            {gameState.branding?.logoUrl ? (
                                <div className="relative group">
                                    <div className="w-32 h-32 bg-page rounded-lg flex items-center justify-center border border-line p-2">
                                        <img src={gameState.branding.logoUrl} className="max-w-full max-h-full object-contain" alt="Pool Logo" />
                                    </div>
                                    <button
                                        onClick={() => updateConfig({ branding: { ...gameState.branding, logoUrl: undefined } })}
                                        className="absolute -top-2 -right-2 bg-brandred-600 text-white p-1 rounded-full shadow-lg hover:bg-brandred-500 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="w-32 h-32 bg-page/50 rounded-lg border-2 border-dashed border-line flex flex-col items-center justify-center text-faint gap-2">
                                    <div className="p-2 bg-card rounded-full"><Sparkles size={20} /></div>
                                    <span className="text-xs">No Logo</span>
                                </div>
                            )}

                            <div className="w-full">
                                <label className="block text-center cursor-pointer bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] py-2 px-4 rounded-md transition-all duration-150 hover:-translate-y-px text-sm">
                                    Upload Logo (Max 2MB)
                                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                </label>
                                <p className="text-[10px] text-faint text-center mt-2">Recommended: Square PNG with transparent background.</p>
                            </div>
                        </div>
                    </div>

                    {/* Background Color */}
                    <div className="bg-card p-6 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Settings size={16} className="text-navy-600 dark:text-navy-500" /> Background color
                        </h4>
                        <p className="text-xs text-muted mb-4">Choose a background color for your pool page.</p>

                        <div className="flex items-center gap-4">
                            <input
                                type="color"
                                value={gameState.branding?.backgroundColor || '#0f172a'} // Default Slate-900
                                onChange={(e) => updateConfig({ branding: { ...gameState.branding, backgroundColor: e.target.value } })}
                                className="w-16 h-16 rounded cursor-pointer border-none p-0 bg-transparent"
                            />
                            <div className="flex-1">
                                <div className="num font-mono text-[color:var(--text)] mb-1">{gameState.branding?.backgroundColor || '#0f172a'}</div>
                                <button
                                    onClick={() => updateConfig({ branding: { ...gameState.branding, backgroundColor: '#0f172a' } })}
                                    className="text-xs text-muted hover:text-[color:var(--text)] underline"
                                >
                                    Reset to Default
                                </button>
                            </div>
                        </div>

                        {/* Mini Preview */}
                        <div className="mt-8">
                            <p className="text-xs font-display font-bold uppercase tracking-[0.08em] text-faint mb-2">Live Preview</p>
                            <div
                                className="w-full h-24 rounded-lg flex items-center justify-center border border-line relative overflow-hidden"
                                style={{ backgroundColor: gameState.branding?.backgroundColor || '#0f172a' }}
                            >
                                {gameState.branding?.logoUrl && (
                                    <img src={gameState.branding.logoUrl} className="h-12 w-12 object-contain drop-shadow-lg" alt="Logo Preview" />
                                )}
                                <div className="absolute bottom-2 left-0 w-full text-center">
                                    <span className="text-[10px] text-white/50 font-bold uppercase tracking-widest">Your Pool</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
