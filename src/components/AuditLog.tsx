import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import type { AuditLogEvent, AuditEventType } from '../types';
import {
    Shield, AlertTriangle, Info, FileJson, Clock, Lock,
    RefreshCw, Activity, DollarSign, User, Grid, Unlock,
    HelpCircle, UserPlus
} from 'lucide-react';

interface AuditLogProps {
    poolId: string;
    onClose: () => void;
}

type FilterType = 'ALL' | 'SQUARES' | 'LOCK' | 'DIGITS' | 'SCORES' | 'WINNERS' | 'OVERRIDES';

const FILTER_MAP: Record<FilterType, AuditEventType[]> = {
    'ALL': [],
    'SQUARES': ['SQUARE_RESERVED', 'SQUARE_RELEASED', 'PROP_CARD_PURCHASED'],
    'LOCK': ['POOL_LOCKED', 'POOL_UNLOCKED', 'POOL_CREATED'],
    'DIGITS': ['DIGITS_GENERATED'],
    'SCORES': ['SCORE_FINALIZED', 'ADMIN_OVERRIDE_SCORE', 'PROP_QUESTION_GRADED'],
    'WINNERS': ['WINNER_COMPUTED'],
    'OVERRIDES': ['ADMIN_OVERRIDE_SCORE', 'ADMIN_OVERRIDE_WINNER', 'ADMIN_OVERRIDE_DIGITS', 'ADMIN_OVERRIDE_SQUARE_STATE']
};

export const AuditLog: React.FC<AuditLogProps> = ({ poolId, onClose }) => {
    const [events, setEvents] = useState<AuditLogEvent[]>([]);
    const [filter, setFilter] = useState<FilterType>('ALL');
    const [loading, setLoading] = useState(true);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const auditRef = collection(db, 'pools', poolId, 'audit');

        // SIMPLIFIED QUERY: Fetch all events sorted by time
        // We filter client-side to avoid needing composite indexes for every filter type
        const q = query(auditRef, orderBy('timestamp', 'asc'), limit(500));

        const unsubscribe = onSnapshot(q, (snap) => {
            const evts: AuditLogEvent[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                evts.push({ ...d, id: doc.id } as AuditLogEvent);
            });
            setEvents(evts);
            setLoading(false);
        }, (error) => {
            console.error("Audit log subscription failed:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [poolId]); // Remove 'filter' dependency as we fetch all now

    // Client filtering is now redundant but kept ensuring data integrity if switching fast
    const filteredEvents = events.filter(e => {
        if (filter === 'ALL') return true;
        const types = FILTER_MAP[filter];
        return types.includes(e.type);
    });

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedIds(newSet);
    };

    const getIcon = (type: AuditEventType) => {
        if (type === 'POOL_LOCKED') return <Lock size={16} className="text-amber-400" />;
        if (type === 'POOL_UNLOCKED') return <Unlock size={16} className="text-emerald-400" />;
        if (type === 'POOL_CREATED') return <Grid size={16} className="text-indigo-400" />;
        if (type === 'DIGITS_GENERATED') return <RefreshCw size={16} className="text-indigo-400" />;
        if (type === 'SCORE_FINALIZED') return <Activity size={16} className="text-emerald-400" />;
        if (type === 'WINNER_COMPUTED') return <DollarSign size={16} className="text-yellow-400" />;
        if (type === 'SQUARE_RESERVED') return <User size={16} className="text-blue-400" />;
        if (type === 'SQUARE_RELEASED') return <User size={16} className="text-slate-400" />;
        if (type === 'ADMIN_OVERRIDE_SCORE' || type === 'PROP_QUESTION_GRADED') return <HelpCircle className="text-amber-400" size={16} />;
        if (type === 'PROP_CARD_PURCHASED') return <UserPlus className="text-indigo-400" size={16} />;
        if (type.startsWith('ADMIN_OVERRIDE')) return <AlertTriangle size={16} className="text-rose-500" />;
        return <Info size={16} className="text-slate-400" />;
    };

    const formatTime = (ts: any) => {
        // Handle Firestore Timestamp or number
        const date = ts?.toDate ? ts.toDate() : new Date(ts);
        return date.toLocaleString();
    };

    // Calculate counts for each filter tab
    const getCounts = () => {
        const counts: Record<FilterType, number> = {
            'ALL': events.length,
            'SQUARES': events.filter(e => FILTER_MAP['SQUARES'].includes(e.type)).length,
            'LOCK': events.filter(e => FILTER_MAP['LOCK'].includes(e.type)).length,
            'DIGITS': events.filter(e => FILTER_MAP['DIGITS'].includes(e.type)).length,
            'SCORES': events.filter(e => FILTER_MAP['SCORES'].includes(e.type)).length,
            'WINNERS': events.filter(e => FILTER_MAP['WINNERS'].includes(e.type)).length,
            'OVERRIDES': events.filter(e => FILTER_MAP['OVERRIDES'].includes(e.type)).length,
        };
        return counts;
    };

    const counts = getCounts();

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-end">
            <div className="w-full max-w-2xl bg-slate-900 h-full border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Shield className="text-emerald-400" /> Audit Log & Disputes
                        </h2>
                        <p className="text-slate-400 text-sm">Tamper-evident history of all critical pool actions.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white font-bold px-4 py-2">Close</button>
                </div>

                {/* Filters */}
                <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex gap-2 overflow-x-auto">
                    {(['ALL', 'SQUARES', 'LOCK', 'DIGITS', 'SCORES', 'WINNERS', 'OVERRIDES'] as FilterType[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1 ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                        >
                            {f}
                            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${filter === f ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                                {counts[f]}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Feed */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {loading && <div className="text-slate-500 text-center py-10">Loading audit history...</div>}
                    {!loading && filteredEvents.length === 0 && <div className="text-slate-500 text-center py-10">No events found matching this filter.</div>}

                    {filteredEvents.map((event) => (
                        <div key={event.id} className={`bg-slate-950 border rounded-lg p-4 transition-all ${event.severity === 'CRITICAL' ? 'border-rose-500/50 bg-rose-900/10' : 'border-slate-800'}`}>
                            <div className="flex items-start gap-4">
                                <div className={`mt-1 p-2 rounded-full bg-slate-900 border border-slate-700`}>
                                    {getIcon(event.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <h4 className={`font-bold text-sm ${event.severity === 'CRITICAL' ? 'text-rose-400' : 'text-slate-200'}`}>{event.message}</h4>
                                        <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2 flex items-center gap-1">
                                            <Clock size={10} /> {formatTime(event.timestamp)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">{event.type}</span>
                                        <span className="text-xs text-slate-500">by</span>
                                        <span className={`text-xs font-bold ${event.actor.role === 'ADMIN' ? 'text-indigo-400' : event.actor.role === 'SYSTEM' ? 'text-emerald-400' : 'text-slate-300'}`}>
                                            {event.actor.label || event.actor.role}
                                        </span>
                                    </div>

                                    {/* Action specific details snippet */}
                                    {event.payload && (
                                        <div className="mt-2">
                                            <button
                                                onClick={() => toggleExpand(event.id)}
                                                className="text-[10px] flex items-center gap-1 text-slate-500 hover:text-indigo-400 transition-colors"
                                            >
                                                <FileJson size={10} /> {expandedIds.has(event.id) ? 'Hide Details' : 'View System Payload'}
                                            </button>

                                            {expandedIds.has(event.id) && (
                                                <pre className="mt-2 p-2 bg-black/50 rounded text-[10px] text-emerald-400 font-mono overflow-x-auto border border-slate-800">
                                                    {JSON.stringify(event.payload, null, 2)}
                                                </pre>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
