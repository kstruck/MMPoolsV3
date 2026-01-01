import { useState, useMemo } from 'react';
import { Plus, Trash2, Edit2, Check, Save, AlertTriangle, ChevronDown, ChevronUp, Search, Filter } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { PropQuestion, PropsPool, PropCard, PropSeed } from '../../types';
import { PropStats } from './PropStats';

interface PropsManagerProps {
    gameState: PropsPool;
    updateConfig?: (updates: Partial<PropsPool>) => void; // Optional if just managing live pool
    allCards?: PropCard[];
    isWizardMode?: boolean;
}

export const PropsManager: React.FC<PropsManagerProps> = ({ gameState, updateConfig, allCards }) => {
    // Local state for form management
    const [questions, setQuestions] = useState<PropQuestion[]>(gameState.props.questions || []);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Filter/Search State
    const [questionSearch, setQuestionSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [seedSearch, setSeedSearch] = useState('');


    // New Question Form
    const [newQuestionText, setNewQuestionText] = useState('');
    const [newQuestionOptions, setNewQuestionOptions] = useState<string[]>(['Over', 'Under']);
    const [newQuestionPoints, setNewQuestionPoints] = useState(1);
    const [newQuestionType, setNewQuestionType] = useState<'standard' | 'tiebreaker'>('standard');
    const [newQuestionCategory, setNewQuestionCategory] = useState('Game');

    // Editing State
    const [editForm, setEditForm] = useState<Partial<PropQuestion>>({});
    const [showStats, setShowStats] = useState(false);

    // --- Derived Data ---
    const categories = useMemo(() => {
        const cats = new Set<string>(['Game', 'Player', 'Fun', 'Offense', 'Defense', 'Yards', 'TD']);

        questions.forEach(q => {
            if (q.categories && q.categories.length > 0) {
                q.categories.forEach(c => cats.add(c));
            } else if (q.category) {
                cats.add(q.category);
            }
        });
        return Array.from(cats).sort();
    }, [questions]);

    const filteredQuestions = useMemo(() => {
        return questions.filter(q => {
            const matchesSearch = q.text.toLowerCase().includes(questionSearch.toLowerCase());
            const matchesCategory = selectedCategory === 'All'
                ? true
                : (q.categories?.includes(selectedCategory) || q.category === selectedCategory);
            return matchesSearch && matchesCategory;
        });
    }, [questions, questionSearch, selectedCategory]);

    const hasChanges = JSON.stringify(questions) !== JSON.stringify(gameState.props.questions);

    // --- Handlers ---

    const handleAddQuestion = () => {
        if (!newQuestionText.trim()) return;

        const newQ: PropQuestion = {
            id: crypto.randomUUID(),
            text: newQuestionText,
            options: newQuestionOptions.filter(o => o.trim().length > 0),
            points: newQuestionPoints,
            type: newQuestionType,
            category: newQuestionCategory, // Keep for legacy
            categories: [newQuestionCategory] // Add new array
        };

        setQuestions([...questions, newQ]);

        // Reset form
        setNewQuestionText('');
        setNewQuestionOptions(['Over', 'Under']);
        setNewQuestionPoints(1);
        setNewQuestionType('standard');
    };

    const handleSave = async () => {
        if (updateConfig) {
            updateConfig({
                props: {
                    ...gameState.props,
                    questions: questions
                }
            });
        } else {
            // Live save
            await dbService.updatePool(gameState.id, {
                props: {
                    ...gameState.props,
                    questions: questions
                }
            });
        }
    };

    const handleDelete = (id: string) => {
        if (confirm('Are you sure you want to delete this question?')) {
            setQuestions(questions.filter(q => q.id !== id));
        }
    };

    const startEditing = (q: PropQuestion) => {
        setEditingId(q.id);
        setEditForm({ ...q });
    };

    const saveEdit = () => {
        setQuestions(questions.map(q => q.id === editingId ? { ...q, ...editForm } as PropQuestion : q));
        setEditingId(null);
        setEditForm({});
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm({});
    };

    const moveQuestion = (index: number, direction: 'up' | 'down') => {
        const newQuestions = [...questions];
        const newIndex = direction === 'up' ? index - 1 : index + 1;

        if (newIndex >= 0 && newIndex < newQuestions.length) {
            [newQuestions[index], newQuestions[newIndex]] = [newQuestions[newIndex], newQuestions[index]];
            setQuestions(newQuestions);
        }
    };

    // --- Seed Import Logic ---
    const [showInspiration, setShowInspiration] = useState(false);
    const [seeds, setSeeds] = useState<PropSeed[]>([]);
    const [seedsLoading, setSeedsLoading] = useState(false);

    const toggleInspiration = () => {
        const newState = !showInspiration;
        setShowInspiration(newState);
        if (newState && seeds.length === 0) {
            loadSeeds();
        }
    };

    const loadSeeds = async () => {
        setSeedsLoading(true);
        try {
            const fetched = await dbService.getPropSeeds();
            setSeeds(fetched);
        } catch (error) {
            console.error("Failed to load seeds:", error);
        } finally {
            setSeedsLoading(false);
        }
    };

    const filteredSeeds = useMemo(() => {
        return seeds.filter(s =>
            s.text.toLowerCase().includes(seedSearch.toLowerCase()) ||
            (s.category && s.category.toLowerCase().includes(seedSearch.toLowerCase()))
        );
    }, [seeds, seedSearch]);

    // Group seeds by category for display
    const seedsByCategory = useMemo(() => {
        const grouped: Record<string, PropSeed[]> = {};
        filteredSeeds.forEach(s => {
            const cat = s.category || 'Uncategorized';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(s);
        });
        return grouped;
    }, [filteredSeeds]);

    return (
        <div className="space-y-8 pb-20">
            {/* Header / Save Bar */}
            <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 p-4 -mx-4 sm:mx-0 sm:rounded-xl shadow-xl flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Edit2 size={24} className="text-indigo-400" />
                        Prop Questions
                    </h2>
                    <p className="text-slate-400 text-xs mt-1">
                        {questions.length} questions configured • {questions.reduce((sum, q) => sum + (q.points || 1), 0)} total points
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Stats Toggle (Only if cards exist) */}
                    {allCards && allCards.length > 0 && (
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className={`px-3 py-1.5 rounded text-sm font-bold border transition-colors ${showStats ? 'bg-indigo-900/50 border-indigo-500 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                }`}
                        >
                            {showStats ? 'Hide Stats' : 'View Stats'}
                        </button>
                    )}

                    {!showStats && (
                        <button
                            onClick={handleSave}
                            disabled={!hasChanges}
                            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all ${hasChanges
                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 scale-105'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                }`}
                        >
                            <Save size={18} />
                            {hasChanges ? 'Save Changes' : 'Saved'}
                        </button>
                    )}
                </div>
            </div>

            {/* Stats View */}
            {showStats && allCards ? (
                <div className="animate-in fade-in slide-in-from-top-4">
                    <PropStats questions={gameState.props.questions} cards={allCards} />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: List & Reorder */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Filters */}
                        <div className="flex flex-wrap items-center gap-3 bg-slate-900 p-3 rounded-lg border border-slate-800">
                            <div className="relative flex-1 min-w-[200px]">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="Search questions..."
                                    value={questionSearch}
                                    onChange={(e) => setQuestionSearch(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Filter size={16} className="text-slate-500" />
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 cursor-pointer"
                                >
                                    <option value="All">All Categories</option>
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Questions List */}
                        <div className="space-y-3">
                            {questions.length === 0 ? (
                                <div className="text-center py-12 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                                    <p className="font-bold text-slate-400 mb-2">No Questions Added Yet</p>
                                    <p className="text-sm">Use the form on the right to add custom questions,<br />or click "Need Inspiration?" to browse templates.</p>
                                </div>
                            ) : filteredQuestions.length === 0 ? (
                                <div className="text-center py-12 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                                    <p>No questions found matching your filters.</p>
                                </div>
                            ) : (
                                filteredQuestions.map((q) => {
                                    // Calculate actual index in the main array for reordering
                                    const actualIndex = questions.findIndex(item => item.id === q.id);
                                    const isEditing = editingId === q.id;

                                    if (isEditing) {
                                        return (
                                            <div key={q.id} className="bg-slate-800 border-l-4 border-indigo-500 rounded-lg p-4 shadow-xl animate-in fade-in">
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="text-xs font-bold text-slate-400 uppercase">Question Text</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.text}
                                                            onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                                                            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white font-bold"
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-xs font-bold text-slate-400 uppercase">Category</label>
                                                            <input
                                                                type="text"
                                                                list="categories-edit"
                                                                value={editForm.category || ''}
                                                                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                                                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
                                                            />
                                                            <datalist id="categories-edit">
                                                                {categories.map(c => <option key={c} value={c} />)}
                                                            </datalist>
                                                        </div>
                                                        <div>
                                                            <label className="text-xs font-bold text-slate-400 uppercase">Points</label>
                                                            <input
                                                                type="number"
                                                                value={editForm.points}
                                                                onChange={(e) => setEditForm({ ...editForm, points: parseInt(e.target.value) || 1 })}
                                                                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Options (Comma Separated)</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.options?.join(', ')}
                                                            onChange={(e) => setEditForm({ ...editForm, options: e.target.value.split(',').map(s => s.trim()) })}
                                                            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
                                                        />
                                                    </div>
                                                    <div className="flex justify-end gap-3 pt-2">
                                                        <button onClick={cancelEdit} className="px-4 py-2 rounded font-bold text-slate-400 hover:text-white">Cancel</button>
                                                        <button onClick={saveEdit} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-2"><Check size={16} /> Save</button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={q.id} className="group bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-4 transition-all flex items-start gap-4">
                                            {/* Drag Handles (Actually Up/Down Buttons) */}
                                            {selectedCategory === 'All' && !questionSearch && (
                                                <div className="flex flex-col gap-1 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => moveQuestion(actualIndex, 'up')}
                                                        disabled={actualIndex === 0}
                                                        className="p-1 text-slate-500 hover:text-indigo-400 disabled:opacity-30 disabled:hover:text-slate-500"
                                                    >
                                                        <ChevronUp size={20} />
                                                    </button>
                                                    <button
                                                        onClick={() => moveQuestion(actualIndex, 'down')}
                                                        disabled={actualIndex === questions.length - 1}
                                                        className="p-1 text-slate-500 hover:text-indigo-400 disabled:opacity-30 disabled:hover:text-slate-500"
                                                    >
                                                        <ChevronDown size={20} />
                                                    </button>
                                                </div>
                                            )}

                                            <div className="flex-1">
                                                <div className="flex items-start justify-between mb-2">
                                                    <div>
                                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-400 mb-1 border border-slate-700">
                                                            {q.category || 'General'}
                                                        </span>
                                                        <h4 className="font-bold text-white text-lg">{q.text}</h4>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="block font-bold text-indigo-400">{q.points} Pts</span>
                                                        {q.type === 'tiebreaker' && <span className="text-[10px] text-amber-500 uppercase font-bold">Tiebreaker</span>}
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-2">
                                                    {q.options.map((opt, i) => (
                                                        <span key={i} className="px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs text-slate-300">
                                                            {opt}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => startEditing(q)} className="p-2 rounded bg-slate-800 text-blue-400 hover:bg-blue-900/30 transition-colors">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(q.id)} className="p-2 rounded bg-slate-800 text-rose-400 hover:bg-rose-900/30 transition-colors">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Column: Add New & Import */}
                    <div className="space-y-6">

                        {/* Add New Panel */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sticky top-24">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Plus size={20} className="text-indigo-400" /> Add Custom Question
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Question</label>
                                    <input
                                        type="text"
                                        value={newQuestionText}
                                        onChange={(e) => setNewQuestionText(e.target.value)}
                                        placeholder="e.g. Total Passing Yards"
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Category</label>
                                        <input
                                            type="text"
                                            list="categories-add"
                                            value={newQuestionCategory}
                                            onChange={(e) => setNewQuestionCategory(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                        />
                                        <datalist id="categories-add">
                                            {categories.map(c => <option key={c} value={c} />)}
                                        </datalist>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Points</label>
                                        <input
                                            type="number"
                                            value={newQuestionPoints}
                                            onChange={(e) => setNewQuestionPoints(parseInt(e.target.value) || 1)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Options</label>
                                    <div className="flex gap-2">
                                        {newQuestionOptions.map((opt, i) => (
                                            <div key={i} className="flex-1 relative">
                                                <input
                                                    type="text"
                                                    value={opt}
                                                    onChange={(e) => {
                                                        const newOpts = [...newQuestionOptions];
                                                        newOpts[i] = e.target.value;
                                                        setNewQuestionOptions(newOpts);
                                                    }}
                                                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => setNewQuestionOptions([...newQuestionOptions, ''])}
                                        className="text-[10px] text-indigo-400 font-bold mt-1 hover:underline"
                                    >
                                        + Add Option
                                    </button>
                                </div>

                                <button
                                    onClick={handleAddQuestion}
                                    disabled={!newQuestionText}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all mt-2"
                                >
                                    <Plus size={18} /> Add to Pool
                                </button>
                            </div>
                        </div>

                        {/* Seed Import Panel */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                            <button
                                onClick={toggleInspiration}
                                className="w-full flex items-center justify-between p-4 bg-slate-800 hover:bg-slate-700 transition-colors"
                            >
                                <span className="font-bold text-white flex items-center gap-2">
                                    <AlertTriangle size={18} className="text-amber-400" /> Need Inspiration?
                                </span>
                                <ChevronDown size={20} className={`text-slate-400 transition-transform ${showInspiration ? 'rotate-180' : ''}`} />
                            </button>

                            {showInspiration && (
                                <div className="p-4 border-t border-slate-800 max-h-[500px] overflow-y-auto">
                                    <div className="mb-4">
                                        <input
                                            type="text"
                                            placeholder="Search templates..."
                                            value={seedSearch}
                                            onChange={(e) => setSeedSearch(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
                                        />
                                    </div>

                                    {seedsLoading ? (
                                        <div className="text-center p-8 text-slate-500 flex flex-col items-center gap-2">
                                            <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                                            Loading templates...
                                        </div>
                                    ) : seeds.length === 0 ? (
                                        <div className="text-center p-8 text-slate-500">
                                            No templates found.
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            {Object.entries(seedsByCategory).map(([category, items]) => (
                                                <div key={category}>
                                                    <h4 className="text-xs font-bold text-indigo-400 uppercase mb-2 sticky top-0 bg-slate-900 py-1">{category}</h4>
                                                    <div className="space-y-2">
                                                        {items.map(seed => (
                                                            <div key={seed.id} className="group flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 hover:border-indigo-500/50 transition-colors">
                                                                <div>
                                                                    <p className="text-sm font-medium text-slate-200">{seed.text}</p>
                                                                    <p className="text-[10px] text-slate-500">{seed.options.join(' / ')}</p>
                                                                </div>
                                                                <button
                                                                    onClick={() => {
                                                                        setNewQuestionText(seed.text);
                                                                        setNewQuestionOptions(seed.options);
                                                                        setNewQuestionCategory(seed.category || 'Game');
                                                                    }}
                                                                    className="opacity-0 group-hover:opacity-100 px-2 py-1 bg-indigo-500/20 text-indigo-300 text-xs rounded hover:bg-indigo-500 hover:text-white transition-all"
                                                                >
                                                                    Use
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
