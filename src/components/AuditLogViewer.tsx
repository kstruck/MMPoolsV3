
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

interface AuditEvent {
    id: string;
    type: string;
    message: string;
    timestamp: number;
    severity: 'INFO' | 'WARNING' | 'ERROR';
    payload?: any;
    actor?: { role: string, email?: string };
}

export const AuditLogViewer: React.FC<{ poolId: string }> = ({ poolId }) => {
    const [events, setEvents] = useState<AuditEvent[]>([]);

    useEffect(() => {
        const q = query(
            collection(db, 'pools', poolId, 'audit'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const newEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditEvent));
            setEvents(newEvents);
        });

        return () => unsub();
    }, [poolId]);

    return (
        <div className="bg-card border border-line rounded-lg overflow-hidden h-96 flex flex-col shadow-card">
            <div className="bg-surface p-2 border-b border-line font-display font-bold text-xs uppercase tracking-[0.08em] text-muted flex justify-between items-center">
                <span>Live Audit Log</span>
                <span className="text-[10px] bg-card border border-line px-1.5 py-0.5 rounded text-muted num">Last 50 Events</span>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-2 font-mono text-xs scrollbar-thin scrollbar-thumb-line scrollbar-track-transparent">
                {events.length === 0 && <div className="text-muted italic p-4 text-center">No events logged yet. Perform an action to see logs.</div>}

                {events.map(ev => (
                    <div key={ev.id} className="border-l-2 border-line pl-2 py-1 hover:bg-surface transition-colors">
                        <div className="flex justify-between items-center text-muted mb-1">
                            <span className="text-[10px] num">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                            <span className={`text-[10px] font-display font-bold uppercase px-1 rounded ${ev.severity === 'ERROR' ? 'bg-brandred-600/10 text-brandred-600' :
                                    ev.severity === 'WARNING' ? 'bg-[#FBEEDD] text-[#B4530A]' :
                                        'bg-surface text-muted'
                                }`}>{ev.type}</span>
                        </div>
                        <div className="text-[color:var(--text)] break-words leading-tight">{ev.message}</div>
                        {ev.actor && (
                            <div className="text-[10px] text-faint mt-0.5">By: {ev.actor.role}</div>
                        )}
                        {ev.payload && (
                            <details className="mt-1 group">
                                <summary className="cursor-pointer text-[10px] text-gold-700 dark:text-gold-400 hover:text-gold-600 select-none">
                                    View Payload
                                </summary>
                                <pre className="bg-navy-950 p-2 rounded mt-1 text-[10px] text-gold-300 overflow-x-auto whitespace-pre-wrap border border-navy-800">
                                    {JSON.stringify(ev.payload, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
