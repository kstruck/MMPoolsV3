import { OverlayRoot } from '../ui/OverlayRoot';
import { logger } from '../../utils/logger';
import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, Save, ChevronDown, ChevronUp, Search, Filter, X, Lightbulb } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { PropQuestion, PropsPool, PropCard, PropSeed } from '../../types';
import { PropStats } from './PropStats';
import { useToast } from '../ui/Toast';
import { Button } from '../ui';

interface PropsManagerProps {
    gameState: PropsPool;
    updateConfig?: (updates: Partial<PropsPool>) => void; // Optional if just managing live pool
    allCards?: PropCard[];
    isWizardMode?: boolean;
}

const CONTROL =
    'w-full rounded-md border-[1.5px] border-line bg-page px-3 py-2 font-body text-[color:var(--text)] placeholder:text-faint focus:border-navy-600 outline-none transition-colors';
const LABEL =
    'text-[12px] font-display font-bold uppercase tracking-[0.08em] text-muted';

export const PropsManager: React.FC<PropsManagerProps> = ({ gameState, updateConfig, allCards, isWizardMode }) => {
    const toast = useToast();
    // Local state for form management
    const [questions, setQuestions] = useState<PropQuestion[]>(gameState.props?.questions || []);
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

    const hasChanges = JSON.stringify(questions) !== JSON.stringify(gameState.props?.questions || []);

    // Auto-sync questions to parent in wizard mode (so main SAVE button works)
    useEffect(() => {
        if (isWizardMode && updateConfig && hasChanges) {
            updateConfig({
                props: {
                    ...gameState.props,
                    questions: questions
                }
            });
        }
    }, [questions]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const handleDelete = async (id: string) => {
        const ok = await toast.confirm({
            title: 'Delete this question?',
            message: 'Are you sure you want to delete this question?',
            danger: true,
        });
        if (ok) {
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
        <div className="space-y-8 pb-20 relative font-body">
            {/* Inspiration Modal */}
            {showInspirationModal && (
                <OverlayRoot id="props-question-library" label="Prop question library" onEscape={() => setShowInspirationModal(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border border-line rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-panel">
                        <div className="p-6 border-b border-line flex items-center justify-between sticky top-0 bg-card backdrop-blur rounded-t-2xl z-10">
                            <div>
                                <h2 className="text-2xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                                    <Lightbulb size={24} className="text-gold-500" />
                                    Prop Question Library
                                </h2>
                                <p className="text-muted">Browse template questions to add to your pool.</p>
                            </div>
                            <button onClick={() => setShowInspirationModal(false)} className="p-2 hover:bg-surface rounded-full text-muted hover:text-[color:var(--text)] transition-colors duration-150">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 overflow-hidden">
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
                </OverlayRoot>
            )}

            {/* Header / Save Bar */}
            <div className="sticky top-0 z-30 bg-card backdrop-blur border-b border-line p-4 -mx-4 sm:mx-0 sm:rounded-xl sm:border shadow-card flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <Edit2 size={24} className="text-navy-700 dark:text-gold-400" />
                        Prop Questions
                    </h2>
                    <p className="text-muted text-xs mt-1 num">
                        {questions.length} questions configured • {questions.reduce((sum, q) => sum + (q.points || 1), 0)} total points
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Stats Toggle (Only if cards exist) */}
                    {allCards && allCards.length > 0 && (
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className={`px-3 py-1.5 rounded text-sm font-display font-bold uppercase tracking-[0.05em] border transition-colors duration-150 ${showStats ? 'bg-navy-800 border-navy-800 text-white dark:border-gold-500' : 'bg-surface border-line text-muted hover:text-[color:var(--text)]'
                                }`}
                        >
                            {showStats ? 'Hide Stats' : 'View Stats'}
                        </button>
                    )}

                    {!showStats && (
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={!hasChanges}
                            className="px-6"
                        >
                            <Save size={18} />
                            {hasChanges ? 'Save Changes' : 'Saved'}
                        </Button>
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
                        <div className="flex flex-wrap items-center gap-3 bg-card p-3 rounded-lg border border-line">
                            <div className="relative flex-1 min-w-[200px]">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                <input
                                    type="text"
                                    placeholder="Search your questions..."
                                    value={questionSearch}
                                    onChange={(e) => setQuestionSearch(e.target.value)}
                                    className={`${CONTROL} pl-9 pr-3 text-sm`}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Filter size={16} className="text-faint" />
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="bg-page border-[1.5px] border-line rounded-md px-3 py-2 text-sm text-[color:var(--text)] outline-none focus:border-navy-600 cursor-pointer"
                                >
                                    <option value="All">All Categories</option>
                                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Questions List */}
                        <div className="space-y-3">
                            {questions.length === 0 ? (
                                <div className="text-center py-16 text-muted bg-card rounded-xl border-2 border-line border-dashed flex flex-col items-center justify-center">
                                    <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-4 text-faint">
                                        <Lightbulb size={32} />
                                    </div>
                                    <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-2">No Questions Yet</h3>
                                    <p className="text-sm max-w-xs mx-auto mb-6">Start by adding a custom question on the right, or browse our library of popular props.</p>
                                    <Button variant="secondary" size="sm" onClick={() => setShowInspirationModal(true)} className="px-6">
                                        <Lightbulb size={18} /> Browse Library
                                    </Button>
                                </div>
                            ) : filteredQuestions.length === 0 ? (
                                <div className="text-center py-12 text-muted bg-card rounded-xl border border-line border-dashed">
                                    <p>No questions found matching your filters.</p>
                                </div>
                            ) : (
                                filteredQuestions.map((q) => {
                                    // Calculate actual index in the main array for reordering
                                    const actualIndex = questions.findIndex(item => item.id === q.id);
                                    const isEditing = editingId === q.id;

                                    if (isEditing) {
                                        return (
                                            <div key={q.id} className="bg-card border border-line border-l-4 border-l-navy-700 dark:border-l-gold-500 rounded-lg p-4 shadow-card-hover animate-in fade-in">
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className={LABEL}>Question Text</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.text}
                                                            onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                                                            className={`${CONTROL} font-bold`}
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <label className={LABEL}>Category</label>
                                                            <select
                                                                value={editForm.category || ''}
                                                                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                                                className={`${CONTROL} cursor-pointer`}
                                                            >
                                                                {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className={LABEL}>Points</label>
                                                            <input
                                                                type="number"
                                                                value={editForm.points}
                                                                onChange={(e) => setEditForm({ ...editForm, points: parseInt(e.target.value) || 1 })}
                                                                className={`${CONTROL} num`}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className={`${LABEL} mb-1 block`}>Options (Comma Separated)</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.options?.join(', ')}
                                                            onChange={(e) => setEditForm({ ...editForm, options: e.target.value.split(',').map(s => s.trim()) })}
                                                            className={CONTROL}
                                                        />
                                                    </div>
                                                    <div className="flex justify-end gap-3 pt-2">
                                                        <button onClick={cancelEdit} className="px-4 py-2 rounded font-display font-bold uppercase tracking-[0.05em] text-muted hover:text-[color:var(--text)] transition-colors duration-150">Cancel</button>
                                                        <Button size="sm" onClick={saveEdit}><Check size={16} /> Save</Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={q.id} className="group bg-card border border-line hover:border-navy-600 rounded-lg p-4 transition-all duration-150 flex items-start gap-4">
                                            {/* Drag Handles (Actually Up/Down Buttons) */}
                                            {selectedCategory === 'All' && !questionSearch && (
                                                <div className="flex flex-col gap-1 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => moveQuestion(actualIndex, 'up')}
                                                        disabled={actualIndex === 0}
                                                        className="p-1 text-faint hover:text-navy-700 dark:hover:text-gold-400 disabled:opacity-30 disabled:hover:text-faint"
                                                    >
                                                        <ChevronUp size={20} />
                                                    </button>
                                                    <button
                                                        onClick={() => moveQuestion(actualIndex, 'down')}
                                                        disabled={actualIndex === questions.length - 1}
                                                        className="p-1 text-faint hover:text-navy-700 dark:hover:text-gold-400 disabled:opacity-30 disabled:hover:text-faint"
                                                    >
                                                        <ChevronDown size={20} />
                                                    </button>
                                                </div>
                                            )}

                                            <div className="flex-1">
                                                <div className="flex items-start justify-between mb-2">
                                                    <div>
                                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] uppercase font-display font-bold tracking-[0.08em] bg-surface text-muted mb-2 border border-line">
                                                            {q.category || 'General'}
                                                        </span>
                                                        <h4 className="font-bold text-[color:var(--text)] text-lg leading-tight">{q.text}</h4>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="block font-display font-bold num text-navy-700 dark:text-gold-400">{q.points} Pts</span>
                                                        {q.type === 'tiebreaker' && <span className="text-[10px] text-gold-600 dark:text-gold-400 uppercase font-display font-bold tracking-[0.08em]">Tiebreaker</span>}
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-2 mt-3">
                                                    {q.options.map((opt, i) => (
                                                        <span key={i} className="px-3 py-1 rounded-md bg-surface border border-line text-xs font-semibold text-muted">
                                                            {opt}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => startEditing(q)} className="p-2 rounded bg-surface border border-line text-navy-700 dark:text-gold-400 hover:bg-navy-600/10 transition-colors duration-150">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(q.id)} className="p-2 rounded bg-surface border border-line text-brandred-600 hover:bg-brandred-600/10 transition-colors duration-150">
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
                        <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-xl p-6 relative overflow-hidden group hover:border-[rgba(230,206,150,0.3)] transition-colors duration-150">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-gold-400">
                                <Lightbulb size={80} />
                            </div>
                            <h3 className="text-lg font-display font-bold uppercase text-white mb-2 relative z-10">Need Inspiration?</h3>
                            <p className="text-sm text-[#9FB0CC] mb-4 relative z-10">Browse our library of popular prop questions to quickly build your pool.</p>
                            <Button
                                variant="premium"
                                size="sm"
                                onClick={() => setShowInspirationModal(true)}
                                className="w-full relative z-10"
                            >
                                <Lightbulb size={18} /> Open Question Library
                            </Button>
                        </div>

                        {/* Add Custom Form */}
                        <div className="bg-card border border-line rounded-xl shadow-card p-6 sticky top-24">
                            <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                                <Plus size={20} className="text-gold-500" /> Add Custom Question
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className={`block ${LABEL} mb-1`}>Question</label>
                                    <input
                                        type="text"
                                        value={newQuestionText}
                                        onChange={(e) => setNewQuestionText(e.target.value)}
                                        placeholder="e.g. Total Passing Yards"
                                        className={CONTROL}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={`block ${LABEL} mb-1`}>Category</label>
                                        <select
                                            value={newQuestionCategory}
                                            onChange={(e) => setNewQuestionCategory(e.target.value)}
                                            className={`${CONTROL} cursor-pointer appearance-none`}
                                        >
                                            {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={`block ${LABEL} mb-1`}>Points</label>
                                        <input
                                            type="number"
                                            value={newQuestionPoints}
                                            onChange={(e) => setNewQuestionPoints(parseInt(e.target.value) || 1)}
                                            className={`${CONTROL} num`}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className={`block ${LABEL} mb-1`}>Options</label>
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
                                                    className={`${CONTROL} text-sm`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => setNewQuestionOptions([...newQuestionOptions, ''])}
                                        className="text-[10px] text-navy-700 dark:text-gold-400 font-display font-bold uppercase tracking-[0.08em] mt-1 hover:underline"
                                    >
                                        + Add Option
                                    </button>
                                </div>

                                <Button
                                    onClick={handleAddQuestion}
                                    disabled={!newQuestionText}
                                    className="w-full mt-2"
                                >
                                    <Plus size={18} /> Add Custom Question
                                </Button>
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
                logger.error(err);
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
        <div className="h-full flex flex-col bg-page font-body">
            {/* Toolbar */}
            <div className="p-4 border-b border-line flex gap-4 bg-surface">
                <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                        type="text"
                        placeholder="Search seeds..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-page border-[1.5px] border-line rounded-lg pl-10 pr-4 py-2 text-[color:var(--text)] placeholder:text-faint focus:border-navy-600 outline-none"
                    />
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar max-w-[50%]">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`px-3 py-1.5 rounded-full text-sm font-display font-bold uppercase tracking-[0.05em] whitespace-nowrap transition-colors duration-150 ${activeCategory === cat
                                ? 'bg-navy-800 text-white dark:ring-1 dark:ring-gold-500'
                                : 'bg-page border border-line text-muted hover:text-[color:var(--text)]'
                                }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 scrollbar-thin">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted">
                        <div className="animate-spin w-8 h-8 border-2 border-navy-600 dark:border-gold-500 border-t-transparent rounded-full mb-4"></div>
                        Loading Library...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center text-muted mt-20">
                        No questions found matching your criteria.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filtered.map(seed => {
                            const added = isAdded(seed.text);
                            return (
                                <div
                                    key={seed.id}
                                    className={`p-4 rounded-xl border transition-all duration-150 ${added
                                        ? 'bg-surface border-line opacity-60'
                                        : 'bg-card border-line hover:border-gold-500/50 hover:shadow-card-hover'
                                        }`}
                                >
                                    <div className="flex justify-between items-start gap-3 mb-2">
                                        <span className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-navy-700 dark:text-gold-400 bg-navy-600/10 px-2 py-0.5 rounded">
                                            {seed.category || 'General'}
                                        </span>
                                        {added && <span className="text-xs font-display font-bold uppercase text-[#0F7B4A] flex items-center gap-1"><Check size={12} /> Added</span>}
                                    </div>
                                    <h4 className={`font-bold mb-3 ${added ? 'text-muted' : 'text-[color:var(--text)]'}`}>{seed.text}</h4>

                                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-line">
                                        <div className="flex gap-1">
                                            {seed.options.map((opt, i) => (
                                                <span key={i} className="text-[10px] bg-page px-2 py-0.5 rounded text-faint border border-line">{opt}</span>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => !added && onAdd(seed)}
                                            disabled={added}
                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${added
                                                ? 'bg-transparent text-faint cursor-default'
                                                : 'bg-navy-800 hover:bg-navy-700 text-white'
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
