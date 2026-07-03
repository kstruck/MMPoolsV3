import React, { useState } from 'react';
import { X, Copy, Check, Link } from 'lucide-react';
import { InviteByEmail } from '../InviteByEmail';

interface PoolShareModalProps {
    poolId: string;
    poolName: string;
    poolSlug: string;
    onClose: () => void;
}

interface Platform {
    name: string;
    color: string;
    hoverColor: string;
    icon: React.ReactNode;
    buildUrl: (url: string, text: string) => string;
}

// SVG icons for social platforms not in lucide-react
const XIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.261 5.635 5.903-5.635Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);

const FacebookIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
);

const RedditIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
);

const WhatsAppIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
);

const InstagramIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
);

export const PoolShareModal: React.FC<PoolShareModalProps> = ({ poolId, poolName, poolSlug, onClose }) => {
    const [copied, setCopied] = useState(false);
    const poolUrl = `${window.location.origin}/pool/${poolSlug}`;
    const shareText = `Join my bracket pool: ${poolName}! Make your picks here 🏆`;

    const platforms: Platform[] = [
        {
            name: 'X (Twitter)',
            color: 'bg-black',
            hoverColor: 'hover:bg-zinc-800',
            icon: <XIcon />,
            buildUrl: (url, text) =>
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        },
        {
            name: 'Facebook',
            color: 'bg-blue-600',
            hoverColor: 'hover:bg-blue-500',
            icon: <FacebookIcon />,
            buildUrl: (url) =>
                `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        },
        {
            name: 'Reddit',
            color: 'bg-orange-600',
            hoverColor: 'hover:bg-orange-500',
            icon: <RedditIcon />,
            buildUrl: (url, text) =>
                `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
        },
        {
            name: 'WhatsApp',
            color: 'bg-green-600',
            hoverColor: 'hover:bg-green-500',
            icon: <WhatsAppIcon />,
            buildUrl: (url, text) =>
                `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
        },
        {
            name: 'Instagram',
            color: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400',
            hoverColor: 'hover:opacity-90',
            icon: <InstagramIcon />,
            // Instagram doesn't have a direct web share API; open the site and user copies manually
            buildUrl: () => `https://www.instagram.com/`,
        },
    ];

    const handleCopy = async () => {
        await navigator.clipboard.writeText(poolUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    const handlePlatformShare = (platform: Platform) => {
        // For Instagram, just show copied state since there's no direct share URL
        if (platform.name === 'Instagram') {
            handleCopy();
            return;
        }
        window.open(platform.buildUrl(poolUrl, shareText), '_blank', 'noopener,noreferrer,width=600,height=500');
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-800">
                    <div>
                        <h2 className="text-lg font-bold text-white">Share This Pool</h2>
                        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[280px]">{poolName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Pool URL Copy */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                            <Link size={12} /> Pool Link
                        </label>
                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={poolUrl}
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm font-mono truncate focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                                onClick={handleCopy}
                                className={`px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all ${copied
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                    }`}
                            >
                                {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy</>}
                            </button>
                        </div>
                    </div>

                    {/* Social Platforms */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">
                            Share Via
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {platforms.map((platform) => (
                                <button
                                    key={platform.name}
                                    onClick={() => handlePlatformShare(platform)}
                                    className={`${platform.color} ${platform.hoverColor} text-white px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2.5 transition-all active:scale-95`}
                                    title={
                                        platform.name === 'Instagram'
                                            ? 'Copies link — paste it into your Instagram Story or bio'
                                            : `Share on ${platform.name}`
                                    }
                                >
                                    {platform.icon}
                                    <span>{platform.name}</span>
                                </button>
                            ))}
                            {/* Email */}
                            <button
                                onClick={() => {
                                    const subject = encodeURIComponent(`Join my bracket pool: ${poolName}`);
                                    const body = encodeURIComponent(`${shareText}\n\n${poolUrl}`);
                                    window.location.href = `mailto:?subject=${subject}&body=${body}`;
                                }}
                                className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2.5 transition-all active:scale-95"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                <span>Email</span>
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-600 mt-3 text-center">
                            Instagram: link will be copied — paste it into your Story or bio link.
                        </p>
                    </div>

                    {/* Bulk email invites */}
                    <InviteByEmail poolId={poolId} />
                </div>
            </div>
        </div>
    );
};
