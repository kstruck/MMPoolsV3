import React from 'react';
import { Share2, Twitter, Facebook, MessageCircle, Link as LinkIcon, LogOut, Instagram } from 'lucide-react';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    shareUrl: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, shareUrl }) => {
    if (!isOpen) return null;

    // Clean the URL: Replace '/#' with '/' to strictly switch from Hash to Path strategy
    // e.g. .com/#pool/123 -> .com/pool/123
    const cleanUrl = shareUrl.replace('/#', '/');
    const encodedUrl = encodeURIComponent(cleanUrl);
    const text = "Join my Game Day Squares pool! Pick your winning squares now.";

    const handleNativeShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Game Day Squares',
                    text: text,
                    url: cleanUrl,
                });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            // Fallback for desktop if they clicked the mobile share icon (unlikely but safe)
            navigator.clipboard.writeText(cleanUrl);
            alert("Link copied to clipboard!");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-sm w-full relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
                    <LogOut className="rotate-45" size={20} />
                </button>
                <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Share2 size={20} className="text-indigo-400" /> Share Pool
                </h3>
                <p className="text-sm text-slate-400 mb-6">Invite friends to join the action.</p>
                <div className="grid grid-cols-4 gap-4 mb-6">
                    {/* Native Share (Best for Instagram/Mobile) */}
                    <button
                        onClick={handleNativeShare}
                        className="flex flex-col items-center gap-2 group"
                        title="Share to Instagram / Other Apps"
                    >
                        <div className="w-12 h-12 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500 rounded-full flex items-center justify-center border border-slate-700 group-hover:scale-110 transition-transform">
                            <Instagram size={20} className="text-white" />
                        </div>
                        <span className="text-xs text-slate-400">Instagram</span>
                    </button>

                    <a
                        href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodeURIComponent(text)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-indigo-500 transition-colors">
                            <Twitter size={20} className="fill-white" />
                        </div>
                        <span className="text-xs text-slate-400">X</span>
                    </a>
                    <a
                        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-blue-500 transition-colors">
                            <Facebook size={20} className="text-blue-500" />
                        </div>
                        <span className="text-xs text-slate-400">Facebook</span>
                    </a>
                    <a
                        href={`https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + cleanUrl)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-emerald-500 transition-colors">
                            <MessageCircle size={20} className="text-emerald-500" />
                        </div>
                        <span className="text-xs text-slate-400">WhatsApp</span>
                    </a>
                </div>

                <div className="bg-slate-900 p-3 rounded-lg flex items-center gap-2 border border-slate-700">
                    <span className="text-xs text-slate-400 truncate flex-1 font-mono">{cleanUrl}</span>
                    <button
                        onClick={() => { navigator.clipboard.writeText(cleanUrl); alert("Link copied!"); }}
                        className="bg-slate-800 hover:bg-slate-700 text-white p-2 rounded transition-colors"
                        title="Copy Link"
                    >
                        <LinkIcon size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShareModal;
