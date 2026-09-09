import { logger } from '../../utils/logger';
import React, { useState, useEffect } from 'react';
import type { GameState, PropCard } from '../../types';
import { Check, Trophy, Target } from 'lucide-react';
import { dbService } from '../../services/dbService';
import { RankChip, StatTile } from '../ui';

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
            logger.error('Grading failed:', e);
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
        <div className="space-y-6 font-body">
            {/* Stats Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatTile label="Questions" value={questions.length} className="text-center" />
                <StatTile label="Graded" value={gradedCount} accent="gold" className="text-center" />
                <StatTile label="Total Pts" value={totalPossiblePoints} accent="gold" className="text-center" />
                <StatTile label="Entries" value={propCards.length} className="text-center" />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Grading Panel */}
                <div className="space-y-4">
                    <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <Target className="text-navy-700 dark:text-gold-400" size={20} /> Grade Questions
                    </h3>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                        {questions.map((q, idx) => (
                            <div key={q.id} className={`bg-card p-4 rounded-xl border ${q.correctOption !== undefined ? 'border-[#0F7B4A]/50' : 'border-line'}`}>
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="bg-navy-600/15 text-navy-700 dark:text-gold-400 px-2 py-0.5 rounded text-xs font-display font-bold num">#{idx + 1}</span>
                                        <span className="text-[color:var(--text)] font-medium">{q.text}</span>
                                    </div>
                                    <span className="text-gold-700 dark:text-gold-400 text-xs font-display font-bold num">{q.points || 1} pts</span>
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
                                                className={`px-3 py-2 text-sm rounded-lg border flex items-center justify-between transition-ui duration-150
                                                    ${isCorrect
                                                        ? 'bg-[#E4F5EC] border-[#0F7B4A] text-[#0F7B4A]'
                                                        : 'bg-surface border-line text-muted hover:border-navy-600 hover:text-[color:var(--text)]'}
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
                    <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <Trophy className="text-gold-500" size={20} /> Live Leaderboard
                    </h3>
                    <div className="bg-card rounded-xl border border-line shadow-card overflow-hidden">
                        <div className="grid grid-cols-12 gap-2 p-3 font-display font-bold uppercase text-[12px] tracking-[0.08em] text-muted border-b border-line bg-surface">
                            <div className="col-span-1">Rank</div>
                            <div className="col-span-5">Player</div>
                            <div className="col-span-2 text-center">Score</div>
                            <div className="col-span-2 text-center">Correct</div>
                            <div className="col-span-2 text-center">TB</div>
                        </div>
                        <div className="divide-y divide-[color:var(--line)] max-h-[550px] overflow-y-auto">
                            {leaderboard.length === 0 ? (
                                <div className="p-8 text-center text-muted">No entries yet</div>
                            ) : (
                                leaderboard.map((card, idx) => (
                                    <div key={card.id} className={`grid grid-cols-12 gap-2 p-3 items-center hover:bg-[color:var(--page)] transition-colors ${idx < 3 ? 'bg-gold-500/5' : ''}`}>
                                        <div className="col-span-1">
                                            <RankChip rank={idx + 1} />
                                        </div>
                                        <div className="col-span-5">
                                            <div className="text-[color:var(--text)] font-medium truncate">{card.userName || 'Anonymous'}</div>
                                        </div>
                                        <div className="col-span-2 text-center num">
                                            <span className="text-gold-600 dark:text-gold-400 font-bold">{card.score}</span>
                                            <span className="text-faint">/{totalPossiblePoints}</span>
                                        </div>
                                        <div className="col-span-2 text-center num">
                                            <span className="text-[color:var(--text)]">{card.correctCount}</span>
                                            <span className="text-faint">/{questions.length}</span>
                                        </div>
                                        <div className="col-span-2 text-center text-muted num">
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
