import React from 'react';
import { Users, Mail, Lock, QrCode, Download } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface WizardStepAdvancedProps {
    settings: {
        // Player Data Collection
        collectPhone?: boolean;
        collectAddress?: boolean;
        collectReferral?: boolean;
        collectNotes?: boolean;

        // Email Notifications
        emailConfirmation?: string;
        emailNumbersGenerated?: boolean;
        notifyAdminFull?: boolean;

        // Access Control
        gridPassword?: string;
        isPublic?: boolean;
    };
    poolUrl?: string; // For QR code generation
    poolSlug?: string; // For QR code filename
    poolId?: string; // Fallback for poolSlug
    onUpdate: (updates: Partial<WizardStepAdvancedProps['settings']>) => void;
}

export const WizardStepAdvanced: React.FC<WizardStepAdvancedProps> = ({
    settings,
    poolUrl,
    poolSlug,
    poolId,
    onUpdate
}) => {
    const [showQRCode, setShowQRCode] = React.useState(false);

    const qrCodeUrl = poolUrl || `${window.location.origin}/#pool/${poolSlug || poolId || 'new'}`;

    const handleDownloadQR = () => {
        const svg = document.getElementById('pool-qr-code');
        if (!svg) return;

        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx?.drawImage(img, 0, 0);
            const pngUrl = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = pngUrl;
            a.download = `${poolSlug || poolId || 'pool'}_qr.png`;
            a.click();
        };

        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-white mb-2">Final Preferences</h3>
                <p className="text-slate-400 text-sm mb-6">Customize data collection, notifications, and advanced rules.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Player Data Collection */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Users size={16} className="text-indigo-400" /> Player Data Collection
                        </h4>
                        <div className="space-y-3">
                            {[
                                { key: 'collectPhone', label: 'Phone Number' },
                                { key: 'collectAddress', label: 'Address' },
                                { key: 'collectReferral', label: 'Referral Source' },
                                { key: 'collectNotes', label: 'Player Notes' }
                            ].map(({ key, label }) => (
                                <label key={key} className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded">
                                    <span className="text-sm text-slate-300">{label}</span>
                                    <input
                                        type="checkbox"
                                        checked={settings[key as keyof typeof settings] as boolean}
                                        onChange={(e) => onUpdate({ [key]: e.target.checked })}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Email Notifications */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Mail size={16} className="text-sky-400" /> Email Notifications
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-500 uppercase font-bold mb-1">User Entry Confirmation</label>
                                <select
                                    value={settings.emailConfirmation || 'No Email Confirmation'}
                                    onChange={(e) => onUpdate({ emailConfirmation: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-indigo-500"
                                >
                                    <option value="No Email Confirmation">Don't Send</option>
                                    <option value="Email Confirmation">Send Email Receipt</option>
                                </select>
                            </div>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded">
                                <span className="text-sm text-slate-300">Email When Pool Starts</span>
                                <input
                                    type="checkbox"
                                    checked={!!settings.emailNumbersGenerated}
                                    onChange={(e) => onUpdate({ emailNumbersGenerated: e.target.checked })}
                                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                                />
                            </label>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-slate-900 rounded border-t border-slate-800 pt-3">
                                <span className="text-sm text-slate-300">Alert Admin when Pool Full</span>
                                <input
                                    type="checkbox"
                                    checked={!!settings.notifyAdminFull}
                                    onChange={(e) => onUpdate({ notifyAdminFull: e.target.checked })}
                                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                                />
                            </label>
                        </div>
                    </div>

                    {/* Access Control */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <Lock size={16} className="text-amber-400" /> Access Control
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Pool Password</label>
                                <input
                                    type="text"
                                    value={settings.gridPassword || ''}
                                    onChange={(e) => onUpdate({ gridPassword: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                    placeholder="Optional"
                                />
                                <p className="text-xs text-slate-500 mt-1">Leave blank for no password protection</p>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer pt-2">
                                <input
                                    type="checkbox"
                                    checked={!!settings.isPublic}
                                    onChange={(e) => onUpdate({ isPublic: e.target.checked })}
                                    className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="text-sm text-slate-300">List in Public Directory</span>
                            </label>
                        </div>
                    </div>

                    {/* QR Code Sharing */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-700">
                        <h4 className="font-bold text-white mb-4 flex items-center gap-2">
                            <QrCode size={16} className="text-emerald-400" /> Share via QR Code
                        </h4>
                        <div className="text-center">
                            <button
                                onClick={() => setShowQRCode(!showQRCode)}
                                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 mx-auto"
                                type="button"
                            >
                                <QrCode size={16} />
                                {showQRCode ? 'Hide QR Code' : 'Generate QR Code'}
                            </button>

                            {showQRCode && (
                                <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="bg-white p-4 rounded-xl inline-block">
                                        <QRCodeSVG
                                            id="pool-qr-code"
                                            value={qrCodeUrl}
                                            size={180}
                                            level="H"
                                            includeMargin
                                        />
                                    </div>
                                    <p className="text-xs text-slate-400 mt-3">Scan to join pool</p>
                                    <button
                                        onClick={handleDownloadQR}
                                        className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors inline-flex items-center gap-2"
                                        type="button"
                                    >
                                        <Download size={14} /> Download PNG
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
