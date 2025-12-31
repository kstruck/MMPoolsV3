import React, { useState, useEffect } from 'react';
import type { GameState, PropCard } from '../../types';
import { Check, Trophy, Award, Target } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface PropGradingDashboardProps {
    gameState: GameState;
}

export const PropGradingDashboard: React.FC<PropGradingDashboardProps> = ({ gameState }) => {
    const [propCards, setPropCards] = useState<(PropCard & { id: string })[]>([]);
    const [isGrading, setIsGrading] = useState<string | null>(null);

    const questions = gameState.props?.questions || [];

    useEffect(() => {
        if (!gameState.id) return;
        const unsub = dbService.subscribeToAllPropCards(gameState.id, (cards) => {
            setPropCards(cards as any);
        });
        return () => unsub();
    }, [gameState.id]);

    const handleGrade = async (qId: string, optIdx: number) => {
        setIsGrading(qId);
        try {
            await dbService.gradeProp(gameState.id, qId, optIdx);
        } catch (e) {
            console.error('Grading failed:', e);
        } finally {
            setIsGrading(null);
        }
    };

    // Calculate leaderboard with correct count
    const leaderboard = propCards
        .map(card => {
            let score = 0;
            let correctCount = 0;
            questions.forEach(q => {
                if (q.correctOption !== undefined && card.answers?.[q.id] === q.correctOption) {
                    score += (q.points || 1);
                    correctCount++;
                }
            });
            return { ...card, score, correctCount };
        })
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            // Tiebreaker: closest to actual (if we had actual value)
            return (a.tiebreakerVal || 0) - (b.tiebreakerVal || 0);
        });

    const totalPossiblePoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const gradedCount = questions.filter(q => q.correctOption !== undefined).length;

    return (
        <div className="space-y-6">
            {/* Stats Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center">
                    <div className="text-3xl font-bold text-white">{questions.length}</div>
                    <div className="text-xs text-slate-500 uppercase">Questions</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center">
                    <div className="text-3xl font-bold text-emerald-400">{gradedCount}</div>
                    <div className="text-xs text-slate-500 uppercase">Graded</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center">
                    <div className="text-3xl font-bold text-amber-400">{totalPossiblePoints}</div>
                    <div className="text-xs text-slate-500 uppercase">Total Pts</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center">
                    <div className="text-3xl font-bold text-indigo-400">{propCards.length}</div>
                    <div className="text-xs text-slate-500 uppercase">Entries</div>
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Grading Panel */}
                <div className="space-y-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Target className="text-indigo-400" size={20} /> Grade Questions
                    </h3>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                        {questions.map((q, idx) => (
                            <div key={q.id} className={`bg-slate-800 p-4 rounded-xl border ${q.correctOption !== undefined ? 'border-emerald-500/50' : 'border-slate-700'}`}>
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded text-xs font-bold">#{idx + 1}</span>
                                        <span className="text-white font-medium">{q.text}</span>
                                    </div>
                                    <span className="text-amber-400 text-xs font-bold">{q.points || 1} pts</span>
                                </div>
                                <div className={`grid gap-2 ${q.options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                                    {q.options.map((opt, optIdx) => {
                                        const isCorrect = q.correctOption === optIdx;
                                        const isLoading = isGrading === q.id;
                                        return (
                                            <button
                                                key={optIdx}
                                                onClick={() => handleGrade(q.id, optIdx)}
                                                disabled={isLoading}
                                                className={`px-3 py-2 text-sm rounded-lg border flex items-center justify-between transition-all
                                                    ${isCorrect
                                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                                                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-white'}
                                                    ${isLoading ? 'opacity-50 cursor-wait' : ''}
                                                `}
                                            >
                                                <span className="truncate">{opt}</span>
                                                {isCorrect && <Check size={14} className="flex-shrink-0 ml-1" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Live Leaderboard */}
                <div className="space-y-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Trophy className="text-amber-400" size={20} /> Live Leaderboard
                    </h3>
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="grid grid-cols-12 gap-2 p-3 text-xs font-bold text-slate-500 uppercase border-b border-slate-700 bg-slate-900/50">
                            <div className="col-span-1">Rank</div>
                            <div className="col-span-5">Player</div>
                            <div className="col-span-2 text-center">Score</div>
                            <div className="col-span-2 text-center">Correct</div>
                            <div className="col-span-2 text-center">TB</div>
                        </div>
                        <div className="divide-y divide-slate-700/50 max-h-[550px] overflow-y-auto">
                            {leaderboard.length === 0 ? (
                                <div className="p-8 text-center text-slate-500">No entries yet</div>
                            ) : (
                                leaderboard.map((card, idx) => (
                                    <div key={card.id} className={`grid grid-cols-12 gap-2 p-3 items-center hover:bg-slate-700/30 ${idx < 3 ? 'bg-amber-500/5' : ''}`}>
                                        <div className="col-span-1">
                                            {idx === 0 && <Trophy size={16} className="text-amber-400" />}
                                            {idx === 1 && <Award size={16} className="text-slate-300" />}
                                            {idx === 2 && <Award size={16} className="text-amber-600" />}
                                            {idx > 2 && <span className="text-slate-500 text-sm">{idx + 1}</span>}
                                        </div>
                                        <div className="col-span-5">
                                            <div className="text-white font-medium truncate">{card.userName || 'Anonymous'}</div>
                                        </div>
                                        <div className="col-span-2 text-center">
                                            <span className="text-emerald-400 font-bold">{card.score}</span>
                                            <span className="text-slate-600">/{totalPossiblePoints}</span>
                                        </div>
                                        <div className="col-span-2 text-center">
                                            <span className="text-indigo-400">{card.correctCount}</span>
                                            <span className="text-slate-600">/{questions.length}</span>
                                        </div>
                                        <div className="col-span-2 text-center text-slate-400">
                                            {card.tiebreakerVal || '-'}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
