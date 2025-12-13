import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService'; // Ensure this uses your shared db instance
import { collection, query, orderBy, limit, onSnapshot, addDoc, where } from 'firebase/firestore';
import type { AIArtifact, AIRequest } from '../types';
import { Bot, Gavel, HelpCircle, CheckCircle, ChevronDown, ChevronUp, Loader } from 'lucide-react';

interface AICommissionerProps {
    poolId: string;
    userId?: string;
}

export const AICommissioner: React.FC<AICommissionerProps> = ({ poolId, userId }) => {
    const [activeTab, setActiveTab] = useState<'UPDATES' | 'DISPUTE' | 'DETAILS'>('UPDATES');
    const [artifacts, setArtifacts] = useState<AIArtifact[]>([]);
    const [question, setQuestion] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userRequests, setUserRequests] = useState<AIRequest[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

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
            where('userId', '==', userId),
            orderBy('createdAt', 'desc')
        );
        return onSnapshot(q, (snap) => {
            setUserRequests(snap.docs.map(d => ({ ...d.data(), id: d.id } as AIRequest)));
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
            console.error("Error submitting dispute", e);
            alert("Failed to submit. Try again.");
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
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl w-full max-w-2xl mx-auto my-8">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-900 to-slate-900 p-4 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-400/50">
                        <Bot size={24} className="text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-white font-bold text-lg">AI Commissioner</h2>
                        <p className="text-xs text-indigo-300 font-mono">POWERED BY GEMINI • VERIFIED FACTS ONLY</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-700 bg-slate-950/50">
                <button
                    onClick={() => setActiveTab('UPDATES')}
                    className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'UPDATES' ? 'text-white border-b-2 border-indigo-500 bg-indigo-500/10' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Latest Updates
                </button>
                <button
                    onClick={() => setActiveTab('DISPUTE')}
                    className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'DISPUTE' ? 'text-white border-b-2 border-indigo-500 bg-indigo-500/10' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Dispute Helper
                </button>
            </div>

            {/* Content */}
            <div className="p-4 bg-slate-950 min-h-[300px]">

                {/* UPDATES TAB */}
                {activeTab === 'UPDATES' && (
                    <div className="space-y-4">
                        {artifacts.filter(a => a.type !== 'DISPUTE_RESPONSE').length === 0 ? (
                            <div className="text-center text-slate-500 py-10">
                                <Bot size={40} className="mx-auto mb-2 opacity-20" />
                                <p>No updates yet. Commissioner is watching correctly.</p>
                            </div>
                        ) : (
                            artifacts.filter(a => a.type !== 'DISPUTE_RESPONSE').map(artifact => (
                                <ArtifactCard key={artifact.id} artifact={artifact} />
                            ))
                        )}
                    </div>
                )}

                {/* DISPUTE TAB */}
                {activeTab === 'DISPUTE' && (
                    <div className="space-y-6">
                        {/* New Request */}
                        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                                <HelpCircle size={16} className="text-amber-400" /> Ask the Commissioner
                            </h3>
                            <p className="text-xs text-slate-400 mb-3">
                                Challenge a result or ask for clarification. The AI will analyze the audit logs, scores, and rules to give you a factual answer.
                            </p>
                            <textarea
                                value={question}
                                onChange={e => setQuestion(e.target.value)}
                                placeholder="e.g. Why did the numbers change after lock?"
                                className="w-full bg-black/50 border border-slate-700 rounded p-3 text-sm text-white focus:border-indigo-500 outline-none h-24 mb-3 resize-none"
                            />
                            <button
                                onClick={submitDispute}
                                disabled={isSubmitting || !question.trim()}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? <Loader className="animate-spin" size={16} /> : <Gavel size={16} />}
                                Submit Challenge
                            </button>
                        </div>

                        {/* History */}
                        <div className="space-y-4">
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Your History</h4>
                            {userRequests.map(req => {
                                const response = getArtifactForRequest(req);
                                return (
                                    <div key={req.id} className="border border-slate-800 rounded-lg overflow-hidden">
                                        <div className="p-3 bg-slate-900 flex justify-between items-start">
                                            <div>
                                                <p className="text-sm text-white font-medium">"{req.question}"</p>
                                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded mt-1 inline-block ${req.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                    {req.status}
                                                </span>
                                            </div>
                                        </div>
                                        {response && (
                                            <div className="p-3 bg-emerald-900/10 border-t border-slate-800">
                                                <div className="flex items-start gap-2">
                                                    <Bot size={16} className="text-emerald-400 mt-1 shrink-0" />
                                                    <div>
                                                        <h5 className="text-sm font-bold text-emerald-400 mb-1">{response.content.headline}</h5>
                                                        <ul className="space-y-1 mb-2">
                                                            {response.content.summaryBullets.map((b, i) => (
                                                                <li key={i} className="text-xs text-slate-300">• {b}</li>
                                                            ))}
                                                        </ul>
                                                        <button onClick={() => setExpandedId(expandedId === req.id ? null : req.id)} className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1">
                                                            {expandedId === req.id ? 'Hide Details' : 'Show Full Explanation'} {expandedId === req.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                                        </button>
                                                        {expandedId === req.id && (
                                                            <div className="mt-2 text-xs text-slate-400 space-y-1 pl-2 border-l border-slate-700">
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
            </div>
        </div>
    );
};

const ArtifactCard: React.FC<{ artifact: AIArtifact }> = ({ artifact }) => {
    const [expanded, setExpanded] = useState(false);
    const isExplanation = artifact.type === 'WINNER_EXPLANATION';

    return (
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden transition-all hover:border-slate-700">
            <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${isExplanation ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {artifact.type.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                        {new Date(artifact.createdAt).toLocaleTimeString()}
                    </span>
                </div>
                <h3 className="text-white font-bold text-lg mb-2">{artifact.content.headline}</h3>
                <ul className="space-y-1 mb-3">
                    {artifact.content.summaryBullets.map((b, i) => (
                        <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                            <CheckCircle size={14} className="text-emerald-500/50 mt-0.5 shrink-0" />
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>

                {artifact.content.explanationSteps.length > 0 && (
                    <div className="mt-3">
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
                        >
                            {expanded ? 'Hide Analysis' : 'Show Analysis'}
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>

                        {expanded && (
                            <div className="mt-3 pt-3 border-t border-slate-800/50 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                {artifact.content.explanationSteps.map((step, i) => (
                                    <div key={i} className="flex gap-3 text-sm text-slate-400">
                                        <span className="font-mono text-slate-600 font-bold">{i + 1}.</span>
                                        <p>{step}</p>
                                    </div>
                                ))}
                                <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-600">
                                    <span className="font-mono">CONFIDENCE: {(artifact.content.confidence * 100).toFixed(0)}%</span>
                                    <span>•</span>
                                    <span className="font-mono">HASH: {artifact.factsHash.substring(0, 8)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
