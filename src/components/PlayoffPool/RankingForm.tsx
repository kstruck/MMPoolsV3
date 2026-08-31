import { OverlayRoot } from '../ui/OverlayRoot';
import React, { useState, useEffect } from 'react';
import { GripVertical, Check, Save, Loader, AlertTriangle, Lock, ChevronUp, ChevronDown } from 'lucide-react';
import type { PlayoffPool, PlayoffTeam, User } from '../../types';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { getTeamLogo } from '../../constants';
import { ScheduleDisplay } from './ScheduleDisplay';
import { AuthModal } from '../modals/AuthModal';
import { logger } from '../../utils/logger';
import { Button, Input } from '../ui';

interface RankingFormProps {
    pool: PlayoffPool;
    user: User | null;
    entryId?: string | null; // Optional: ID of entry being edited
    onSaved?: () => void;
    onCancel?: () => void;
}

export const RankingForm: React.FC<RankingFormProps> = ({ pool, user, entryId, onSaved, onCancel }) => {
    const [rankedTeams, setRankedTeams] = useState<PlayoffTeam[]>([]);
    const [entryName, setEntryName] = useState<string>(''); // NEW: Entry Name
    const [tiebreaker, setTiebreaker] = useState<number>(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);

    // Confirmation & Disclaimer State
    const [isConfirming, setIsConfirming] = useState(false);
    const [liabilityAccepted, setLiabilityAccepted] = useState(false);

    // Initialize state
    useEffect(() => {
        if (pool && pool.teams) {
            let existingEntry = null;
            if (entryId) {
                existingEntry = pool.entries?.[entryId];
            } else if (entryId === undefined && user) {
                // Legacy support if needed, but strict entryId is preferred
            }

            if (existingEntry) {
                // Reconstruct order from rankings
                const sorted = [...pool.teams].sort((a, b) => {
                    const rankA = existingEntry!.rankings[a.id] || 0;
                    const rankB = existingEntry!.rankings[b.id] || 0;
                    return rankB - rankA; // Descending (14 first)
                });
                setRankedTeams(sorted);
                setTiebreaker(existingEntry.tiebreaker);
                setEntryName(existingEntry.entryName || '');
            } else {
                // Default order (New Entry)
                const initial = [...pool.teams].sort((a, b) => {
                    if (a.conference !== b.conference) return a.conference.localeCompare(b.conference);
                    return a.seed - b.seed;
                });
                setRankedTeams(initial);
                setTiebreaker(0);
                setEntryName(user?.name || ''); // Default to username for new entries
            }
        }
    }, [pool, user, entryId]);

    // Drag Config
    const handleDragStart = (index: number) => {
        if (pool.isLocked) return;
        setDraggedIndex(index);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (pool.isLocked || draggedIndex === null || draggedIndex === index) return;

        const newItems = [...rankedTeams];
        const draggedItem = newItems.splice(draggedIndex, 1)[0];
        newItems.splice(index, 0, draggedItem);

        setRankedTeams(newItems);
        setDraggedIndex(index);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
    };

    // [NEW] Manual Move Helper
    const moveTeam = (index: number, direction: 'up' | 'down') => {
        if (pool.isLocked) return;
        const newItems = [...rankedTeams];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;

        if (targetIndex < 0 || targetIndex >= newItems.length) return;

        // Swap
        [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
        setRankedTeams(newItems);
    };

    // [NEW] Dropdown Move Helper
    const moveToRank = (currentIndex: number, newRank: number) => {
        if (pool.isLocked) return;
        const newItems = [...rankedTeams];
        const targetIndex = 14 - newRank; // Rank 14 = Index 0, Rank 1 = Index 13

        if (targetIndex < 0 || targetIndex >= newItems.length || targetIndex === currentIndex) return;

        // Move item
        const item = newItems.splice(currentIndex, 1)[0];
        newItems.splice(targetIndex, 0, item);

        setRankedTeams(newItems);
    };

    const handleInitSave = () => {
        if (pool.isLocked) {
            return;
        }

        if (!user) {
            setShowAuthModal(true);
            return;
        }

        // VALIDATION: Require Tiebreaker
        if (!tiebreaker || tiebreaker <= 0) {
            setError("Please enter a valid tiebreaker score (Total Points in Super Bowl).");
            // Scroll to bottom helper
            const el = document.getElementById('tiebreaker-input');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        setError(null);
        setLiabilityAccepted(false);
        setIsConfirming(true);
    };

    const handleFinalizeSubmission = async () => {
        if (!user) return;
        setIsSubmitting(true);
        setError(null);
        setSuccess(false);

        try {
            // Convert list to map: { teamId: Rank }
            const rankingsMap: Record<string, number> = {};
            rankedTeams.forEach((team, index) => {
                const points = 14 - index;
                rankingsMap[team.id] = points;
            });

            const submitPicks = httpsCallable(functions, 'submitPlayoffPicks');
            await submitPicks({
                poolId: pool.id,
                rankings: rankingsMap,
                tiebreaker: Number(tiebreaker),
                entryId: entryId, // Pass entryId to backend (null = new, string = edit)
                entryName: entryName.trim() || user.name // Pass entry name
            });
            logger.log("Submitting picks:", { poolId: pool.id, entryId, rankings: rankingsMap });

            setSuccess(true);
            setIsConfirming(false); // Close modal
            if (onSaved) onSaved();

            // Clear success after 3s
            setTimeout(() => setSuccess(false), 3000);

        } catch (err: any) {
            logger.error(err);
            setError(err.message || "Failed to save picks");
            setIsConfirming(false); // Close modal on error to show error message
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            {onCancel && (
                <button
                    onClick={onCancel}
                    className="mb-4 text-muted hover:text-[color:var(--text)] flex items-center gap-2 text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150"
                >
                    &larr; Back to Entry List
                </button>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

                {/* LEFT COLUMN: Ranking Interface (Spans 2 cols on lg) */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Instructions */}
                    <div className="bg-card border border-line rounded-lg p-4 flex gap-3">
                        <AlertTriangle className="text-gold-500 shrink-0" size={24} />
                        <div className="text-sm font-body text-[color:var(--text)]">
                            <p className="font-display font-bold uppercase tracking-[0.05em] text-navy-800 dark:text-gold-400 mb-1">How to Rank</p>
                            <p>Drag and drop, use the arrows, or <strong>select a rank number</strong> to set your order. The top team (Rank 14) earns the most points.</p>
                        </div>
                    </div>

                    {pool.isLocked && (
                        <div className="bg-brandred-600/10 border border-brandred-600/30 rounded-lg p-4 flex items-center gap-3 text-brandred-600 font-display font-bold uppercase tracking-[0.05em] mb-4">
                            <Lock size={20} />
                            Picks are locked. No further changes allowed.
                        </div>
                    )}

                    {/* Entry Name Input */}
                    <div className="bg-card border border-line p-4 rounded-xl mb-4 shadow-card">
                        <Input
                            label="Entry Name"
                            type="text"
                            value={entryName}
                            onChange={(e) => setEntryName(e.target.value)}
                            disabled={pool.isLocked}
                            className="disabled:opacity-50"
                            placeholder="My Winning Entry"
                        />
                    </div>

                    {/* Draggable List */}
                    <div className="space-y-2">
                        {rankedTeams.map((team, index) => {
                            const rank = 14 - index;
                            let rankColor = "text-muted";
                            if (rank >= 11) rankColor = "text-gold-600 dark:text-gold-400"; // Top tier
                            if (rank <= 4) rankColor = "text-brandred-600"; // Bottom tier

                            const logoUrl = getTeamLogo(team.name) || getTeamLogo(team.id);

                            return (
                                <div
                                    key={team.id}
                                    draggable={!pool.isLocked}
                                    onDragStart={() => handleDragStart(index)}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDragEnd={handleDragEnd}
                                    className={`
                                        flex items-center gap-3 p-3 md:p-4 rounded-lg border transition-all duration-150 select-none
                                        ${pool.isLocked ? 'bg-surface border-line cursor-default opacity-75' : 'bg-card border-line hover:border-navy-600 cursor-grab active:cursor-grabbing hover:bg-surface'}
                                        ${draggedIndex === index ? 'opacity-50 ring-2 ring-navy-600 dark:ring-gold-500' : ''}
                                    `}
                                >
                                    {/* Mobile Sort Controls */}
                                    {!pool.isLocked && (
                                        <div className="flex flex-col gap-1 md:mr-2">
                                            <button
                                                onClick={(e) => { e.preventDefault(); moveTeam(index, 'up'); }}
                                                disabled={index === 0}
                                                className="p-1 hover:bg-surface rounded text-muted hover:text-[color:var(--text)] disabled:opacity-20 disabled:cursor-not-allowed"
                                            >
                                                <ChevronUp size={20} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.preventDefault(); moveTeam(index, 'down'); }}
                                                disabled={index === rankedTeams.length - 1}
                                                className="p-1 hover:bg-surface rounded text-muted hover:text-[color:var(--text)] disabled:opacity-20 disabled:cursor-not-allowed"
                                            >
                                                <ChevronDown size={20} />
                                            </button>
                                        </div>
                                    )}

                                    {/* Grip Handle (Hidden on small mobile, kept for desktop) */}
                                    {!pool.isLocked && (
                                        <div className="text-faint hidden md:block" style={{ touchAction: 'none' }}>
                                            <GripVertical size={20} />
                                        </div>
                                    )}

                                    {/* Rank Number / Dropdown */}
                                    <div className="relative">
                                        {!pool.isLocked ? (
                                            <select
                                                value={rank}
                                                onChange={(e) => moveToRank(index, parseInt(e.target.value))}
                                                className={`appearance-none bg-page border-[1.5px] ${rank >= 11 ? 'border-gold-500/50 text-gold-600 dark:text-gold-400' : rank <= 4 ? 'border-brandred-500/50 text-brandred-600' : 'border-line text-muted'} rounded-lg py-1 pl-3 pr-8 font-display font-bold text-xl num w-20 text-center outline-none focus:border-navy-600 cursor-pointer`}
                                            >
                                                {Array.from({ length: 14 }, (_, i) => 14 - i).map(r => (
                                                    <option key={r} value={r} className="bg-page text-[color:var(--text)] font-bold">
                                                        #{r}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className={`text-xl font-display font-bold num w-20 text-center ${rankColor}`}>
                                                {rank}
                                            </div>
                                        )}
                                        {/* Custom Down Arrow for Select */}
                                        {!pool.isLocked && (
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-faint">
                                                <ChevronDown size={14} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Team Info + Logo */}
                                    <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                                        {logoUrl && (
                                            <img src={logoUrl} alt={team.name} className="w-10 h-10 md:w-12 md:h-12 object-contain drop-shadow-md bg-navy-900/5 dark:bg-white/5 rounded-full p-1 flex-shrink-0" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="font-body font-bold text-[color:var(--text)] text-base md:text-lg flex items-center gap-2 truncate">
                                                {team.seed ? <span className="text-muted text-sm num hidden sm:inline">#{team.seed}</span> : ''}
                                                <span className="truncate">{team.name}</span>
                                                {team.eliminated && (
                                                    <span className="text-[10px] md:text-xs bg-brandred-600/10 text-brandred-600 px-1.5 py-0.5 rounded uppercase ml-auto md:ml-2 flex-shrink-0 border border-brandred-600/30 font-display font-bold tracking-[0.08em]">Eliminated</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-faint font-display font-bold uppercase tracking-[0.08em] truncate">{team.conference}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Tiebreaker Input */}
                    <div className="bg-card border border-line p-6 rounded-xl mt-8 shadow-card">
                        <label className="block text-muted font-display font-bold uppercase text-[12px] tracking-[0.08em] mb-2">
                            Tiebreaker: Total Super Bowl Points
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                value={tiebreaker}
                                onChange={(e) => setTiebreaker(Number(e.target.value))}
                                disabled={pool.isLocked}
                                className="w-full bg-page border-[1.5px] border-line rounded-md px-4 py-3 font-body text-[color:var(--text)] text-lg font-bold num focus:border-navy-600 focus:bg-surface outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="e.g. 45"
                            />
                        </div>
                        <p className="text-xs font-body text-muted mt-2">Combined score of both teams in the Super Bowl.</p>
                    </div>

                    {/* Error / Success Messages */}
                    {error && (
                        <div className="p-4 bg-brandred-600/10 border border-brandred-600/25 text-brandred-600 rounded-lg text-center font-display font-bold uppercase tracking-[0.02em] animate-in fade-in">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="p-4 bg-[#E4F5EC] border border-[#BEE7D0] text-[#0F7B4A] rounded-lg text-center font-display font-bold uppercase tracking-[0.02em] animate-in fade-in flex items-center justify-center gap-2">
                            <Check size={20} /> Picks Saved Successfully!
                        </div>
                    )}

                    {/* Submit Button */}
                    {!pool.isLocked && (
                        <div className="sticky bottom-4 z-10 pt-4 pb-2">
                            <Button
                                size="lg"
                                onClick={handleInitSave}
                                disabled={isSubmitting}
                                className="w-full rounded-xl text-lg"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader className="animate-spin" size={24} /> Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save size={24} /> Save Picks
                                    </>
                                )}
                            </Button>
                        </div>
                    )}
                </div>

                {/* RIGHT COLUMN: Schedule/Info Display (Desktop only mostly) */}
                <div className="order-first lg:order-last">
                    <ScheduleDisplay teams={pool.teams} />
                </div>
            </div>

            {/* CONFIRMATION MODAL */}
            {isConfirming && (
                <OverlayRoot id="playoff-confirm-submission" label="Confirm submission" onEscape={() => { if (!isSubmitting) setIsConfirming(false); }} className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-card border border-line p-6 rounded-xl shadow-panel max-w-md w-full">
                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                            {isSubmitting ? <Loader className="animate-spin text-gold-500" /> : <Check className="text-[#0F7B4A]" />}
                            Confirm Submission
                        </h3>

                        <div className="bg-surface border border-line rounded-lg p-4 mb-4 space-y-3">
                            <p className="text-[color:var(--text)] font-body text-sm">
                                You are about to submit your rankings for the <span className="text-gold-600 dark:text-gold-400 font-bold">{pool.name}</span>.
                                You can update these picks anytime until the pool locks.
                            </p>

                            <div className="border-t border-line pt-3 space-y-2">
                                <div className="flex justify-between px-1 font-body">
                                    <span className="text-muted">Tiebreaker Prediction:</span>
                                    <span className="text-[color:var(--text)] num font-bold">{tiebreaker} pts</span>
                                </div>
                                {(pool.settings?.entryFee ?? 0) > 0 && (
                                    <div className="flex justify-between items-center text-gold-700 dark:text-gold-400 bg-gold-500/10 px-3 py-2 rounded-lg border border-gold-500/25">
                                        <span className="font-display font-bold uppercase tracking-[0.05em] text-sm">Entry Cost:</span>
                                        <span className="num font-display font-bold text-lg">${pool.settings.entryFee}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* LIABILITY DISCLAIMER */}
                        <div className="mb-6">
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <div className="relative flex items-center mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={liabilityAccepted}
                                        onChange={(e) => setLiabilityAccepted(e.target.checked)}
                                        className="peer h-6 w-6 cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-line bg-page transition-all checked:border-navy-800 checked:bg-navy-800 hover:border-navy-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-1"
                                    />
                                    <Check size={16} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                                </div>
                                <p className="text-xs font-body text-muted leading-relaxed group-hover:text-[color:var(--text)] transition-colors">
                                    By checking this box and submitting, I acknowledge and agree that MarchMeleePools does not administer, hold, or distribute prizes. Any prizes are provided solely by the Pool Manager/Organizer. Any questions, disputes, or claims related to prizes or pool outcomes must be resolved directly between the user and the Pool Manager/Organizer.
                                </p>
                            </label>
                        </div>

                        <div className="flex gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => setIsConfirming(false)}
                                disabled={isSubmitting}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleFinalizeSubmission}
                                disabled={!liabilityAccepted || isSubmitting}
                                className="flex-1"
                            >
                                {isSubmitting ? 'Submitting...' : 'Confirm & Save'}
                            </Button>
                        </div>
                    </div>
                </OverlayRoot>
            )}

            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
                initialMode="register"
            />
        </div>
    );
};
