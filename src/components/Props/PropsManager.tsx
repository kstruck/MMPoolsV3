import React, { useState, useEffect } from 'react';
import type { GameState, PropQuestion, PropSeed } from '../../types';
import { Plus, Trash2, Check, Download, Save, X, Edit2 } from 'lucide-react';
import { dbService } from '../../services/dbService';

interface PropsManagerProps {
    gameState: GameState;
    updateConfig: (updates: Partial<GameState>) => void;
}

export const PropsManager: React.FC<PropsManagerProps> = ({ gameState, updateConfig }) => {
    const [newQuestionText, setNewQuestionText] = useState('');
    const [option1, setOption1] = useState('');
    const [option2, setOption2] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    // Seed State

    // Seed State
    const [seeds, setSeeds] = useState<PropSeed[]>([]);
    const [showImport, setShowImport] = useState(false);

    useEffect(() => {
        const unsub = dbService.subscribeToPropSeeds(setSeeds);
        return () => unsub();
    }, []);

    const handleImportSeed = (seed: PropSeed) => {
        setNewQuestionText(seed.text);
        setOption1(seed.options[0]);
        setOption2(seed.options[1]);
        setShowImport(false);
    };

    const questions = gameState.props?.questions || [];
    const propsEnabled = gameState.props?.enabled || false;
    const propCost = gameState.props?.cost || 5;

    const handleAddQuestion = () => {
        if (!newQuestionText || !option1 || !option2) return;

        let updatedQuestions: PropQuestion[];

        if (editingId) {
            updatedQuestions = questions.map(q => q.id === editingId ? {
                ...q,
                text: newQuestionText,
                options: [option1, option2]
            } : q);
        } else {
            const newQ: PropQuestion = {
                id: crypto.randomUUID(),
                text: newQuestionText,
                options: [option1, option2],
                correctOption: undefined
            };
            updatedQuestions = [...questions, newQ];
        }

        updateConfig({
            props: {
                ...gameState.props!,
                questions: updatedQuestions
            }
        });

        setNewQuestionText('');
        setOption1('');
        setOption2('');
        setEditingId(null);
    };

    const handleEditClick = (q: PropQuestion) => {
        setEditingId(q.id);
        setNewQuestionText(q.text);
        setOption1(q.options[0]);
        setOption2(q.options[1]);
        setShowImport(false);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setNewQuestionText('');
        setOption1('');
        setOption2('');
    };

    const handleRemoveQuestion = (id: string) => {
        updateConfig({
            props: {
                ...gameState.props!,
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

    const handlCostChange = (val: number) => {
        updateConfig({
            props: {
                enabled: propsEnabled,
                cost: val,
                questions
            }
        });
    };

    // Grading is handled via Cloud Function trigger visually in Frontend or specific Admin Panel
    // For 'PropsManager', we can allow simple setting of 'correctOption' via updateConfig if we want manual override,
    // BUT the requirement was a cloud function `gradeProp`.
    // Let's rely on the cloud function for grading so it triggers recalc.
    // We'll need `dbService.gradeProp(poolId, qId, optionIndex)`

    const handleGrade = async (qId: string, optionIdx: number) => {
        // Call Cloud Function
        await dbService.gradeProp(gameState.id, qId, optionIdx);
    };

    return (
        <div className="space-y-6">
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
                            onChange={(e) => handlCostChange(Number(e.target.value))}
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

                    {/* Add New */}
                    <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800 relative">
                        {/* Seed Import Dropdown */}
                        <div className="flex justify-end mb-2">
                            <div className="relative">
                                <button
                                    onClick={() => setShowImport(!showImport)}
                                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-bold"
                                >
                                    <Download size={14} /> Import from Seeds
                                </button>
                                {showImport && (
                                    <div className="absolute right-0 top-6 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 max-h-60 overflow-y-auto">
                                        {seeds.map(seed => (
                                            <button
                                                key={seed.id}
                                                onClick={() => handleImportSeed(seed)}
                                                className="w-full text-left p-2 hover:bg-slate-700 text-sm text-slate-300 border-b border-slate-700/50 last:border-0"
                                            >
                                                {seed.text}
                                            </button>
                                        ))}
                                        {seeds.length === 0 && <div className="p-2 text-xs text-slate-500">No seeds available</div>}
                                    </div>
                                )}
                            </div>
                        </div>

                        <h4 className="text-sm font-bold text-slate-300 mb-3">Add New Prop</h4>
                        <div className="grid gap-3">
                            <input
                                type="text"
                                placeholder="Question (e.g. Who scores first?)"
                                className="w-full bg-slate-800 border-slate-700 text-white px-3 py-2 rounded"
                                value={newQuestionText}
                                onChange={e => setNewQuestionText(e.target.value)}
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <input
                                    type="text"
                                    placeholder="Option A (e.g. Chiefs)"
                                    className="w-full bg-slate-800 border-slate-700 text-white px-3 py-2 rounded"
                                    value={option1}
                                    onChange={e => setOption1(e.target.value)}
                                />
                                <input
                                    type="text"
                                    placeholder="Option B (e.g. 49ers)"
                                    className="w-full bg-slate-800 border-slate-700 text-white px-3 py-2 rounded"
                                    value={option2}
                                    onChange={e => setOption2(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {editingId && (
                                <button
                                    onClick={handleCancelEdit}
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

                    {/* List */}
                    <div className="space-y-3">
                        {questions.map((q, idx) => (
                            <div key={q.id} className="bg-slate-800 p-4 rounded-lg flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <span className="text-white font-medium">#{idx + 1}: {q.text}</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => handleEditClick(q)} className="text-indigo-400 hover:text-indigo-300">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => handleRemoveQuestion(q.id)} className="text-rose-400 hover:text-rose-300">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* Grading UI */}
                                <div className="grid grid-cols-2 gap-2 mt-2">
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
                                            {opt}
                                            {q.correctOption === optIdx && <Check size={14} />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )
            }
        </div >
    );
};
