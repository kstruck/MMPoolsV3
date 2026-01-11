import React, { useState, useEffect } from 'react';
import { GripVertical, Check, Save, Loader, AlertTriangle, Lock, ChevronUp, ChevronDown } from 'lucide-react';
import type { PlayoffPool, PlayoffTeam, User } from '../../types';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { getTeamLogo } from '../../constants';
import { ScheduleDisplay } from './ScheduleDisplay';
import { AuthModal } from '../modals/AuthModal';

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
            console.log("Submitting picks:", { poolId: pool.id, entryId, rankings: rankingsMap });

            setSuccess(true);
            setIsConfirming(false); // Close modal
            if (onSaved) onSaved();

            // Clear success after 3s
            setTimeout(() => setSuccess(false), 3000);

        } catch (err: any) {
            console.error(err);
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
                    className="mb-4 text-slate-400 hover:text-white flex items-center gap-2 text-sm font-bold"
                >
                    &larr; Back to Entry List
                </button>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

                {/* LEFT COLUMN: Ranking Interface (Spans 2 cols on lg) */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Instructions */}
                    <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-4 flex gap-3">
                        <AlertTriangle className="text-indigo-400 shrink-0" size={24} />
                        <div className="text-sm text-slate-300">
                            <p className="font-bold text-indigo-400 mb-1">How to Rank</p>
                            <p>Drag and drop, use the arrows, or <strong>select a rank number</strong> to set your order. The top team (Rank 14) earns the most points.</p>
                        </div>
                    </div>

                    {pool.isLocked && (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4 flex items-center gap-3 text-rose-400 font-bold mb-4">
                            <Lock size={20} />
                            Picks are locked. No further changes allowed.
                        </div>
                    )}

                    {/* Entry Name Input */}
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl mb-4">
                        <label className="block text-slate-400 text-xs font-bold uppercase mb-2">
                            Entry Name
                        </label>
                        <input
                            type="text"
                            value={entryName}
                            onChange={(e) => setEntryName(e.target.value)}
                            disabled={pool.isLocked}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
                            placeholder="My Winning Entry"
                        />
                    </div>

                    {/* Draggable List */}
                    <div className="space-y-2">
                        {rankedTeams.map((team, index) => {
                            const rank = 14 - index;
                            let rankColor = "text-slate-400";
                            if (rank >= 11) rankColor = "text-emerald-400"; // Top tier
                            if (rank <= 4) rankColor = "text-rose-400"; // Bottom tier

                            const logoUrl = getTeamLogo(team.name) || getTeamLogo(team.id);

                            return (
                                <div
                                    key={team.id}
                                    draggable={!pool.isLocked}
                                    onDragStart={() => handleDragStart(index)}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDragEnd={handleDragEnd}
                                    className={`
                                        flex items-center gap-3 p-3 md:p-4 rounded-lg border transition-all select-none
                                        ${pool.isLocked ? 'bg-slate-900/50 border-slate-800 cursor-default opacity-75' : 'bg-slate-800 border-slate-700 hover:border-slate-500 cursor-grab active:cursor-grabbing hover:bg-slate-750'}
                                        ${draggedIndex === index ? 'opacity-50 ring-2 ring-indigo-500' : ''}
                                    `}
                                >
                                    {/* Mobile Sort Controls */}
                                    {!pool.isLocked && (
                                        <div className="flex flex-col gap-1 md:mr-2">
                                            <button
                                                onClick={(e) => { e.preventDefault(); moveTeam(index, 'up'); }}
                                                disabled={index === 0}
                                                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
                                            >
                                                <ChevronUp size={20} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.preventDefault(); moveTeam(index, 'down'); }}
                                                disabled={index === rankedTeams.length - 1}
                                                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
                                            >
                                                <ChevronDown size={20} />
                                            </button>
                                        </div>
                                    )}

                                    {/* Grip Handle (Hidden on small mobile, kept for desktop) */}
                                    {!pool.isLocked && (
                                        <div className="text-slate-600 hidden md:block" style={{ touchAction: 'none' }}>
                                            <GripVertical size={20} />
                                        </div>
                                    )}

                                    {/* Rank Number / Dropdown */}
                                    <div className="relative">
                                        {!pool.isLocked ? (
                                            <select
                                                value={rank}
                                                onChange={(e) => moveToRank(index, parseInt(e.target.value))}
                                                className={`appearance-none bg-slate-900 border ${rank >= 11 ? 'border-emerald-500/50 text-emerald-400' : rank <= 4 ? 'border-rose-500/50 text-rose-400' : 'border-slate-700 text-slate-400'} rounded-lg py-1 pl-3 pr-8 font-black text-xl w-20 text-center outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer`}
                                            >
                                                {Array.from({ length: 14 }, (_, i) => 14 - i).map(r => (
                                                    <option key={r} value={r} className="bg-slate-900 text-white font-bold">
                                                        #{r}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className={`text-xl font-black w-20 text-center ${rankColor}`}>
                                                {rank}
                                            </div>
                                        )}
                                        {/* Custom Down Arrow for Select */}
                                        {!pool.isLocked && (
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                                <ChevronDown size={14} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Team Info + Logo */}
                                    <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                                        {logoUrl && (
                                            <img src={logoUrl} alt={team.name} className="w-10 h-10 md:w-12 md:h-12 object-contain drop-shadow-md bg-white/5 rounded-full p-1 flex-shrink-0" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-white text-base md:text-lg flex items-center gap-2 truncate">
                                                {team.seed ? <span className="text-slate-400 text-sm hidden sm:inline">#{team.seed}</span> : ''}
                                                <span className="truncate">{team.name}</span>
                                                {team.eliminated && (
                                                    <span className="text-[10px] md:text-xs bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded uppercase ml-auto md:ml-2 flex-shrink-0 border border-rose-500/30 font-bold">Eliminated</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider truncate">{team.conference}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Tiebreaker Input */}
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl mt-8">
                        <label className="block text-slate-400 text-sm font-bold uppercase mb-2">
                            Tiebreaker: Total Super Bowl Points
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                value={tiebreaker}
                                onChange={(e) => setTiebreaker(Number(e.target.value))}
                                disabled={pool.isLocked}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white text-lg font-bold focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder="e.g. 45"
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-2">Combined score of both teams in the Super Bowl.</p>
                    </div>

                    {/* Error / Success Messages */}
                    {error && (
                        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-center font-bold animate-in fade-in">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-center font-bold animate-in fade-in flex items-center justify-center gap-2">
                            <Check size={20} /> Picks Saved Successfully!
                        </div>
                    )}

                    {/* Submit Button */}
                    {!pool.isLocked && (
                        <div className="sticky bottom-4 z-10 pt-4 pb-2">
                            <button
                                onClick={handleInitSave}
                                disabled={isSubmitting}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 px-6 rounded-xl text-lg shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                            </button>
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
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-800 border border-slate-600 p-6 rounded-xl shadow-2xl max-w-md w-full">
                        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            {isSubmitting ? <Loader className="animate-spin text-emerald-400" /> : <Check className="text-emerald-400" />}
                            Confirm Submission
                        </h3>

                        <div className="bg-slate-900 rounded-lg p-4 mb-4 space-y-3">
                            <p className="text-slate-300 text-sm">
                                You are about to submit your rankings for the <span className="text-emerald-400 font-bold">{pool.name}</span>.
                                You can update these picks anytime until the pool locks.
                            </p>

                            <div className="border-t border-slate-700 pt-3 space-y-2">
                                <div className="flex justify-between px-1">
                                    <span className="text-slate-400">Tiebreaker Prediction:</span>
                                    <span className="text-white font-mono font-bold">{tiebreaker} pts</span>
                                </div>
                                {(pool.settings?.entryFee ?? 0) > 0 && (
                                    <div className="flex justify-between items-center text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                                        <span className="font-bold text-sm">Entry Cost:</span>
                                        <span className="font-mono font-bold text-lg">${pool.settings.entryFee}</span>
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
                                        className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-slate-500 bg-slate-900 transition-all checked:border-emerald-500 checked:bg-emerald-500 hover:border-emerald-400"
                                    />
                                    <Check size={14} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                                </div>
                                <p className="text-xs text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                                    By checking this box and submitting, I acknowledge and agree that MarchMeleePools does not administer, hold, or distribute prizes. Any prizes are provided solely by the Pool Manager/Organizer. Any questions, disputes, or claims related to prizes or pool outcomes must be resolved directly between the user and the Pool Manager/Organizer.
                                </p>
                            </label>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsConfirming(false)}
                                disabled={isSubmitting}
                                className="flex-1 py-3 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleFinalizeSubmission}
                                disabled={!liabilityAccepted || isSubmitting}
                                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all"
                            >
                                {isSubmitting ? 'Submitting...' : 'Confirm & Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
                initialMode="register"
            />
        </div>
    );
};
