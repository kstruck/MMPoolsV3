import { OverlayRoot } from '../ui/OverlayRoot';
import { logger } from '../../utils/logger';
import React, { useRef, useState, useEffect } from 'react';
import type { BracketEntry, Tournament } from '../../types';
import { BracketBuilder } from '../BracketBuilder/BracketBuilder';
import { ConferenceBracketBuilder } from '../BracketBuilder/ConferenceBracketBuilder';
import { toPng } from 'html-to-image';
import { X, Download, Share2, Loader2, Image as ImageIcon } from 'lucide-react';
import { getTeamLogo } from '../../constants';
import { useToast } from '../ui/Toast';

interface BracketShareModalProps {
    entry: BracketEntry;
    tournament: Tournament;
    poolName: string;
    onClose: () => void;
    isConference?: boolean;
}

export const BracketShareModal: React.FC<BracketShareModalProps> = ({ entry, tournament, poolName, onClose, isConference }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const toast = useToast();
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Identify the champion pick to feature in the header
    const maxRound = Math.max(...Object.values(tournament.games).map(g => g.round));
    const champGameId = Object.values(tournament.games).find(g => g.round === maxRound)?.id;
    const champPickTeamId = champGameId ? entry.picks[champGameId] : null;

    useEffect(() => {
        const generateImage = async () => {
            if (!cardRef.current) return;
            try {
                // Short delay to ensure React has fully rendered the BracketBuilder DOM before capture
                await new Promise(r => setTimeout(r, 500));

                const dataUrl = await toPng(cardRef.current, {
                    cacheBust: true,
                    pixelRatio: 2, // High resolution
                    backgroundColor: '#0B1526', // navy-950
                    style: {
                        transform: 'scale(1)',
                        transformOrigin: 'top left',
                        width: '2400px', // Force a large fixed width so the full bracket fits
                    },
                    includeQueryParams: true,
                });
                setImageUrl(dataUrl);
                setIsGenerating(false);
            } catch (err) {
                logger.error("Failed to generate bracket image", err);
                setError("Failed to generate image. Please try again.");
                setIsGenerating(false);
            }
        };

        generateImage();
    }, [entry, tournament, poolName]);

    const handleDownload = () => {
        if (!imageUrl) return;
        const link = document.createElement('a');
        link.download = `${entry.name.replace(/\s+/g, '_')}_Bracket.png`;
        link.href = imageUrl;
        link.click();
    };

    const handleNativeShare = async () => {
        if (!imageUrl) return;
        try {
            const blob = await (await fetch(imageUrl)).blob();
            const file = new File([blob], 'bracket.png', { type: blob.type });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `${entry.name} - ${poolName}`,
                    text: 'Check out my March Madness bracket!',
                    files: [file]
                });
            } else {
                toast.info("Your browser doesn't support direct image sharing. Please use the Download button instead.");
            }
        } catch (err) {
            logger.error("Error sharing:", err);
        }
    };

    return (
        <OverlayRoot id="bracket-share-card" label="Share your bracket" onEscape={onClose} className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/80 backdrop-blur-sm p-4">

            {/* The Hidden Card to Capture */}
            <div className="absolute top-0 left-0 -z-50 overflow-hidden" style={{ opacity: 0, pointerEvents: 'none' }}>
                <div ref={cardRef} className="bg-navy-950 p-12 text-white border-8 border-navy-900" style={{ width: '2400px' }}>

                    {/* Branded Header */}
                    <div className="flex justify-between items-end mb-12 border-b-2 border-[rgba(230,206,150,0.16)] pb-8">
                        <div>
                            <div className="text-gold-400 font-display font-bold tracking-widest uppercase mb-2 text-2xl">
                                {poolName}
                            </div>
                            <h1 className="text-6xl font-display font-extrabold uppercase text-white tracking-tight">
                                {entry.name}
                            </h1>
                            <div className="text-[#9FB0CC] mt-4 text-xl">
                                {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                        </div>

                        {champPickTeamId && (
                            <div className="flex items-center gap-6 bg-navy-900 rounded-2xl p-6 border border-gold-500/40 shadow-2xl shadow-gold-700/20">
                                <div className="text-right">
                                    <div className="text-gold-400 font-display font-bold uppercase tracking-widest text-lg mb-1">Champion Pick</div>
                                    <div className="text-4xl font-display font-extrabold uppercase text-white">
                                        {champPickTeamId.split('-')[1] ? champPickTeamId.split('-')[1].replace(/([A-Z])/g, ' $1').trim() : 'TBD'}
                                    </div>
                                </div>
                                <img
                                    src={getTeamLogo(champPickTeamId.split('-')[1] || '', 'ncaa') || undefined}
                                    className="w-24 h-24 object-contain drop-shadow-lg"
                                    alt="Champion Logo"
                                    crossOrigin="anonymous"
                                />
                            </div>
                        )}
                    </div>

                    {/* Bracket Body */}
                    <div className="relative">
                        {isConference ? (
                            <ConferenceBracketBuilder
                                tournament={tournament}
                                picks={entry.picks}
                                onPick={() => { }}
                                readOnly
                            />
                        ) : (
                            <BracketBuilder
                                tournament={tournament}
                                picks={entry.picks}
                                onPick={() => { }}
                                readOnly
                                viewMode="full"
                            />
                        )}
                    </div>

                    {/* Watermark Footer */}
                    <div className="mt-12 text-center text-[#9FB0CC]/60 font-display font-bold uppercase tracking-widest text-xl">
                        Generated by March Melee
                    </div>
                </div>
            </div>

            {/* Modal UI */}
            <div className="bg-card rounded-2xl border border-line p-6 max-w-2xl w-full shadow-card-hover flex flex-col relative max-h-[90vh]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-muted hover:text-[color:var(--text)] bg-surface hover:bg-page rounded-full p-2 transition-colors"
                >
                    <X size={20} />
                </button>

                <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-6 flex items-center gap-2">
                    <ImageIcon className="text-gold-500" />
                    Share Your Bracket
                </h2>

                <div className="flex-1 overflow-auto bg-surface rounded-xl border border-line flex items-center justify-center p-4 min-h-[300px]">
                    {isGenerating ? (
                        <div className="flex flex-col items-center gap-4 text-muted animate-pulse">
                            <Loader2 className="w-10 h-10 animate-spin text-gold-500" />
                            <p className="font-medium">Generating high-quality image...</p>
                        </div>
                    ) : error ? (
                        <div className="text-brandred-600 text-center font-medium">
                            {error}
                        </div>
                    ) : imageUrl ? (
                        <img
                            src={imageUrl}
                            alt="Bracket Preview"
                            className="max-w-full h-auto max-h-[50vh] object-contain rounded drop-shadow-2xl border border-line"
                        />
                    ) : null}
                </div>

                {!isGenerating && !error && (
                    <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-end">
                        <button
                            onClick={handleNativeShare}
                            className="bg-brandred-600 hover:bg-brandred-500 text-white font-display font-bold uppercase tracking-[0.05em] px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-red-cta flex-1 sm:flex-none"
                        >
                            <Share2 size={18} />
                            Share
                        </button>
                        <button
                            onClick={handleDownload}
                            className="bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors flex-1 sm:flex-none"
                        >
                            <Download size={18} />
                            Download Image
                        </button>
                    </div>
                )}
            </div>
        </OverlayRoot>
    );
};
