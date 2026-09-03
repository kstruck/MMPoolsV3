import React from 'react';
import type { PropQuestion, PropCard } from '../../types';
import { BarChart } from 'lucide-react';
import { Badge, StatTile } from '../ui';

interface PropStatsProps {
    questions: PropQuestion[];
    cards: PropCard[];
}

export const PropStats: React.FC<PropStatsProps> = ({ questions, cards }) => {
    const totalEntries = cards.length;

    if (totalEntries === 0) {
        return (
            <div className="p-8 text-center text-muted bg-card rounded-xl border border-line font-body">
                <BarChart className="mx-auto mb-3 opacity-50" size={32} />
                <p>No entries yet. Stats will appear once players submit cards.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in font-body">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Summary Card */}
                <StatTile label="Total Entries" value={totalEntries} />
            </div>

            <div className="grid gap-6">
                {questions.map((q, qIdx) => {
                    // Calculate consensus
                    const counts: Record<number, number> = {};
                    q.options.forEach((_, idx) => counts[idx] = 0);

                    cards.forEach(card => {
                        const answer = card.answers[q.id];
                        if (answer !== undefined && counts[answer] !== undefined) {
                            counts[answer]++;
                        }
                    });

                    return (
                        <div key={q.id} className="bg-card border border-line rounded-xl shadow-card p-5">
                            <h4 className="font-bold text-[color:var(--text)] mb-4 flex items-start gap-3">
                                <span className="text-navy-700 dark:text-gold-400 text-sm mt-0.5 num">#{qIdx + 1}</span>
                                {q.text}
                            </h4>

                            <div className="space-y-3">
                                {q.options.map((opt, optIdx) => {
                                    const count = counts[optIdx] || 0;
                                    const percentage = totalEntries > 0 ? Math.round((count / totalEntries) * 100) : 0;
                                    const isCorrect = q.correctOption === optIdx;

                                    return (
                                        <div key={optIdx} className="relative">
                                            <div className="flex justify-between text-sm mb-1 relative z-10">
                                                <span className={`font-medium ${isCorrect ? 'text-[#0F7B4A]' : 'text-[color:var(--text)]'} flex items-center gap-2`}>
                                                    {opt}
                                                    {isCorrect && <Badge status="winner" className="text-[10px] px-1.5 py-[3px]" />}
                                                </span>
                                                <span className="text-muted num">
                                                    {percentage}% <span className="text-faint text-xs">({count})</span>
                                                </span>
                                            </div>
                                            <div className="h-2 bg-line rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full w-full origin-left rounded-full transition-transform duration-300 ease-out ${isCorrect ? 'bg-[#0F7B4A]' : 'bg-navy-600/60 dark:bg-gold-500/60'}`}
                                                    style={{ transform: `scaleX(${Math.min(percentage, 100) / 100})` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
