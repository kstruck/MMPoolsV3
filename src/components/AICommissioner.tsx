import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService'; // Ensure this uses your shared db instance
import { collection, query, orderBy, limit, onSnapshot, addDoc, where } from 'firebase/firestore';
import type { AIArtifact, AIRequest } from '../types';
import { Bot, Gavel, HelpCircle, CheckCircle, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { useToast } from './ui/Toast';
import { Badge, Button } from './ui';

interface AICommissionerProps {
    poolId: string;
    userId?: string;
    userName?: string;
    poolType?: string;
}

export const AICommissioner: React.FC<AICommissionerProps> = ({ poolId, userId, userName, poolType }) => {
    const defaultTab = poolType === 'PROPS' || poolType === 'BRACKET' || poolType?.startsWith('NFL_') ? 'INSIGHTS' : 'UPDATES';
    const [activeTab, setActiveTab] = useState<'UPDATES' | 'DISPUTE' | 'DETAILS' | 'INSIGHTS'>(defaultTab);
    const [artifacts, setArtifacts] = useState<AIArtifact[]>([]);
    const [question, setQuestion] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userRequests, setUserRequests] = useState<AIRequest[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const toast = useToast();

    // Fetch Artifacts (Winner Explanations, Recaps)
    useEffect(() => {
        const q = query(
            collection(db, `pools/${poolId}/ai_artifacts`),
            orderBy('createdAt', 'desc'),
            limit(10)
        );
        return onSnapshot(q, (snap) => {
            setArtifacts(snap.docs.map(d => d.data() as AIArtifact));
        });
    }, [poolId]);

    // Fetch User Requests (if logged in)
    useEffect(() => {
        if (!userId) return;
        const q = query(
            collection(db, `pools/${poolId}/ai_requests`),
            where('userId', '==', userId)
            // Removed orderBy('createdAt', 'desc') to avoid needing a composite index
        );
        return onSnapshot(q, (snap) => {
            const reqs = snap.docs
                .map(d => ({ ...d.data(), id: d.id } as AIRequest))
                // BANTER requests belong to the commissioner's card (T9); they
                // are not questions this panel asked and listing them here
                // would show a commissioner their own trash-talk prompts in
                // their dispute history.
                .filter(r => r.category !== 'BANTER')
                .sort((a, b) => b.createdAt - a.createdAt); // Client-side sort
            setUserRequests(reqs);
        });
    }, [poolId, userId]);

    const submitDispute = async () => {
        if (!question.trim() || !userId) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, `pools/${poolId}/ai_requests`), {
                userId,
                poolId,
                question: question.trim(),
                category: 'DISPUTE',
                status: 'PENDING',
                createdAt: Date.now()
            });
            setQuestion('');
            setActiveTab('DISPUTE'); // Switch to view status
        } catch (e) {
            logger.error("Error submitting dispute", e);
            toast.error("Failed to submit. Try again.");
        } finally {
            setIsSubmitting(false);
        }
    };
    const submitInsight = async (promptMsg: string) => {
        if (!promptMsg.trim() || !userId) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, `pools/${poolId}/ai_requests`), {
                userId,
                poolId,
                question: promptMsg.trim(),
                category: 'INSIGHT',
                status: 'PENDING',
                createdAt: Date.now()
            });
            // We can switch to DISPUTE or keep in INSIGHTS if we want to show history there
            // Let's just switch to DISPUTE where history is currently shown, or better yet, history shows everything
            setActiveTab('DISPUTE');
        } catch (e) {
            logger.error("Error submitting insight", e);
            toast.error("Failed to request insight. Try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const getArtifactForRequest = (req: AIRequest) => {
        if (!req.responseArtifactId) return null;
        return artifacts.find(a => a.id === req.responseArtifactId); // Might need deeper query if not in recent 10
        // Ideally we'd fetch specific artifact if missing, but for MVP this is likely okay or we'd fetch separately.
    };

    return (
        <div className="bg-card border border-line rounded-xl overflow-hidden shadow-panel w-full max-w-2xl mx-auto my-8">
            {/* Header */}
            <div className="bg-navy-900 p-4 border-b border-[rgba(230,206,150,0.16)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gold-500/15 rounded-full flex items-center justify-center border border-gold-400/50">
                        <Bot size={24} className="text-gold-400" />
                    </div>
                    <div>
                        <h2 className="text-white font-display font-bold uppercase tracking-[0.05em] text-lg">AI Commissioner</h2>
                        <p className="text-[10px] font-display font-bold uppercase tracking-[0.16em] text-[#9FB0CC]">POWERED BY GEMINI • VERIFIED FACTS ONLY</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-line bg-surface">
                <button
                    onClick={() => setActiveTab('UPDATES')}
                    className={`flex-1 py-3 text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${activeTab === 'UPDATES' ? 'text-[color:var(--text)] border-b-2 border-gold-500 bg-gold-500/10' : 'text-muted hover:text-[color:var(--text)]'}`}
                >
                    Latest Updates
                </button>
                <button
                    onClick={() => setActiveTab('DISPUTE')}
                    className={`flex-1 py-3 text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${activeTab === 'DISPUTE' ? 'text-[color:var(--text)] border-b-2 border-gold-500 bg-gold-500/10' : 'text-muted hover:text-[color:var(--text)]'}`}
                >
                    Dispute Helper
                </button>
                {(poolType === 'BRACKET' || poolType === 'PROPS' || poolType?.startsWith('NFL_')) && (
                    <button
                        onClick={() => setActiveTab('INSIGHTS')}
                        className={`flex-1 py-3 text-sm font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${activeTab === 'INSIGHTS' ? 'text-[color:var(--text)] border-b-2 border-gold-500 bg-gold-500/10' : 'text-muted hover:text-[color:var(--text)]'}`}
                    >
                        {poolType === 'BRACKET' ? 'Bracket Insights' : poolType === 'PROPS' ? 'Prop Insights' : 'Weekly Analysis'}
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="p-4 bg-page min-h-[300px]">

                {/* UPDATES TAB */}
                {activeTab === 'UPDATES' && (
                    <div className="space-y-4">
                        {artifacts.filter(a => a.type !== 'DISPUTE_RESPONSE').length === 0 ? (
                            <div className="text-center text-muted font-body py-10">
                                <Bot size={40} className="mx-auto mb-2 opacity-20" />
                                <p>No updates yet. Commissioner is watching correctly.</p>
                            </div>
                        ) : (
                            artifacts.filter(a => a.type !== 'DISPUTE_RESPONSE').map(artifact => (
                                <ArtifactCard key={artifact.id} artifact={artifact} poolId={poolId} userId={userId} userName={userName} />
                            ))
                        )}
                    </div>
                )}

                {/* DISPUTE TAB */}
                {activeTab === 'DISPUTE' && (
                    <div className="space-y-6">
                        {/* New Request */}
                        <div className="bg-card p-4 rounded-lg border border-line shadow-card">
                            <h3 className="text-sm font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] mb-2 flex items-center gap-2">
                                <HelpCircle size={16} className="text-gold-600 dark:text-gold-400" /> Ask the Commissioner
                            </h3>
                            <p className="text-xs font-body text-muted mb-3">
                                Challenge a result or ask for clarification. The AI will analyze the audit logs, scores, and rules to give you a factual answer.
                            </p>
                            <textarea
                                value={question}
                                onChange={e => setQuestion(e.target.value)}
                                placeholder="e.g. Why did the numbers change after lock?"
                                className="w-full bg-surface border border-line rounded-md p-3 text-sm font-body text-[color:var(--text)] focus:border-gold-500 outline-none h-24 mb-3 resize-none"
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={submitDispute}
                                disabled={isSubmitting || !question.trim()}
                                className="w-full"
                            >
                                {isSubmitting ? <Loader className="animate-spin" size={16} /> : <Gavel size={16} />}
                                Submit Challenge
                            </Button>
                        </div>

                        {/* History */}
                        <div className="space-y-4">
                            <h4 className="text-[12px] font-display font-bold uppercase tracking-[0.16em] text-muted">Your History</h4>
                            {userRequests.map(req => {
                                const response = getArtifactForRequest(req);
                                return (
                                    <div key={req.id} className="border border-line rounded-lg overflow-hidden">
                                        <div className="p-3 bg-surface flex justify-between items-start">
                                            <div>
                                                <p className="text-sm font-body text-[color:var(--text)] font-medium">"{req.question}"</p>
                                                <Badge
                                                    status={req.status === 'COMPLETED' ? 'paid' : 'unpaid'}
                                                    className="text-[10px] px-1.5 py-0.5 rounded mt-1"
                                                >
                                                    {req.status}
                                                </Badge>
                                            </div>
                                        </div>
                                        {response && (
                                            <div className="p-3 bg-[#0F7B4A]/5 border-t border-line">
                                                <div className="flex items-start gap-2">
                                                    <Bot size={16} className="text-[#0F7B4A] dark:text-[#3FB77F] mt-1 shrink-0" />
                                                    <div>
                                                        <h5 className="text-sm font-display font-bold text-[#0F7B4A] dark:text-[#3FB77F] mb-1">{response.content.headline}</h5>
                                                        <ul className="space-y-1 mb-2">
                                                            {response.content.summaryBullets.map((b, i) => (
                                                                <li key={i} className="text-xs font-body text-[color:var(--text)]">• {b}</li>
                                                            ))}
                                                        </ul>
                                                        <button onClick={() => setExpandedId(expandedId === req.id ? null : req.id)} className="text-[10px] text-muted hover:text-[color:var(--text)] flex items-center gap-1 transition-colors duration-150">
                                                            {expandedId === req.id ? 'Hide Details' : 'Show Full Explanation'} {expandedId === req.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                                        </button>
                                                        {expandedId === req.id && (
                                                            <div className="mt-2 text-xs font-body text-muted space-y-1 pl-2 border-l border-line">
                                                                {response.content.explanationSteps.map((step, i) => (
                                                                    <p key={i}>{step}</p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* INSIGHTS TAB */}
                {activeTab === 'INSIGHTS' && (
                    <div className="space-y-6 animate-in fade-in">
                        <div className="bg-gold-500/10 p-4 rounded-lg border border-gold-500/30">
                            <h3 className="text-sm font-display font-bold uppercase tracking-[0.05em] text-gold-700 dark:text-gold-400 mb-2 flex items-center gap-2">
                                <Bot size={16} /> AI {poolType === 'BRACKET' ? 'Bracket' : poolType === 'PROPS' ? 'Props' : 'Weekly'} Analysis
                            </h3>
                            <p className="text-xs font-body text-[color:var(--text)] mb-4 leading-relaxed">
                                {poolType === 'BRACKET' ? 'Get personalized insights about your bracket strategy. The AI Commissioner will analyze your picks against the rest of the pool and historical data.' :
                                 poolType === 'PROPS' ? 'Get strategic insights on your prop bets. The AI Commissioner will analyze line values, correlations, and compare your picks to the field.' :
                                 'Get a breakdown of your weekly NFL strategy. The AI Commissioner will review your matchups, point allocations, and risk profile.'}
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {poolType === 'BRACKET' ? (
                                    <>
                                        <button onClick={() => submitInsight("Analyze my bracket strategy. What is my chalk vs upset balance?")} disabled={isSubmitting} className="bg-card hover:bg-surface border border-line text-left p-3 rounded-lg transition-colors duration-150 group disabled:opacity-50">
                                            <div className="text-[color:var(--text)] font-body font-medium text-sm mb-1 group-hover:text-gold-700 dark:group-hover:text-gold-400">Strategy Analysis</div>
                                            <div className="text-xs font-body text-muted">Chalk vs upset balance & risk profile</div>
                                        </button>
                                        <button onClick={() => submitInsight("Who is my biggest threat in the standings based on our different picks?")} disabled={isSubmitting} className="bg-card hover:bg-surface border border-line text-left p-3 rounded-lg transition-colors duration-150 group disabled:opacity-50">
                                            <div className="text-[color:var(--text)] font-body font-medium text-sm mb-1 group-hover:text-gold-700 dark:group-hover:text-gold-400">Competitor Threat</div>
                                            <div className="text-xs font-body text-muted">Identify who can pass you</div>
                                        </button>
                                    </>
                                ) : poolType === 'PROPS' ? (
                                    <>
                                        <button onClick={() => submitInsight("Analyze my prop card strategy. Did I take too many favorites or longshots?")} disabled={isSubmitting} className="bg-card hover:bg-surface border border-line text-left p-3 rounded-lg transition-colors duration-150 group disabled:opacity-50">
                                            <div className="text-[color:var(--text)] font-body font-medium text-sm mb-1 group-hover:text-gold-700 dark:group-hover:text-gold-400">Card Analysis</div>
                                            <div className="text-xs font-body text-muted">Risk vs Reward breakdown</div>
                                        </button>
                                        <button onClick={() => submitInsight("Compare my props to the pool average. How contrarian am I?")} disabled={isSubmitting} className="bg-card hover:bg-surface border border-line text-left p-3 rounded-lg transition-colors duration-150 group disabled:opacity-50">
                                            <div className="text-[color:var(--text)] font-body font-medium text-sm mb-1 group-hover:text-gold-700 dark:group-hover:text-gold-400">Contrarian Check</div>
                                            <div className="text-xs font-body text-muted">See how you differ from the field</div>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => submitInsight("Review my picks for this week. Where is my biggest risk?")} disabled={isSubmitting} className="bg-card hover:bg-surface border border-line text-left p-3 rounded-lg transition-colors duration-150 group disabled:opacity-50">
                                            <div className="text-[color:var(--text)] font-body font-medium text-sm mb-1 group-hover:text-gold-700 dark:group-hover:text-gold-400">Weekly Risk</div>
                                            <div className="text-xs font-body text-muted">Analyze current week's exposures</div>
                                        </button>
                                        <button onClick={() => submitInsight("How does my strategy compare to the current pool leader?")} disabled={isSubmitting} className="bg-card hover:bg-surface border border-line text-left p-3 rounded-lg transition-colors duration-150 group disabled:opacity-50">
                                            <div className="text-[color:var(--text)] font-body font-medium text-sm mb-1 group-hover:text-gold-700 dark:group-hover:text-gold-400">Leaderboard Comparison</div>
                                            <div className="text-xs font-body text-muted">Compare against the top spot</div>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const ArtifactCard: React.FC<{ artifact: AIArtifact, poolId: string, userId?: string, userName?: string }> = ({ artifact, poolId, userId, userName }) => {
    const [expanded, setExpanded] = useState(false);
    const isExplanation = artifact.type === 'WINNER_EXPLANATION';

    return (
        <div className="bg-card border border-line rounded-lg overflow-hidden transition-all duration-150 hover:border-gold-500/40">
            <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-display font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded ${isExplanation ? 'bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0]' : 'bg-[#E5EDF6] text-[#142A4C] border border-[#CBDCEC]'}`}>
                        {artifact.type.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] text-faint num">
                        {new Date(artifact.createdAt).toLocaleTimeString()}
                    </span>
                </div>
                <h3 className="text-[color:var(--text)] font-display font-bold text-lg mb-2">{artifact.content.headline}</h3>
                <ul className="space-y-1 mb-3">
                    {artifact.content.summaryBullets.map((b, i) => (
                        <li key={i} className="text-sm font-body text-[color:var(--text)] flex items-start gap-2">
                            <CheckCircle size={14} className="text-[#0F7B4A]/60 mt-0.5 shrink-0" />
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>

                {artifact.content.explanationSteps.length > 0 && (
                    <div className="mt-3">
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="flex items-center gap-1 text-xs text-gold-700 dark:text-gold-400 hover:text-gold-600 dark:hover:text-gold-300 transition-colors duration-150 font-body font-medium"
                        >
                            {expanded ? 'Hide Analysis' : 'Show Analysis'}
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>

                        {expanded && (
                            <div className="mt-3 pt-3 border-t border-line space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                {artifact.content.explanationSteps.map((step, i) => (
                                    <div key={i} className="flex gap-3 text-sm font-body text-muted">
                                        <span className="text-faint font-bold num">{i + 1}.</span>
                                        <p>{step}</p>
                                    </div>
                                ))}
                                <div className="mt-2 flex items-center gap-2 text-[10px] text-faint">
                                    <span className="font-display font-bold uppercase tracking-[0.08em] num">CONFIDENCE: {(artifact.content.confidence * 100).toFixed(0)}%</span>
                                    <span>•</span>
                                    <span className="font-display font-bold uppercase tracking-[0.08em]">HASH: {artifact.factsHash.substring(0, 8)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Comments / Message Board Section */}
                <ArtifactComments poolId={poolId} artifactId={artifact.id} userId={userId} userName={userName} />
            </div>
        </div>
    );
};

const ArtifactComments: React.FC<{ poolId: string, artifactId: string, userId?: string, userName?: string }> = ({ poolId, artifactId, userId, userName }) => {
    const [comments, setComments] = useState<any[]>([]);
    const [newComment, setNewComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const q = query(
            collection(db, `pools/${poolId}/ai_artifacts/${artifactId}/comments`),
            orderBy('timestamp', 'asc')
        );
        return onSnapshot(q, (snap) => {
            setComments(snap.docs.map(d => ({ ...d.data(), id: d.id })));
        });
    }, [poolId, artifactId]);

    const submitComment = async () => {
        if (!newComment.trim() || !userId) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(db, `pools/${poolId}/ai_artifacts/${artifactId}/comments`), {
                userId,
                userName: userName || 'Participant',
                text: newComment.trim(),
                timestamp: Date.now()
            });
            setNewComment('');
        } catch (e) {
            logger.error("Error submitting comment", e);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="mt-4 pt-4 border-t border-line">
            <h4 className="text-[12px] font-display font-bold uppercase tracking-[0.16em] text-muted mb-3 flex items-center gap-2">
                Participant Discussion (<span className="num">{comments.length}</span>)
            </h4>

            {comments.length > 0 && (
                <div className="space-y-3 mb-4 max-h-48 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-[color:var(--line)] scrollbar-track-transparent">
                    {comments.map(c => (
                        <div key={c.id} className="bg-surface rounded p-2.5 border border-line text-sm font-body">
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-bold text-gold-700 dark:text-gold-400 text-xs">{c.userName}</span>
                                <span className="text-[10px] text-faint num">{new Date(c.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</span>
                            </div>
                            <p className="text-[color:var(--text)]">{c.text}</p>
                        </div>
                    ))}
                </div>
            )}

            {userId ? (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitComment()}
                        placeholder="Reply to this update..."
                        className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-sm font-body text-[color:var(--text)] focus:outline-none focus:border-gold-500"
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={submitComment}
                        disabled={isSubmitting || !newComment.trim()}
                    >
                        Post
                    </Button>
                </div>
            ) : (
                <p className="text-xs font-body text-muted italic">Sign in to join the discussion.</p>
            )}
        </div>
    );
};
