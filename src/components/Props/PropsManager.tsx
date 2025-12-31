import React, { useState, useEffect } from 'react';
import type { GameState, PropQuestion, PropSeed, PropCard } from '../../types';
import { Plus, Trash2, Check, Download, Save, X, Edit2, Star, Zap, Users } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface PropsManagerProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
}

export const PropsManager: React.FC<PropsManagerProps> = ({ gameState, updateConfig }) => {
    const [newQuestionText, setNewQuestionText] = useState('');
    const [options, setOptions] = useState<string[]>(['', '']);
    const [points, setPoints] = useState(1);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Seed State
    const [seeds, setSeeds] = useState<PropSeed[]>([]);
    const [showSeedPanel, setShowSeedPanel] = useState(false);

    useEffect(() => {
        const unsub = dbService.subscribeToPropSeeds(setSeeds);
        return () => unsub();
    }, []);

    // Prop Cards State (for admin management)
    const [propCards, setPropCards] = useState<(PropCard & { id: string })[]>([]);
    const [showManageCards, setShowManageCards] = useState(false);

    useEffect(() => {
        if (!gameState.id) return;
        const unsub = dbService.subscribeToAllPropCards(gameState.id, (cards) => {
            setPropCards(cards as any);
        });
        return () => unsub();
    }, [gameState.id]);

    const handleImportSeed = (seed: PropSeed) => {
        setNewQuestionText(seed.text);
        setOptions(seed.options.slice(0, 4)); // Max 4 options
        setPoints(1);
        setShowSeedPanel(false);
    };

    const questions = gameState.props?.questions || [];
    const propsEnabled = gameState.props?.enabled || false;
    const propCost = gameState.props?.cost || 5;

    const handleAddOption = () => {
        if (options.length < 4) {
            setOptions([...options, '']);
        }
    };

    const handleRemoveOption = (idx: number) => {
        if (options.length > 2) {
            setOptions(options.filter((_, i) => i !== idx));
        }
    };

    const handleOptionChange = (idx: number, value: string) => {
        const newOptions = [...options];
        newOptions[idx] = value;
        setOptions(newOptions);
    };

    const handleAddQuestion = () => {
        const validOptions = options.filter(o => o.trim() !== '');
        console.log('[PropsManager] handleAddQuestion called', { newQuestionText, validOptions, points });

        if (!newQuestionText || validOptions.length < 2) {
            console.log('[PropsManager] Validation FAILED - question text or options missing');
            return;
        }

        let updatedQuestions: PropQuestion[];

        if (editingId) {
            updatedQuestions = questions.map(q => q.id === editingId ? {
                ...q,
                text: newQuestionText,
                options: validOptions,
                points: points
            } : q);
        } else {
            // Note: Don't include correctOption - Firestore rejects undefined values
            const newQ: PropQuestion = {
                id: crypto.randomUUID(),
                text: newQuestionText,
                options: validOptions,
                points: points,
                type: 'standard'
            };
            updatedQuestions = [...questions, newQ];
        }

        console.log('[PropsManager] Calling updateConfig with:', { props: { enabled: propsEnabled, cost: propCost, questions: updatedQuestions } });

        updateConfig({
            props: {
                enabled: propsEnabled,
                cost: propCost,
                questions: updatedQuestions
            }
        });

        resetForm();
    };

    const resetForm = () => {
        setNewQuestionText('');
        setOptions(['', '']);
        setPoints(1);
        setEditingId(null);
    };

    const handleEditClick = (q: PropQuestion) => {
        setEditingId(q.id);
        setNewQuestionText(q.text);
        setOptions(q.options.length > 0 ? [...q.options] : ['', '']);
        setPoints(q.points || 1);
        setShowSeedPanel(false);
    };

    const handleRemoveQuestion = (id: string) => {
        updateConfig({
            props: {
                enabled: propsEnabled,
                cost: propCost,
                questions: questions.filter(q => q.id !== id)
            }
        });
    };

    const handleToggleEnabled = () => {
        updateConfig({
            props: {
                enabled: !propsEnabled,
                cost: propCost,
                questions
            }
        });
    };

    const handleCostChange = (val: number) => {
        updateConfig({
            props: {
                enabled: propsEnabled,
                cost: val,
                questions
            }
        });
    };

    const handleGrade = async (qId: string, optionIdx: number) => {
        await dbService.gradeProp(gameState.id, qId, optionIdx);
    };

    return (
        <div className="space-y-6">
            {/* Header Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div>
                    <h3 className="text-white font-bold">Enable Prop Bets</h3>
                    <p className="text-slate-400 text-sm">Allow players to buy a side-hustle card.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-300">$</span>
                        <input
                            type="number"
                            value={propCost}
                            onChange={(e) => handleCostChange(Number(e.target.value))}
                            className="w-20 bg-slate-900 border border-slate-700 text-white px-2 py-1 rounded"
                        />
                    </div>
                    <button
                        onClick={handleToggleEnabled}
                        className={`w-12 h-6 rounded-full transition-colors relative ${propsEnabled ? 'bg-indigo-500' : 'bg-slate-600'}`}
                    >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${propsEnabled ? 'left-7' : 'left-1'}`} />
                    </button>
                </div>
            </div>

            {propsEnabled && (
                <div className="space-y-4">
                    {/* Stats Bar */}
                    <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                        <div className="flex items-center gap-4">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-white">{questions.length}</div>
                                <div className="text-xs text-slate-500 uppercase">Questions</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-emerald-400">{questions.reduce((sum, q) => sum + (q.points || 1), 0)}</div>
                                <div className="text-xs text-slate-500 uppercase">Total Pts</div>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowSeedPanel(!showSeedPanel)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2"
                        >
                            <Download size={16} /> Import from Seeds
                        </button>
                    </div>

                    {/* Seed Import Panel */}
                    {showSeedPanel && (
                        <div className="bg-indigo-900/30 border border-indigo-500/30 rounded-lg p-4">
                            <h4 className="text-indigo-300 font-bold mb-3 flex items-center gap-2">
                                <Zap size={16} /> Quick Import from Seed Library
                            </h4>
                            {seeds.length === 0 ? (
                                <p className="text-slate-400 text-sm">No seeds available. SuperAdmin can add seeds in the dashboard.</p>
                            ) : (
                                <div className="grid gap-2 max-h-48 overflow-y-auto">
                                    {seeds.map(seed => (
                                        <button
                                            key={seed.id}
                                            onClick={() => handleImportSeed(seed)}
                                            className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-lg flex justify-between items-center"
                                        >
                                            <span className="text-white">{seed.text}</span>
                                            <span className="text-xs text-slate-500">{seed.options.length} options</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Add New Question Form */}
                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                        <h4 className="text-sm font-bold text-slate-300 mb-3">{editingId ? 'Edit Prop' : 'Add New Prop'}</h4>
                        <div className="grid gap-3">
                            <input
                                type="text"
                                placeholder="Question (e.g. Who scores first?)"
                                className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded"
                                value={newQuestionText}
                                onChange={e => setNewQuestionText(e.target.value)}
                            />

                            {/* Dynamic Options */}
                            <div className="space-y-2">
                                {options.map((opt, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                                            className="flex-1 bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded"
                                            value={opt}
                                            onChange={e => handleOptionChange(idx, e.target.value)}
                                        />
                                        {options.length > 2 && (
                                            <button
                                                onClick={() => handleRemoveOption(idx)}
                                                className="px-3 text-rose-400 hover:text-rose-300"
                                            >
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {options.length < 4 && (
                                    <button
                                        onClick={handleAddOption}
                                        className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                    >
                                        <Plus size={14} /> Add Option (max 4)
                                    </button>
                                )}
                            </div>

                            {/* Points Input */}
                            <div className="flex items-center gap-3 bg-slate-800/50 p-3 rounded border border-slate-700">
                                <Star size={16} className="text-amber-400" />
                                <span className="text-slate-300 text-sm">Points if correct:</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={points}
                                    onChange={e => setPoints(Math.max(1, Math.min(10, Number(e.target.value))))}
                                    className="w-16 bg-slate-900 border border-slate-600 text-white px-2 py-1 rounded text-center"
                                />
                            </div>
                        </div>

                        <div className="flex gap-2 mt-4">
                            {editingId && (
                                <button
                                    onClick={resetForm}
                                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded flex items-center justify-center gap-2"
                                >
                                    <X size={16} /> Cancel
                                </button>
                            )}
                            <button
                                onClick={handleAddQuestion}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded flex items-center justify-center gap-2"
                            >
                                {editingId ? <Save size={16} /> : <Plus size={16} />}
                                {editingId ? 'Update Prop' : 'Add Prop'}
                            </button>
                        </div>
                    </div>

                    {/* Question List */}
                    {questions.length > 0 && (
                        <div className="space-y-3">
                            <h4 className="text-sm font-bold text-slate-400 uppercase">Your Questions ({questions.length})</h4>
                            {questions.map((q, idx) => (
                                <div key={q.id} className="bg-slate-800 p-4 rounded-lg flex flex-col gap-3">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-start gap-3">
                                            <span className="bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded text-sm font-bold">#{idx + 1}</span>
                                            <div>
                                                <span className="text-white font-medium">{q.text}</span>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-amber-400 flex items-center gap-1">
                                                        <Star size={12} /> {q.points || 1} pts
                                                    </span>
                                                    <span className="text-xs text-slate-500">• {q.options.length} options</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleEditClick(q)} className="text-indigo-400 hover:text-indigo-300">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={() => handleRemoveQuestion(q.id)} className="text-rose-400 hover:text-rose-300">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Grading UI - shows all options */}
                                    <div className={`grid gap-2 mt-2 ${q.options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                                        {q.options.map((opt, optIdx) => (
                                            <button
                                                key={optIdx}
                                                onClick={() => handleGrade(q.id, optIdx)}
                                                className={`px-3 py-2 text-sm rounded border flex items-center justify-between
                                                    ${q.correctOption === optIdx
                                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                                                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}
                                                `}
                                            >
                                                <span className="truncate">{opt}</span>
                                                {q.correctOption === optIdx && <Check size={14} className="flex-shrink-0 ml-1" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Manage Entries (Admin) */}
                    {propCards.length > 0 && (
                        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                                    <Users size={16} /> Manage Entries ({propCards.length})
                                </h4>
                                <button
                                    onClick={() => setShowManageCards(!showManageCards)}
                                    className="text-xs text-indigo-400 hover:text-indigo-300"
                                >
                                    {showManageCards ? 'Hide' : 'Show'}
                                </button>
                            </div>
                            {showManageCards && (
                                <div className="space-y-2">
                                    {propCards.map((card) => (
                                        <div key={card.id} className="bg-slate-800 p-3 rounded-lg flex items-center justify-between">
                                            <div>
                                                <div className="text-white font-medium">{card.userName || card.userId}</div>
                                                <div className="text-xs text-slate-500">
                                                    Score: {card.score || 0} • Answers: {Object.keys(card.answers || {}).length} • TB: {card.tiebreakerVal || 'N/A'}
                                                </div>
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    if (confirm(`Delete prop card for ${card.userName || card.userId}?`)) {
                                                        await dbService.deletePropCard(gameState.id, card.id);
                                                    }
                                                }}
                                                className="text-rose-400 hover:text-rose-300 p-2"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
