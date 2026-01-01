import { useState, useMemo } from 'react';
import { Plus, Trash2, Edit2, Check, Save, AlertTriangle, ChevronDown, ChevronUp, Search, Filter, X, Lightbulb } from 'lucide-react';
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
    const [showInspirationModal, setShowInspirationModal] = useState(false);

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
    const allCategories = ['Game', 'Player', 'Offense', 'Defense', 'TD', 'FG', 'Fun', 'Yards'];

    // Dynamic categories from existing questions + defaults
    const availableCategories = useMemo(() => {
        const cats = new Set<string>(allCategories);
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

    return (
        <div className="space-y-8 pb-20 relative">
            {/* Inspiration Modal */}
            {showInspirationModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur rounded-t-2xl z-10">
                            <div>
                                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                    <Lightbulb size={24} className="text-amber-400" />
                                    Prop Question Library
                                </h2>
                                <p className="text-slate-400">Browse template questions to add to your pool.</p>
                            </div>
                            <button onClick={() => setShowInspirationModal(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-hidden">
                            <SeedLibrary
                                existingQuestions={questions}
                                onAdd={(seed) => {
                                    const newQ: PropQuestion = {
                                        id: crypto.randomUUID(),
                                        text: seed.text,
                                        options: seed.options,
                                        points: 1,
                                        type: 'standard',
                                        category: seed.category || 'Game',
                                        categories: seed.categories || (seed.category ? [seed.category] : ['Game'])
                                    };
                                    setQuestions([...questions, newQ]);
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}

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
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left Column: List & Reorder (Larger width) */}
                    <div className="lg:col-span-7 space-y-6">

                        {/* Filters */}
                        <div className="flex flex-wrap items-center gap-3 bg-slate-900 p-3 rounded-lg border border-slate-800">
                            <div className="relative flex-1 min-w-[200px]">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="Search your questions..."
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
                                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Questions List */}
                        <div className="space-y-3">
                            {questions.length === 0 ? (
                                <div className="text-center py-16 text-slate-500 bg-slate-900/50 rounded-xl border-2 border-slate-800 border-dashed flex flex-col items-center justify-center">
                                    <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-4 text-slate-600">
                                        <Lightbulb size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-2">No Questions Yet</h3>
                                    <p className="text-sm max-w-xs mx-auto mb-6">Start by adding a custom question on the right, or browse our library of popular props.</p>
                                    <button
                                        onClick={() => setShowInspirationModal(true)}
                                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold flex items-center gap-2 transition-colors"
                                    >
                                        <Lightbulb size={18} /> Browse Library
                                    </button>
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
                                                            <select
                                                                value={editForm.category || ''}
                                                                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                                                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
                                                            >
                                                                {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                            </select>
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
                                        <div key={q.id} className="group bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg p-4 transition-all flex items-start gap-4">
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
                                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-900 text-slate-400 mb-2 border border-slate-800">
                                                            {q.category || 'General'}
                                                        </span>
                                                        <h4 className="font-bold text-white text-lg leading-tight">{q.text}</h4>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="block font-bold text-indigo-400">{q.points} Pts</span>
                                                        {q.type === 'tiebreaker' && <span className="text-[10px] text-amber-500 uppercase font-bold">Tiebreaker</span>}
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-2 mt-3">
                                                    {q.options.map((opt, i) => (
                                                        <span key={i} className="px-3 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300">
                                                            {opt}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => startEditing(q)} className="p-2 rounded bg-slate-900 text-blue-400 hover:bg-blue-900/30 transition-colors">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(q.id)} className="p-2 rounded bg-slate-900 text-rose-400 hover:bg-rose-900/30 transition-colors">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Column: Add New Panel & Inspiration Trigger */}
                    <div className="lg:col-span-5 space-y-6">

                        {/* Banner for Inspiration */}
                        <div className="bg-gradient-to-br from-indigo-900/50 to-slate-900 border border-indigo-500/30 rounded-xl p-6 relative overflow-hidden group hover:border-indigo-500/50 transition-colors">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Lightbulb size={80} />
                            </div>
                            <h3 className="text-lg font-bold text-white mb-2 relative z-10">Need Inspiration?</h3>
                            <p className="text-sm text-indigo-200 mb-4 relative z-10">Browse our library of popular prop questions to quickly build your pool.</p>
                            <button
                                onClick={() => setShowInspirationModal(true)}
                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all relative z-10 shadow-lg shadow-indigo-900/50"
                            >
                                <Lightbulb size={18} /> Open Question Library
                            </button>
                        </div>

                        {/* Add Custom Form */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 sticky top-24">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Plus size={20} className="text-emerald-400" /> Add Custom Question
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
                                        <select
                                            value={newQuestionCategory}
                                            onChange={(e) => setNewQuestionCategory(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-indigo-500 appearance-none"
                                        >
                                            {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
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
                                                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:border-indigo-500 outline-none"
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
                                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all mt-2 shadow-lg shadow-emerald-900/20"
                                >
                                    <Plus size={18} /> Add Custom Question
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Sub-components (Internal for now) ---

const SeedLibrary: React.FC<{
    existingQuestions: PropQuestion[];
    onAdd: (seed: PropSeed) => void;
}> = ({ existingQuestions, onAdd }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState('All');
    const [seeds, setSeeds] = useState<PropSeed[]>([]);
    const [loading, setLoading] = useState(true);

    // Load seeds on mount
    useState(() => {
        const fetchSeeds = async () => {
            try {
                const data = await dbService.getPropSeeds();
                setSeeds(data);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchSeeds();
    });

    const categories = useMemo(() => {
        const cats = new Set<string>(['All']);
        seeds.forEach(s => {
            if (s.categories) s.categories.forEach(c => cats.add(c));
            if (s.category) cats.add(s.category);
        });
        return Array.from(cats).sort();
    }, [seeds]);

    const filtered = useMemo(() => {
        return seeds.filter(s => {
            const matchesSearch = s.text.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCat = activeCategory === 'All'
                ? true
                : (s.categories?.includes(activeCategory) || s.category === activeCategory);
            return matchesSearch && matchesCat;
        });
    }, [seeds, searchTerm, activeCategory]);

    const isAdded = (text: string) => existingQuestions.some(q => q.text === text);

    return (
        <div className="h-full flex flex-col bg-slate-950">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-800 flex gap-4 bg-slate-900">
                <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search seeds..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:border-indigo-500 outline-none"
                    />
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar max-w-[50%]">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${activeCategory === cat
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                                }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-700">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-4"></div>
                        Loading Library...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center text-slate-500 mt-20">
                        No questions found matching your criteria.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filtered.map(seed => {
                            const added = isAdded(seed.text);
                            return (
                                <div
                                    key={seed.id}
                                    className={`p-4 rounded-xl border transition-all ${added
                                            ? 'bg-slate-900/50 border-slate-800 opacity-60'
                                            : 'bg-slate-900 border-slate-700 hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-900/10'
                                        }`}
                                >
                                    <div className="flex justify-between items-start gap-3 mb-2">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-900/20 px-2 py-0.5 rounded">
                                            {seed.category || 'General'}
                                        </span>
                                        {added && <span className="text-xs font-bold text-emerald-500 flex items-center gap-1"><Check size={12} /> Added</span>}
                                    </div>
                                    <h4 className={`font-bold mb-3 ${added ? 'text-slate-500' : 'text-slate-200'}`}>{seed.text}</h4>

                                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/50">
                                        <div className="flex gap-1">
                                            {seed.options.map((opt, i) => (
                                                <span key={i} className="text-[10px] bg-slate-950 px-2 py-0.5 rounded text-slate-500 border border-slate-800">{opt}</span>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => !added && onAdd(seed)}
                                            disabled={added}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${added
                                                    ? 'bg-transparent text-slate-600 cursor-default'
                                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                                }`}
                                        >
                                            {added ? 'In Pool' : <><Plus size={14} /> Add</>}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
