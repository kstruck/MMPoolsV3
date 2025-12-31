import React from 'react';
import { Share2, Twitter, Facebook, MessageCircle, Link as LinkIcon, LogOut } from 'lucide-react';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    shareUrl: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, shareUrl }) => {
    if (!isOpen) return null;

    const encodedUrl = encodeURIComponent(shareUrl);
    const text = "Join my Game Day Squares pool! Pick your winning squares now.";

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
                        href={`https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + shareUrl)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-emerald-500 transition-colors">
                            <MessageCircle size={20} className="text-emerald-500" />
                        </div>
                        <span className="text-xs text-slate-400">WhatsApp</span>
                    </a>
                    <button
                        onClick={() => { navigator.clipboard.writeText(shareUrl); alert("Link copied!"); }}
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700 group-hover:border-amber-500 transition-colors">
                            <LinkIcon size={20} className="text-amber-500" />
                        </div>
                        <span className="text-xs text-slate-400">Copy</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShareModal;
