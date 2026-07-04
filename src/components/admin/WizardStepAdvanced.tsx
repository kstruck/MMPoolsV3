import React from 'react';
import { Users, Mail, Lock, QrCode, Download } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../ui';

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
            <div className="bg-surface border border-line rounded-xl p-6">
                <h3 className="font-display font-bold uppercase text-xl text-[color:var(--text)] mb-2">Final Preferences</h3>
                <p className="text-muted text-sm mb-6">Customize data collection, notifications, and advanced rules.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Player Data Collection */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Users size={16} className="text-navy-600 dark:text-navy-500" /> Player Data Collection
                        </h4>
                        <div className="space-y-3">
                            {[
                                { key: 'collectPhone', label: 'Phone Number' },
                                { key: 'collectAddress', label: 'Address' },
                                { key: 'collectReferral', label: 'Referral Source' },
                                { key: 'collectNotes', label: 'Player Notes' }
                            ].map(({ key, label }) => (
                                <label key={key} className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                    <span className="text-sm text-muted">{label}</span>
                                    <input
                                        type="checkbox"
                                        checked={settings[key as keyof typeof settings] as boolean}
                                        onChange={(e) => onUpdate({ [key]: e.target.checked })}
                                        className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Email Notifications */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Mail size={16} className="text-navy-600 dark:text-navy-500" /> Email Notifications
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">User Entry Confirmation</label>
                                <select
                                    value={settings.emailConfirmation || 'No Email Confirmation'}
                                    onChange={(e) => onUpdate({ emailConfirmation: e.target.value })}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-sm text-[color:var(--text)] cursor-pointer transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                >
                                    <option value="No Email Confirmation">Don't Send</option>
                                    <option value="Email Confirmation">Send Email Receipt</option>
                                </select>
                            </div>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded">
                                <span className="text-sm text-muted">Email When Pool Starts</span>
                                <input
                                    type="checkbox"
                                    checked={!!settings.emailNumbersGenerated}
                                    onChange={(e) => onUpdate({ emailNumbersGenerated: e.target.checked })}
                                    className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600"
                                />
                            </label>

                            <label className="flex items-center justify-between cursor-pointer p-2 hover:bg-surface rounded border-t border-line pt-3">
                                <span className="text-sm text-muted">Alert Admin when Pool Full</span>
                                <input
                                    type="checkbox"
                                    checked={!!settings.notifyAdminFull}
                                    onChange={(e) => onUpdate({ notifyAdminFull: e.target.checked })}
                                    className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600"
                                />
                            </label>
                        </div>
                    </div>

                    {/* Access Control */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <Lock size={16} className="text-gold-700 dark:text-gold-400" /> Access Control
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block font-display font-bold uppercase text-[12px] tracking-[0.08em] text-[color:var(--text)] mb-1.5">Pool Password</label>
                                <input
                                    type="text"
                                    value={settings.gridPassword || ''}
                                    onChange={(e) => onUpdate({ gridPassword: e.target.value })}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                    placeholder="Optional"
                                />
                                <p className="text-xs text-faint mt-1">Leave blank for no password protection</p>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer pt-2">
                                <input
                                    type="checkbox"
                                    checked={!!settings.isPublic}
                                    onChange={(e) => onUpdate({ isPublic: e.target.checked })}
                                    className="size-5 rounded-[5px] border-[1.5px] border-line bg-page checked:bg-navy-800 checked:border-navy-800 accent-navy-800 focus:ring-navy-600"
                                />
                                <span className="text-sm text-muted">List in Public Directory</span>
                            </label>
                        </div>
                    </div>

                    {/* QR Code Sharing */}
                    <div className="bg-card p-4 rounded-xl border border-line">
                        <h4 className="font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            <QrCode size={16} className="text-gold-700 dark:text-gold-400" /> Share via QR Code
                        </h4>
                        <div className="text-center">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setShowQRCode(!showQRCode)}
                                className="mx-auto"
                            >
                                <QrCode size={16} />
                                {showQRCode ? 'Hide QR Code' : 'Generate QR Code'}
                            </Button>

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
                                    <p className="text-xs text-muted mt-3">Scan to join pool</p>
                                    <Button
                                        variant="premium"
                                        size="sm"
                                        onClick={handleDownloadQR}
                                        className="mt-3"
                                    >
                                        <Download size={14} /> Download PNG
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
