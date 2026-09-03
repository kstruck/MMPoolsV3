import { OverlayRoot } from './ui/OverlayRoot';
import { logger } from '../utils/logger';
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
            logger.error("Audit log subscription failed:", error);
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

    // Deduplicate winner entries - keep only the most recent entry for each unique winner
    // This prevents recalculate runs from creating noise in the audit log
    const deduplicatedEvents = filteredEvents.reduce((acc, event) => {
        // For WINNER_COMPUTED events, deduplicate by message content
        if (event.type === 'WINNER_COMPUTED') {
            // Create a key based on the winner info (period, home/away scores)
            const payload = event.payload || {};
            const key = `WINNER:${payload.period}:${payload.homeScore}:${payload.awayScore}:${payload.type || 'REGULAR'}`;

            // Check if we already have this winner logged
            const existingIdx = acc.findIndex(e => {
                if (e.type !== 'WINNER_COMPUTED') return false;
                const p = e.payload || {};
                const existingKey = `WINNER:${p.period}:${p.homeScore}:${p.awayScore}:${p.type || 'REGULAR'}`;
                return existingKey === key;
            });

            if (existingIdx === -1) {
                // No duplicate, add it
                acc.push(event);
            } else {
                // Replace with newer entry (events are sorted asc, so current is newer)
                acc[existingIdx] = event;
            }
        } else if (event.message?.includes('Finalized Event Payouts')) {
            // Deduplicate "Finalized Event Payouts" entries - keep only the latest
            const existingIdx = acc.findIndex(e => e.message?.includes('Finalized Event Payouts'));
            if (existingIdx === -1) {
                acc.push(event);
            } else {
                // Replace with newer (current event is newer since sorted asc)
                acc[existingIdx] = event;
            }
        } else {
            // Not a deduplicatable event, add normally
            acc.push(event);
        }
        return acc;
    }, [] as AuditLogEvent[]);

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedIds(newSet);
    };

    const getIcon = (type: AuditEventType) => {
        if (type === 'POOL_LOCKED') return <Lock size={16} className="text-gold-500" />;
        if (type === 'POOL_UNLOCKED') return <Unlock size={16} className="text-[#0F7B4A]" />;
        if (type === 'POOL_CREATED') return <Grid size={16} className="text-navy-600 dark:text-gold-400" />;
        if (type === 'DIGITS_GENERATED') return <RefreshCw size={16} className="text-navy-600 dark:text-gold-400" />;
        if (type === 'SCORE_FINALIZED') return <Activity size={16} className="text-[#0F7B4A]" />;
        if (type === 'WINNER_COMPUTED') return <DollarSign size={16} className="text-gold-500" />;
        if (type === 'SQUARE_RESERVED') return <User size={16} className="text-navy-600 dark:text-gold-400" />;
        if (type === 'SQUARE_RELEASED') return <User size={16} className="text-muted" />;
        if (type === 'ADMIN_OVERRIDE_SCORE' || type === 'PROP_QUESTION_GRADED') return <HelpCircle className="text-gold-500" size={16} />;
        if (type === 'PROP_CARD_PURCHASED') return <UserPlus className="text-navy-600 dark:text-gold-400" size={16} />;
        if (type.startsWith('ADMIN_OVERRIDE')) return <AlertTriangle size={16} className="text-brandred-600" />;
        return <Info size={16} className="text-muted" />;
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
        <OverlayRoot id="pool-audit-log" label="Audit log and disputes" onEscape={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-end">
            <div className="w-full max-w-2xl bg-surface h-full border-l border-line shadow-panel flex flex-col animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-6 border-b border-line flex justify-between items-center bg-page">
                    <div>
                        <h2 className="text-xl font-display font-bold uppercase tracking-[0.02em] text-[color:var(--text)] flex items-center gap-2">
                            <Shield className="text-gold-500" /> Audit Log & Disputes
                        </h2>
                        <p className="text-muted font-body text-sm">Tamper-evident history of all critical pool actions.</p>
                    </div>
                    <button onClick={onClose} className="text-muted hover:text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] px-4 py-2 transition-colors">Close</button>
                </div>

                {/* Filters */}
                <div className="p-4 border-b border-line bg-surface flex gap-2 overflow-x-auto">
                    {(['ALL', 'SQUARES', 'LOCK', 'DIGITS', 'SCORES', 'WINNERS', 'OVERRIDES'] as FilterType[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1 rounded-full text-xs font-display font-bold uppercase tracking-[0.08em] transition-colors whitespace-nowrap flex items-center gap-1 ${filter === f ? 'bg-navy-800 text-white' : 'bg-card text-muted border border-line hover:text-[color:var(--text)]'}`}
                        >
                            {f}
                            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] num ${filter === f ? 'bg-navy-700' : 'bg-line'}`}>
                                {counts[f]}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Feed */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {loading && <div className="text-muted text-center py-10">Loading audit history...</div>}
                    {!loading && deduplicatedEvents.length === 0 && <div className="text-muted text-center py-10">No events found matching this filter.</div>}

                    {deduplicatedEvents.map((event) => (
                        <div key={event.id} className={`bg-card border rounded-lg p-4 transition ${event.severity === 'CRITICAL' ? 'border-brandred-600/40 bg-brandred-600/5' : 'border-line'}`}>
                            <div className="flex items-start gap-4">
                                <div className={`mt-1 p-2 rounded-full bg-surface border border-line`}>
                                    {getIcon(event.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <h4 className={`font-body font-bold text-sm ${event.severity === 'CRITICAL' ? 'text-brandred-600' : 'text-[color:var(--text)]'}`}>{event.message}</h4>
                                        <span className="text-[10px] text-faint whitespace-nowrap ml-2 flex items-center gap-1 num">
                                            <Clock size={10} /> {formatTime(event.timestamp)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs font-display uppercase tracking-[0.05em] text-muted bg-surface px-1.5 py-0.5 rounded border border-line">{event.type}</span>
                                        <span className="text-xs text-faint">by</span>
                                        <span className={`text-xs font-display font-bold uppercase tracking-[0.05em] ${event.actor.role === 'ADMIN' ? 'text-navy-600 dark:text-gold-400' : event.actor.role === 'SYSTEM' ? 'text-[#0F7B4A]' : 'text-[color:var(--text)]'}`}>
                                            {event.actor.label || event.actor.role}
                                        </span>
                                    </div>

                                    {/* Action specific details snippet */}
                                    {event.payload && (
                                        <div className="mt-2">
                                            <button
                                                onClick={() => toggleExpand(event.id)}
                                                className="text-[10px] flex items-center gap-1 text-faint hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                                            >
                                                <FileJson size={10} /> {expandedIds.has(event.id) ? 'Hide Details' : 'View System Payload'}
                                            </button>

                                            {expandedIds.has(event.id) && (
                                                <pre className="mt-2 p-2 bg-navy-950 rounded text-[10px] text-gold-300 font-mono overflow-x-auto border border-navy-800">
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
        </OverlayRoot>
    );
};
