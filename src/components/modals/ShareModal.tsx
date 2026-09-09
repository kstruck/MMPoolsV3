import { logger } from '../../utils/logger';
import React, { useEffect, useRef } from 'react';
import { useOverlayOwner } from '../ui/overlayStack';
import { useFocusTrap } from '../ui/useFocusTrap';
import { Share2, Twitter, Facebook, MessageCircle, Link as LinkIcon, LogOut, Instagram } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { InviteByEmail } from '../InviteByEmail';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    shareUrl: string;
    /** When set (commissioner context), shows the bulk "Invite by email" section. */
    poolId?: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, shareUrl, poolId }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const toast = useToast();

    // Hooks run unconditionally (before the isOpen early return). Escape closes;
    // focus moves into the dialog on open.
    // PLAN-HELP-SYSTEM T2: own the screen while open, so the `?` shortcut stays
    // quiet and Escape closes exactly one overlay. Registered on `isOpen`, NOT
    // on mount — this component stays mounted while closed, and pushing on
    // mount would let it own the stack for the life of the app.
    useOverlayOwner('share-modal', { active: isOpen, onEscape: onClose });
    // aria-modal="true" promises focus containment — deliver it (a11y audit
    // item 15a). Registered on `isOpen`, not on mount, same as the hook's other
    // call sites: this component stays mounted while closed.
    useFocusTrap(dialogRef, isOpen);
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        dialogRef.current?.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

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
                logger.error('Error sharing:', err);
            }
        } else {
            // Fallback for desktop if they clicked the mobile share icon (unlikely but safe)
            navigator.clipboard.writeText(cleanUrl);
            toast.success("Link copied to clipboard!");
        }
    };

    return (
        <div data-overlay-root=""
            className="fixed inset-0 bg-navy-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-modal-title"
                tabIndex={-1}
                className="bg-card border border-line p-6 rounded-xl shadow-panel max-w-sm w-full relative outline-none"
                onClick={(e) => e.stopPropagation()}
            >
                <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-muted hover:text-[color:var(--text)] transition-colors">
                    <LogOut className="rotate-45" size={20} />
                </button>
                <h3 id="share-modal-title" className="text-xl font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-2 flex items-center gap-2">
                    <Share2 size={20} className="text-gold-500" /> Share Pool
                </h3>
                <p className="text-sm font-body text-muted mb-6">Invite friends to join the action.</p>
                <div className="grid grid-cols-4 gap-4 mb-6">
                    {/* Native Share (Best for Instagram/Mobile) */}
                    <button
                        onClick={handleNativeShare}
                        className="flex flex-col items-center gap-2 group"
                        title="Share to Instagram / Other Apps"
                    >
                        <div className="w-12 h-12 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500 rounded-full flex items-center justify-center border border-line fine:group-hover:scale-110 transition-transform">
                            <Instagram size={20} className="text-white" />
                        </div>
                        <span className="text-xs font-body text-muted">Instagram</span>
                    </button>

                    <a
                        href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodeURIComponent(text)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center border border-line group-hover:border-gold-500 transition-colors">
                            <Twitter size={20} className="fill-white" />
                        </div>
                        <span className="text-xs font-body text-muted">X</span>
                    </a>
                    <a
                        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-navy-900 rounded-full flex items-center justify-center border border-line group-hover:border-[#1877F2] transition-colors">
                            <Facebook size={20} className="text-[#1877F2]" />
                        </div>
                        <span className="text-xs font-body text-muted">Facebook</span>
                    </a>
                    <a
                        href={`https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + cleanUrl)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-2 group"
                    >
                        <div className="w-12 h-12 bg-navy-900 rounded-full flex items-center justify-center border border-line group-hover:border-[#25D366] transition-colors">
                            <MessageCircle size={20} className="text-[#25D366]" />
                        </div>
                        <span className="text-xs font-body text-muted">WhatsApp</span>
                    </a>
                </div>

                <div className="bg-page p-3 rounded-lg flex items-center gap-2 border border-line">
                    <span className="text-xs text-muted truncate flex-1 font-mono num">{cleanUrl}</span>
                    <button
                        onClick={() => { navigator.clipboard.writeText(cleanUrl); toast.success("Link copied to clipboard!"); }}
                        className="bg-navy-800 hover:bg-navy-700 text-white p-2 rounded transition-colors"
                        title="Copy Link"
                    >
                        <LinkIcon size={16} />
                    </button>
                </div>

                {/* Bulk email invites — commissioner-only (backend re-checks permission) */}
                {poolId && (
                    <div className="mt-6">
                        <InviteByEmail poolId={poolId} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ShareModal;
