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
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Sparkles size={20} className="text-amber-400" /> Pool Theme
                    </h3>
                    <p className="text-slate-400 text-sm mb-6">Select a color theme for your pool. This changes the overall look and feel.</p>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* No Theme Option */}
                        <button
                            onClick={() => updateConfig({ themeId: undefined })}
                            className={`p-4 rounded-xl border transition-all text-left relative z-10 cursor-pointer ${!gameState.themeId ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-950'}`}
                        >
                            <div className="h-12 rounded-lg bg-slate-800 mb-3 flex items-center justify-center">
                                <span className="text-slate-500 text-xs">Default</span>
                            </div>
                            <span className="font-bold text-white text-sm">Classic Dark</span>
                            <span className="text-xs text-slate-400 block">Original theme</span>
                        </button>

                        {availableThemes.map((theme) => (
                            <button
                                key={theme.id || theme.name}
                                onClick={() => handleThemeSelect(theme)}
                                className={`p-4 rounded-xl border transition-all text-left relative z-10 cursor-pointer ${gameState.themeId === theme.id ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-slate-700 hover:border-slate-500'}`}
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
                                <span className="font-bold text-white text-sm">{theme.name}</span>
                                <span className="text-xs text-slate-400 block truncate">{theme.description}</span>
                                {/* Color dots */}
                                <div className="flex gap-1 mt-2">
                                    {['primary', 'secondary', 'success'].map(key => (
                                        <div
                                            key={key}
                                            className="w-3 h-3 rounded-full border border-slate-600"
                                            style={{ background: (theme.colors as any)?.[key] }}
                                        />
                                    ))}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Customization</h3>
                <p className="text-slate-400 text-sm mb-6">Make the pool your own with a custom logo and background.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Logo Upload */}
                    <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Sparkles size={16} className="text-amber-400" /> Pool Logo
                        </h4>

                        <div className="flex flex-col items-center gap-4">
                            {gameState.branding?.logoUrl ? (
                                <div className="relative group">
                                    <div className="w-32 h-32 bg-slate-900 rounded-lg flex items-center justify-center border border-slate-600 p-2">
                                        <img src={gameState.branding.logoUrl} className="max-w-full max-h-full object-contain" alt="Pool Logo" />
                                    </div>
                                    <button
                                        onClick={() => updateConfig({ branding: { ...gameState.branding, logoUrl: undefined } })}
                                        className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg hover:bg-rose-600 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="w-32 h-32 bg-slate-900/50 rounded-lg border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 gap-2">
                                    <div className="p-2 bg-slate-800 rounded-full"><Sparkles size={20} /></div>
                                    <span className="text-xs">No Logo</span>
                                </div>
                            )}

                            <div className="w-full">
                                <label className="block text-center cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                                    Upload Logo (Max 2MB)
                                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                                </label>
                                <p className="text-[10px] text-slate-500 text-center mt-2">Recommended: Square PNG with transparent background.</p>
                            </div>
                        </div>
                    </div>

                    {/* Background Color */}
                    <div className="bg-slate-950 p-6 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Settings size={16} className="text-emerald-400" /> Background color
                        </h4>
                        <p className="text-xs text-slate-400 mb-4">Choose a background color for your pool page.</p>

                        <div className="flex items-center gap-4">
                            <input
                                type="color"
                                value={gameState.branding?.backgroundColor || '#0f172a'} // Default Slate-900
                                onChange={(e) => updateConfig({ branding: { ...gameState.branding, backgroundColor: e.target.value } })}
                                className="w-16 h-16 rounded cursor-pointer border-none p-0 bg-transparent"
                            />
                            <div className="flex-1">
                                <div className="font-mono text-white mb-1">{gameState.branding?.backgroundColor || '#0f172a'}</div>
                                <button
                                    onClick={() => updateConfig({ branding: { ...gameState.branding, backgroundColor: '#0f172a' } })}
                                    className="text-xs text-slate-500 hover:text-white underline"
                                >
                                    Reset to Default
                                </button>
                            </div>
                        </div>

                        {/* Mini Preview */}
                        <div className="mt-8">
                            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Live Preview</p>
                            <div
                                className="w-full h-24 rounded-lg flex items-center justify-center border border-slate-600 relative overflow-hidden"
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
