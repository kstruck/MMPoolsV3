import React from 'react';
import type { PropQuestion, PropCard } from '../../types';
import { BarChart, Users } from 'lucide-react';

interface PropStatsProps {
    questions: PropQuestion[];
    cards: PropCard[];
}

export const PropStats: React.FC<PropStatsProps> = ({ questions, cards }) => {
    const totalEntries = cards.length;

    if (totalEntries === 0) {
        return (
            <div className="p-8 text-center text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800">
                <BarChart className="mx-auto mb-3 opacity-50" size={32} />
                <p>No entries yet. Stats will appear once players submit cards.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Summary Card */}
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold uppercase">Total Entries</p>
                        <p className="text-2xl font-bold text-white">{totalEntries}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                        <Users size={20} />
                    </div>
                </div>
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
                        <div key={q.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <h4 className="font-bold text-white mb-4 flex items-start gap-3">
                                <span className="text-indigo-400 text-sm mt-0.5">#{qIdx + 1}</span>
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
                                                <span className={`font-medium ${isCorrect ? 'text-emerald-400' : 'text-slate-300'} flex items-center gap-2`}>
                                                    {opt}
                                                    {isCorrect && <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase">Winner</span>}
                                                </span>
                                                <span className="text-slate-400 font-mono">
                                                    {percentage}% <span className="text-slate-600 text-xs">({count})</span>
                                                </span>
                                            </div>
                                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-1000 ${isCorrect ? 'bg-emerald-500' : 'bg-indigo-500/50'}`}
                                                    style={{ width: `${percentage}%` }}
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
